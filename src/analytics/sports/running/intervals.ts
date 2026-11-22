import { z } from 'zod';
import { intervalOutputSchema, isRunning } from '../../../domain/models';
import { nullableMetric, provenanceSchema, statsSchema } from '../../contracts';
import {
  computed,
  difference,
  pooledSpeed,
  positive,
  source,
  statistics,
  totalMetric,
} from '../../core';
import { metricSchema } from '../../contracts';

export const MAX_ANALYSIS_INTERVALS = 200;

export const INTERVAL_METHOD_VERSION = 'running-intervals/1.0.0' as const;

export const intervalOptionsSchema = z.object({
  work_interval_indexes: z
    .array(z.number().int().min(1).max(MAX_ANALYSIS_INTERVALS))
    .min(1)
    .max(MAX_ANALYSIS_INTERVALS)
    .refine((indexes) => new Set(indexes).size === indexes.length, 'Indexes must be unique.')
    .optional(),
  target_pace_s_per_km: z.number().finite().positive().max(3600).optional(),
});

const repetitionSchema = z.object({
  source_index: z.number().int().positive(),
  role: z.enum(['work', 'recovery', 'other']),
  interval: intervalOutputSchema,
  target_pace_difference_s_per_km: nullableMetric,
  missing_fields: z.array(z.string()),
});

const groupSchema = z.object({
  count: z.number().int().nonnegative(),
  distance_m: metricSchema,
  moving_time_s: metricSchema,
  pooled_moving_pace_s_per_km: nullableMetric,
});

export const runningIntervalsSchema = z.object({
  method_version: z.literal(INTERVAL_METHOD_VERSION),
  status: z.enum(['ok', 'limited', 'insufficient_evidence', 'unsupported_sport']),
  classification_basis: z.enum(['user_selected_indexes', 'source_interval_types']),
  target_pace_s_per_km: nullableMetric,
  intervals: z.array(repetitionSchema).max(MAX_ANALYSIS_INTERVALS),
  work: groupSchema,
  recovery: groupSchema,
  work_pace_statistics_s_per_km: statsSchema,
  work_pace_coefficient_of_variation_percent: nullableMetric,
  first_to_last_work_pace_change_s_per_km: nullableMetric,
  first_to_last_work_pace_change_percent: nullableMetric,
  data_quality: z.object({
    returned_interval_count: z.number().int().nonnegative(),
    intervals_truncated: z.boolean(),
    missing_requested_indexes: z.array(z.number().int()),
    work_pace_recorded_count: z.number().int().nonnegative(),
    work_pace_missing_count: z.number().int().nonnegative(),
    chronological_work_order_verified: z.boolean(),
    invalid_timing_indexes: z.array(z.number().int()),
    overlapping_intervals: z.boolean(),
    reasons: z.array(z.string()),
  }),
  provenance: z.record(z.string(), provenanceSchema),
  limitations: z.array(z.string()),
});

type Interval = z.infer<typeof intervalOutputSchema>;
type Repetition = z.infer<typeof repetitionSchema>;

function summarize(rows: Repetition[], blocked: boolean) {
  const metrics = rows.map((row) => row.interval);
  return {
    count: rows.length,
    distance_m: totalMetric(
      metrics.map((row) => row.distance_m),
      'icu_intervals.distance',
      'm',
      blocked,
    ),
    moving_time_s: totalMetric(
      metrics.map((row) => row.moving_time_s),
      'icu_intervals.moving_time',
      's',
      blocked,
    ),
    pooled_moving_pace_s_per_km: blocked ? null : pooledSpeed(metrics).pace_s_per_km,
  };
}

