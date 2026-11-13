export type ErrorCategory =
  | 'upstream_unauthorized'
  | 'upstream_forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'upstream_unavailable'
  | 'timeout'
  | 'invalid_response'
  | 'response_too_large'
  | 'invalid_input'
  | 'configuration'
  | 'internal';

export class AppError extends Error {
  constructor(
    public readonly category: ErrorCategory,
    message: string,
    public readonly upstreamStatus?: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function safeError(error: unknown): AppError {
  return error instanceof AppError
    ? error
    : new AppError('internal', 'The request could not be completed.');
}

export interface LogEntry {
  event: 'request' | 'tool' | 'upstream' | 'oauth';
  outcome: 'ok' | 'error';
  duration_ms: number;
  tool?: string;
  error_category?: string;
  upstream_status?: number;
  http_status?: number;
}
export type Logger = (entry: LogEntry) => void;
export const log: Logger = (entry) => console.log(JSON.stringify(entry));
