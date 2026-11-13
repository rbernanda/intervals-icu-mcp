import type { IntervalsClient } from '../intervals/client';
import { MAX_ACTIVITIES, MAX_EVENTS } from '../intervals/client';
import type { SourceActivity } from '../intervals/schemas';
import { buildTrainingCalendar } from '../intervals/calendar';
import {
  normalizeActivity,
  normalizeFitness,
  normalizeInterval,
  normalizeProfile,
  normalizeWellness,
} from '../intervals/normalizers';
import { checkRange, inRange, shiftDate, todayInTimezone, type DateRange } from '../utils/dates';
import { AppError } from '../utils/errors';
import { matchesSport } from '../domain/models';
import { aggregateSummary } from '../domain/summary';
import { inputs, outputs } from './contracts';

const METRIC_NOTE =
  'Distances are meters, durations seconds, speed m/s, pace s/km (computed as 1000 / average_speed), power watts, heart rate bpm. Running cadence spm is computed as 2 × source rpm. Training load preserves source units.';
const FITNESS_NOTE =
  'CTL and ATL are source values from wellness. No source daily TSB is documented: computed_form is same-day ctl - atl in load units, not the optional percentage display or previous-day TSB. ctlLoad and atlLoad are preserved separately; no generic daily load is inferred.';
const WELLNESS_NOTE =
  'HRV fields and subjective/readiness scores preserve source values; the OpenAPI schema does not define their measurement method or score scales. Missing days are not zero-filled.';

export interface ServiceOptions {
  timezone: string;
  now?: () => Date;
}

export class TrainingService {
  private readonly now: () => Date;

