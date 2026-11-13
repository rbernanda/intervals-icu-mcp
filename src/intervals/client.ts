import { z } from 'zod';
import { AppError, log, type Logger, type ErrorCategory } from '../utils/errors';
import { checkRange, type DateRange } from '../utils/dates';
import { readBoundedJson } from '../utils/http';
import {
  activityIdSchema,
  activitySchema,
  athleteSchema,
  eventSchema,
  intervalsSchema,
  intervalSchema,
  wellnessSchema,
} from './schemas';

export const MAX_ACTIVITIES = 1000;
export const MAX_EVENTS = 300;
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 2000;
export const UPSTREAM_BUDGET_MS = 25000;
const API_ORIGIN = 'https://intervals.icu';
export interface ClientOptions {
  apiKey: string;
  athleteId: string;
  timeoutMs?: number;
  deadlineAtMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  logger?: Logger;
  now?: () => number;
}
const ACTIVITY_FIELDS = Object.keys(activitySchema.shape).join(',');
const WELLNESS_FIELDS = Object.keys(wellnessSchema.shape).join(',');
const EVENT_FIELDS = Object.keys(eventSchema.shape).join(',');
const INTERVAL_FIELDS = [
  'id',
  ...Object.keys(intervalSchema.shape).map((field) => `icu_intervals.${field}`),
].join(',');

export function retryAfterMs(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  if (/^\d+(\.\d+)?$/.test(value.trim())) return Math.ceil(Number(value) * 1000);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed - now) : undefined;
}
function statusError(status: number, retryAfter?: number): AppError {
  const args: Record<number, [ErrorCategory, string]> = {
    401: ['upstream_unauthorized', 'Intervals.icu rejected the API credentials.'],
    403: ['upstream_forbidden', 'Intervals.icu denied access to this resource.'],
    404: ['not_found', 'The requested Intervals.icu resource was not found.'],
    429: ['rate_limited', 'Intervals.icu rate limit reached. Retry later.'],
  };
  const [category, message] =
    args[status] ??
    (status >= 500
      ? ['upstream_unavailable', 'Intervals.icu is temporarily unavailable.']
      : ['invalid_response', 'Intervals.icu returned an unexpected HTTP status.']);
  return new AppError(
    category,
    message,
    status,
    retryAfter === undefined ? undefined : Math.ceil(retryAfter / 1000),
  );
}

export class IntervalsClient {
  private readonly requestFetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  constructor(private readonly options: ClientOptions) {
    if (!options.apiKey || !/^(0|i?[1-9]\d*)$/.test(options.athleteId))
      throw new AppError('configuration', 'Invalid Intervals client configuration.');
    this.requestFetch = (options.fetch ?? fetch).bind(globalThis);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.logger = options.logger ?? log;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 10000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 20000)
      throw new AppError('configuration', 'Invalid upstream timeout.');
  }
  private athletePath(suffix = ''): string {
    return `/api/v1/athlete/${encodeURIComponent(this.options.athleteId)}${suffix}`;
  }
  async get<T>(
    path: string,
    schema: z.ZodType<T>,
    query: Record<string, string | number | boolean> = {},
  ): Promise<T> {
    // No caller-provided hosts, paths outside the API, redirects, or mutation methods.
    if (!/^\/api\/v1\/(athlete|activity)\/[A-Za-z0-9_-]+(?:\/[A-Za-z]+)?$/.test(path))
      throw new AppError('invalid_input', 'Unsupported API path.');
    const url = new URL(path, API_ORIGIN);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    const started = this.now();
    const deadline = this.options.deadlineAtMs ?? started + UPSTREAM_BUDGET_MS;
    try {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const remaining = deadline - this.now();
        if (remaining <= 0) throw new AppError('timeout', 'Upstream request budget exhausted.');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), Math.min(this.timeoutMs, remaining));
        let error: AppError;
        let waitMs: number | undefined;
        try {
          const response = await this.requestFetch(url, {
            method: 'GET',
            redirect: 'manual',
            signal: controller.signal,
            headers: {
              Authorization: `Basic ${btoa(`API_KEY:${this.options.apiKey}`)}`,
              Accept: 'application/json',
            },
          });
          if (response.ok) {
            const parsed = schema.safeParse(await readBoundedJson(response, MAX_RESPONSE_BYTES));
            if (!parsed.success)
              throw new AppError(
                'invalid_response',
                'Intervals.icu returned an unexpected response shape.',
              );
            this.logger({
              event: 'upstream',
              outcome: 'ok',
              duration_ms: this.now() - started,
              upstream_status: response.status,
            });
            return parsed.data;
          }
          waitMs = retryAfterMs(response.headers.get('retry-after'), this.now());
          await response.body?.cancel();
          error = statusError(response.status, waitMs);
          if (response.status !== 429 && response.status < 500) throw error;
        } catch (caught) {
          if (caught instanceof AppError) {
            if (!['rate_limited', 'upstream_unavailable'].includes(caught.category)) throw caught;
            error = caught;
          } else {
            error = controller.signal.aborted
              ? new AppError('timeout', 'Intervals.icu request timed out.')
              : new AppError('upstream_unavailable', 'Could not reach Intervals.icu.');
          }
        } finally {
          clearTimeout(timeout);
        }
        const delay = waitMs ?? 250 * 2 ** attempt;
        if (attempt === MAX_RETRIES || delay > MAX_RETRY_WAIT_MS || this.now() + delay >= deadline)
          throw error;
        await this.sleep(delay);
      }
      throw new AppError('internal', 'Request could not be completed.');
    } catch (error) {
      const safe =
        error instanceof AppError
          ? error
          : new AppError('internal', 'Request could not be completed.');
      this.logger({
        event: 'upstream',
        outcome: 'error',
        duration_ms: this.now() - started,
        error_category: safe.category,
        upstream_status: safe.upstreamStatus,
      });
      throw safe;
    }
  }
  profile() {
    return this.get(this.athletePath(), athleteSchema);
  }
  activities(range: DateRange) {
    checkRange(range);
    // No cursor/offset is documented: bounded range + sentinel detects saturation; never invent pagination.
    return this.get(
      this.athletePath('/activities'),
      z.array(activitySchema).max(MAX_ACTIVITIES + 1),
      {
        oldest: `${range.start_date}T00:00:00`,
        newest: `${range.end_date}T23:59:59`,
        limit: MAX_ACTIVITIES + 1,
        fields: ACTIVITY_FIELDS,
      },
    );
  }
  activity(id: string) {
    activityIdSchema.parse(id);
    return this.get(`/api/v1/activity/${encodeURIComponent(id)}`, activitySchema, {
      intervals: false,
    });
  }
  intervals(id: string) {
    activityIdSchema.parse(id);
    return this.get(`/api/v1/activity/${encodeURIComponent(id)}/intervals`, intervalsSchema, {
      fields: INTERVAL_FIELDS,
    });
  }
  wellness(range: DateRange) {
    checkRange(range);
    return this.get(this.athletePath('/wellness'), z.array(wellnessSchema).max(90), {
      oldest: range.start_date,
      newest: range.end_date,
      fields: WELLNESS_FIELDS,
    });
  }
  events(range: DateRange) {
    checkRange(range);
    return this.get(this.athletePath('/events'), z.array(eventSchema).max(MAX_EVENTS + 1), {
      oldest: range.start_date,
      newest: range.end_date,
      limit: MAX_EVENTS + 1,
      fields: EVENT_FIELDS,
    });
  }
}