/** Pure, bounded analysis of source intervals; labels never classify workout purpose. */
export function analyzeRunningIntervals(
  sport: string | null,
  sourceIntervals: readonly Interval[],
  options: z.infer<typeof intervalOptionsSchema>,
  truncated = false,
): z.infer<typeof runningIntervalsSchema> {
  const supported = isRunning(sport);
  const rows = sourceIntervals.slice(0, MAX_ANALYSIS_INTERVALS);
  const isTruncated = truncated || sourceIntervals.length > MAX_ANALYSIS_INTERVALS;
  const selected = options.work_interval_indexes ? new Set(options.work_interval_indexes) : null;
  const missingIndexes = [...(selected ?? [])].filter((index) => index > rows.length);
  const intervals: Repetition[] = rows.map((interval, index) => {
    const work = supported && (selected ? selected.has(index + 1) : interval.type === 'WORK');
    const pace = positive(interval.average_speed_mps);
    return {
      source_index: index + 1,
      role: work ? 'work' : supported && interval.type === 'RECOVERY' ? 'recovery' : 'other',
      interval: { ...interval, average_pace_s_per_km: pace === null ? null : 1000 / pace },
      target_pace_difference_s_per_km:
        work && pace !== null && options.target_pace_s_per_km !== undefined
          ? 1000 / pace - options.target_pace_s_per_km
          : null,
      missing_fields: [
        ...(pace === null ? ['average_speed_mps'] : []),
        ...(positive(interval.distance_m) === null ? ['distance_m'] : []),
        ...(positive(interval.moving_time_s) === null ? ['moving_time_s'] : []),
      ],
    };
  });
  const work = supported ? intervals.filter((row) => row.role === 'work') : [];
  const recovery = supported ? intervals.filter((row) => row.role === 'recovery') : [];
  const invalidTiming = intervals
    .filter(
      ({ interval }) =>
        interval.start_time_s !== null &&
        interval.end_time_s !== null &&
        interval.end_time_s <= interval.start_time_s,
    )
    .map((row) => row.source_index);
  const timed = intervals
    .filter(({ interval }) => interval.start_time_s !== null && interval.end_time_s !== null)
    .sort((a, b) => a.interval.start_time_s! - b.interval.start_time_s!);
  let maxEnd = -Infinity;
  let overlap = false;
  for (const row of timed) {
    if (row.interval.start_time_s! < maxEnd) {
      overlap = true;
    }
    maxEnd = Math.max(maxEnd, row.interval.end_time_s!);
  }
  const blocked =
    !supported || isTruncated || missingIndexes.length > 0 || invalidTiming.length > 0 || overlap;
  const chronological =
    work.length > 1 &&
    !blocked &&
    work.every(({ interval }) => interval.start_time_s !== null && interval.end_time_s !== null);
  const ordered = [...work].sort((a, b) => a.interval.start_time_s! - b.interval.start_time_s!);
  const paces = work
    .map((row) => row.interval.average_pace_s_per_km)
    .filter((pace): pace is number => pace !== null);
  const completePaces = work.length > 0 && paces.length === work.length && !blocked;
  const stats = statistics(completePaces ? paces : []);
  const change = difference(
    chronological ? ordered.at(-1)!.interval.average_pace_s_per_km : null,
    chronological ? ordered[0]!.interval.average_pace_s_per_km : null,
    's/km',
  );
  const reasons = [
    ...(!supported ? ['UNSUPPORTED_SPORT'] : []),
    ...(isTruncated ? ['TRUNCATED_INTERVALS'] : []),
    ...(missingIndexes.length ? ['MISSING_REQUESTED_INDEXES'] : []),
    ...(invalidTiming.length ? ['INVALID_TIMING'] : []),
    ...(overlap ? ['OVERLAPPING_INTERVALS'] : []),
    ...(!work.length ? ['NO_WORK_INTERVALS'] : []),
    ...(work.some((row) => row.missing_fields.length) ? ['MISSING_WORK_METRICS'] : []),
    ...(recovery.some((row) => row.missing_fields.length) ? ['MISSING_RECOVERY_METRICS'] : []),
    ...(work.length === 1 ? ['SINGLE_WORK_INTERVAL'] : []),
    ...(work.length > 1 && !chronological ? ['UNVERIFIED_WORK_ORDER'] : []),
  ];
  return {
    method_version: INTERVAL_METHOD_VERSION,
    status: !supported
      ? 'unsupported_sport'
      : !work.length
        ? 'insufficient_evidence'
        : reasons.length
          ? 'limited'
          : 'ok',
    classification_basis: selected ? 'user_selected_indexes' : 'source_interval_types',
    target_pace_s_per_km: options.target_pace_s_per_km ?? null,
    intervals,
    work: summarize(work, blocked),
    recovery: summarize(recovery, blocked),
    work_pace_statistics_s_per_km: stats,
    work_pace_coefficient_of_variation_percent:
      stats.mean !== null && stats.mean > 0 && stats.sample_standard_deviation !== null
        ? (100 * stats.sample_standard_deviation) / stats.mean
        : null,
    first_to_last_work_pace_change_s_per_km: change.absolute_change,
    first_to_last_work_pace_change_percent: change.percentage_change,
    data_quality: {
      returned_interval_count: rows.length,
      intervals_truncated: isTruncated,
      missing_requested_indexes: missingIndexes,
      work_pace_recorded_count: paces.length,
      work_pace_missing_count: work.length - paces.length,
      chronological_work_order_verified: chronological,
      invalid_timing_indexes: invalidTiming,
      overlapping_intervals: overlap,
      reasons,
    },
    provenance: {
      interval_metrics: source('icu_intervals', 'm, s, m/s, bpm, W; nullable source metrics'),
      repetition_pace: computed(
        '1000 / source average_speed when positive',
        's/km',
        'icu_intervals.average_speed',
      ),
      pace_statistics: computed(
        'equal-repetition descriptive pace statistics; sample SD uses n - 1; all work paces required',
        's/km',
      ),
      pace_variation: computed(
        '100 * sample SD / arithmetic mean of work paces; at least two required',
        '%',
      ),
      first_to_last_change: change.provenance,
      target_difference: computed(
        'repetition pace - supplied target pace; positive means slower',
        's/km',
      ),
      pooled_pace: computed(
        '1000 * sum moving_time / sum distance; all positive inputs required',
        's/km',
      ),
    },
    limitations: [
      'Intervals.icu analysis intervals are not guaranteed original device laps or prescribed repetitions. Source WORK may include warm-up/cool-down; select work_interval_indexes to designate repetitions. Names/labels are untrusted data.',
      'Indexes are 1-based positions in the source response, preserved in output. Unknown types remain other; no classification from pace, HR or names.',
      'Pace variation is descriptive, including mixed-distance or mixed-purpose repetitions; it is not an execution grade or physiological fatigue score. Positive pace changes mean slower, not proven fatigue.',
      'No HR recovery kinetics, cardiac drift, race prediction or independently verified synchronization coverage. First/last changes require valid chronological work timing; aggregates are withheld for truncated, overlapping or invalid-timing data or missing selections.',
    ],
  };
}