  constructor(
    private readonly client: IntervalsClient,
    private readonly options: ServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  private context(warnings: string[] = []) {
    return {
      source: 'Intervals.icu' as const,
      retrieved_at: this.now().toISOString(),
      date_context: `Inclusive athlete-local dates; default timezone ${this.options.timezone}. start_local has no UTC offset; start_timestamp preserves source timestamp.`,
      warnings,
    };
  }

  /** Complete aggregates must reject saturated ranges and restricted activity stubs rather than undercount. */
  private async activityRange(
    range: DateRange,
    requireComplete: boolean,
  ): Promise<{ rows: SourceActivity[]; saturated: boolean }> {
    const rows = await this.client.activities(range);
    const saturated = rows.length > MAX_ACTIVITIES;
    if (requireComplete && saturated) {
      throw new AppError(
        'response_too_large',
        'Activity range exceeds 1000 records. Use a shorter date range.',
      );
    }
    if (requireComplete && rows.some((a) => !a.type || !a.start_date_local)) {
      throw new AppError(
        'invalid_response',
        'Incomplete activity stubs prevent a complete summary. Upstream may restrict Strava-sourced data.',
      );
    }
    return {
      rows: rows.filter((a) => !a.start_date_local || inRange(a.start_date_local, range)),
      saturated,
    };
  }

  async profile(args: unknown) {
    inputs.profile.parse(args);
    return outputs.profile.parse({
      ...this.context(),
      athlete: normalizeProfile(await this.client.profile()),
    });
  }

  async recent(args: unknown) {
    const input = inputs.recent.parse(args);
    const end = input.end_date ?? todayInTimezone(this.now(), this.options.timezone);
    const range = checkRange({
      start_date: input.start_date ?? shiftDate(end, -27),
      end_date: end,
    });
    const { rows, saturated } = await this.activityRange(range, false);
    const matches = rows
      .filter((a) => matchesSport(a.type, input.sport_type))
      .sort(
        (a, b) =>
          (b.start_date_local ?? '').localeCompare(a.start_date_local ?? '') ||
          b.id.localeCompare(a.id),
      );
    const warnings = [METRIC_NOTE];
    if (saturated) {
      warnings.push(
        'Upstream range saturated the 1000 activity cap; matching_count and filtering may be incomplete. Narrow the range.',
      );
    }
    if (rows.some((a) => !a.type || !a.start_date_local)) {
      warnings.push(
        'Some upstream activities are incomplete stubs. Missing metrics remain null; sport filtering cannot match unknown types.',
      );
    }
    return outputs.recent.parse({
      ...this.context(warnings),
      range,
      activities: matches.slice(0, input.limit).map(normalizeActivity),
      matching_count: matches.length,
      returned_count: Math.min(matches.length, input.limit),
      upstream_saturated: saturated,
    });
  }

  async detail(args: unknown) {
    const input = inputs.detail.parse(args);
    const activity = await this.client.activity(input.activity_id);
    const athlete = await this.client.profile();
    if (
      activity.id !== input.activity_id ||
      !activity.icu_athlete_id ||
      activity.icu_athlete_id !== athlete.id
    ) {
      throw new AppError(
        'upstream_forbidden',
        'Activity ownership could not be verified for the configured athlete.',
      );
    }
    let intervals = null;
    let truncated = false;
    if (input.include_intervals) {
      const source = await this.client.intervals(input.activity_id);
      if (source.id !== activity.id) {
        throw new AppError('invalid_response', 'Intervals do not match the requested activity.');
      }
      truncated = (source.icu_intervals?.length ?? 0) > 200;
      intervals = (source.icu_intervals ?? [])
        .slice(0, 200)
        .map((i) => normalizeInterval(i, activity.type));
    }
    return outputs.detail.parse({
      ...this.context([
        METRIC_NOTE,
        'Intervals preserve source WORK/RECOVERY/lap labels; device laps may not be available. At most 200 intervals are returned.',
      ]),
      activity: normalizeActivity(activity),
      intervals,
      intervals_truncated: truncated,
    });
  }

  async fitness(args: unknown) {
    const range = checkRange(inputs.range.parse(args));
    const records = await this.client.wellness(range);
    return outputs.fitness.parse({
      ...this.context([FITNESS_NOTE]),
      range,
      daily: records
        .filter((w) => inRange(w.id, range))
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(normalizeFitness),
    });
  }

  async wellness(args: unknown) {
    const range = checkRange(inputs.range.parse(args));
    const records = await this.client.wellness(range);
    return outputs.wellness.parse({
      ...this.context([WELLNESS_NOTE]),
      range,
      daily: records
        .filter((w) => inRange(w.id, range))
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(normalizeWellness),
    });
  }

  async calendar(args: unknown) {
    const range = checkRange(inputs.range.parse(args));
    const [events, { rows: activities }] = await Promise.all([
      this.client.events(range),
      this.activityRange(range, true),
    ]);
    if (events.length > MAX_EVENTS) {
      throw new AppError(
        'response_too_large',
        'Calendar range exceeds 300 events. Use a shorter range.',
      );
    }
    return outputs.calendar.parse({
      ...this.context([
        'Events and activities are separate source collections. Completed means an activity exists; pairing uses activity.paired_event_id only. Unpaired WORKOUT events remain planned regardless of date. Other categories remain calendar_event.',
      ]),
      range,
      entries: buildTrainingCalendar(activities, events, range),
    });
  }

  async summary(args: unknown) {
    const input = inputs.summary.parse(args);
    const end = todayInTimezone(this.now(), this.options.timezone);
    const range = checkRange({ start_date: shiftDate(end, 1 - input.days), end_date: end });
    const [{ rows }, wellness] = await Promise.all([
      this.activityRange(range, true),
      this.client.wellness(range),
    ]);
    const activities = rows
      .filter((a) => matchesSport(a.type, input.sport_type))
      .map(normalizeActivity);
    return outputs.summary.parse({
      ...this.context([
        METRIC_NOTE,
        FITNESS_NOTE,
        'Aggregations cover retrieved activities only. Any missing metric makes that total null, with coverage counts. Weekly means Monday–Sunday; edge weeks may be partial. Average weekly volume = total × 7 / inclusive days. Latest fitness is the latest record with both CTL and ATL, across all sports regardless of sport_filter.',
      ]),
      range,
      sport_filter: input.sport_type ?? null,
      summary: aggregateSummary(
        activities,
        wellness.filter((w) => inRange(w.id, range)).map(normalizeFitness),
        range,
      ),
    });
  }
}
