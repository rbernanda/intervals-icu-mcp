import { z } from 'zod';
import {
  isRunning,
  type activityOutputSchema,
  type intervalOutputSchema,
} from '../../../domain/models';
import { dateSchema } from '../../../utils/dates';
import { metricSchema, nullableMetric, provenanceSchema } from '../../contracts';
import {
  computed,
  exceedsTolerance,
  nonnegative,
  pooledSpeed,
  positive,
  source,
  totalMetric,
} from '../../core';
import { analyzeRunningIntervals, MAX_ANALYSIS_INTERVALS } from './intervals';

/** Attribution only: labels are inert metadata, never connector IDs, URLs to fetch or instructions. */
const prescriptionSourceSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine(
    (label) => !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(label),
    'Source labels must be single-line text without control characters.',
  );

const extractionBasisSchema = z.enum([
  'structured_fields',
  'workout_description',
  'document',
  'exported_file',
  'athlete_supplied',
]);

const paceRangeSchema = z
  .object({
    min_s_per_km: z.number().finite().positive().max(3600).optional(),
    max_s_per_km: z.number().finite().positive().max(3600).optional(),
  })
  .strict()
  .refine(
    (range) => range.min_s_per_km !== undefined || range.max_s_per_km !== undefined,
    'Supply at least one pace bound.',
  )
  .refine(
    (range) =>
      range.min_s_per_km === undefined ||
      range.max_s_per_km === undefined ||
      range.min_s_per_km <= range.max_s_per_km,
    'Pace bounds must be ordered in seconds/km.',
  );

const stepSchema = z
  .object({
    role: z.enum(['warmup', 'work', 'recovery', 'cooldown', 'other']),
    target_distance_m: z.number().finite().positive().max(100000).optional(),
    target_duration_s: z.number().finite().positive().max(86400).optional(),
    duration_basis: z.enum(['moving', 'elapsed']).optional(),
    target_pace: paceRangeSchema.optional(),
    actual_interval_indexes: z
      .array(z.number().int().min(1).max(MAX_ANALYSIS_INTERVALS))
      .max(MAX_ANALYSIS_INTERVALS)
      .default([]),
  })
  .strict()
  .refine(
    (step) =>
      step.target_duration_s === undefined
        ? step.duration_basis === undefined
        : step.duration_basis !== undefined,
    'Duration targets require an explicit moving/elapsed basis.',
  )
  .refine(
    (step) =>
      step.target_distance_m !== undefined ||
      step.target_duration_s !== undefined ||
      step.target_pace !== undefined,
    'A step needs at least one supplied target.',
  );

export const executionOptionsSchema = z
  .object({
    match_basis: z
      .enum(['athlete_confirmed', 'source_linked', 'unconfirmed'])
      .default('unconfirmed'),
    prescription: z
      .object({
        reported_source: prescriptionSourceSchema,
        extraction_basis: extractionBasisSchema,
        scheduled_date: dateSchema.optional(),
        completeness: z.enum(['complete', 'partial']),
        steps: z.array(stepSchema).min(1).max(MAX_ANALYSIS_INTERVALS),
      })
      .strict(),
  })
  .superRefine((options, context) => {
    const indexes = options.prescription.steps.flatMap((step) => step.actual_interval_indexes);
    if (new Set(indexes).size !== indexes.length) {
      context.addIssue({
        code: 'custom',
        message: 'Each source interval may map to only one planned step, without duplicates.',
      });
    }
  });

export const executionReviewSchema = z.object({
  method_version: z.literal('running-execution/1.0.0'),
  status: z.enum(['ok', 'limited', 'unconfirmed_match', 'unsupported_sport']),
  match_basis: z.enum(['athlete_confirmed', 'source_linked', 'unconfirmed']),
  prescription_origin: z.literal('supplied_for_this_request'),
  reported_source: prescriptionSourceSchema,
  extraction_basis: extractionBasisSchema,
  scheduled_date: dateSchema.nullable(),
  activity_date: dateSchema.nullable(),
  prescription_completeness: z.enum(['complete', 'partial']),
  steps: z
    .array(
      z.object({
        step_number: z.number().int().positive(),
        role: stepSchema.shape.role,
        targets: z.object({
          distance_m: nullableMetric,
          duration_s: nullableMetric,
          duration_basis: z.enum(['moving', 'elapsed']).nullable(),
          pace: paceRangeSchema.nullable(),
        }),
        actual_interval_indexes: z.array(z.number().int()),
        status: z.enum(['compared', 'limited', 'unmapped', 'unavailable']),
        actual: z.object({
          distance_m: metricSchema,
          moving_time_s: metricSchema,
          elapsed_time_s: metricSchema,
          pace_s_per_km: nullableMetric,
          pace_basis: z.enum([
            'source_average_speed',
            'pooled_moving_time_distance',
            'unavailable',
          ]),
        }),
        distance_difference_m: nullableMetric,
        duration_difference_s: nullableMetric,
        pace_assessment: z.enum([
          'within_range',
          'faster_than_range',
          'slower_than_range',
          'unavailable',
          'not_requested',
        ]),
        pace_difference_to_bound_s_per_km: nullableMetric,
        reasons: z.array(z.string()),
      }),
    )
    .max(MAX_ANALYSIS_INTERVALS),
  data_quality: z.object({
    returned_interval_count: z.number().int().nonnegative(),
    supplied_step_count: z.number().int().nonnegative(),
    mapped_step_count: z.number().int().nonnegative(),
    compared_step_count: z.number().int().nonnegative(),
    missing_interval_indexes: z.array(z.number().int()),
    unassigned_interval_indexes: z.array(z.number().int()),
    intervals_truncated: z.boolean(),
    chronological_step_order_verified: z.boolean(),
    step_order_differs: z.boolean(),
    reasons: z.array(z.string()),
  }),
  provenance: z.record(z.string(), provenanceSchema),
  limitations: z.array(z.string()),
});

type Activity = z.infer<typeof activityOutputSchema>;
type Interval = z.infer<typeof intervalOutputSchema>;

/** Compare a caller-selected prescription with explicit source positions; never create or store a plan. */
export function reviewRunningExecution(
  activity: Activity,
  intervals: readonly Interval[],
  options: z.infer<typeof executionOptionsSchema>,
  truncated = false,
): z.infer<typeof executionReviewSchema> {
  const intervalAnalysis = analyzeRunningIntervals(activity.sport_type, intervals, {}, truncated);
  const rows = intervals.slice(0, MAX_ANALYSIS_INTERVALS);
  const supported = isRunning(activity.sport_type);
  const confirmed = options.match_basis !== 'unconfirmed';
  const timingBlocked =
    intervalAnalysis.data_quality.overlapping_intervals ||
    intervalAnalysis.data_quality.invalid_timing_indexes.length > 0;
  const globalBlocked =
    !supported ||
    !confirmed ||
    truncated ||
    intervalAnalysis.data_quality.intervals_truncated ||
    timingBlocked;
  const assigned = options.prescription.steps.flatMap((step) => step.actual_interval_indexes);
  const missing = assigned.filter((index) => index > rows.length);
  const steps: z.infer<typeof executionReviewSchema>['steps'] = options.prescription.steps.map(
    (step, position) => {
      const missingIndexes = step.actual_interval_indexes.filter((index) => index > rows.length);
      const selected = step.actual_interval_indexes.flatMap((index) =>
        rows[index - 1] ? [rows[index - 1]!] : [],
      );
      const blocked = globalBlocked || missingIndexes.length > 0 || selected.length === 0;

      const total = (
        field: 'distance_m' | 'moving_time_s' | 'elapsed_time_s',
        sourceField: string,
        unit: string,
      ) => {
        const metric = totalMetric(
          selected.map((row) => nonnegative(row[field])),
          sourceField,
          unit,
          blocked,
        );
        return selected.length
          ? metric
          : { ...metric, known_sum: null, unavailable_reason: 'NO_MAPPED_INTERVALS' };
      };

      const distance = total('distance_m', 'icu_intervals.distance', 'm');
      const moving = total('moving_time_s', 'icu_intervals.moving_time', 's');
      const elapsed = total('elapsed_time_s', 'icu_intervals.elapsed_time', 's');
      const speed = selected.length === 1 ? positive(selected[0]!.average_speed_mps) : null;
      const pace = blocked
        ? null
        : selected.length === 1
          ? speed === null
            ? null
            : 1000 / speed
          : pooledSpeed(selected).pace_s_per_km;
      const duration = step.duration_basis === 'moving' ? moving.value : elapsed.value;
      let assessment: z.infer<typeof executionReviewSchema>['steps'][number]['pace_assessment'] =
        step.target_pace ? 'unavailable' : 'not_requested';
      let paceDifference: number | null = null;
      if (pace !== null && step.target_pace) {
        const lower = step.target_pace.min_s_per_km;
        const upper = step.target_pace.max_s_per_km;
        if (lower !== undefined && exceedsTolerance(lower, pace)) {
          assessment = 'faster_than_range';
          paceDifference = pace - lower;
        } else if (upper !== undefined && exceedsTolerance(pace, upper)) {
          assessment = 'slower_than_range';
          paceDifference = pace - upper;
        } else {
          assessment = 'within_range';
          paceDifference = 0;
        }
      }
      const reasons = [
        ...(globalBlocked ? ['COMPARISON_BLOCKED'] : []),
        ...(missingIndexes.length ? ['MISSING_SOURCE_INTERVALS'] : []),
        ...(!step.actual_interval_indexes.length ? ['NO_EXPLICIT_MAPPING'] : []),
        ...(step.target_distance_m !== undefined && distance.value === null
          ? ['DISTANCE_UNAVAILABLE']
          : []),
        ...(step.target_duration_s !== undefined && duration === null
          ? ['DURATION_UNAVAILABLE']
          : []),
        ...(step.target_pace && pace === null ? ['PACE_UNAVAILABLE'] : []),
      ];
      return {
        step_number: position + 1,
        role: step.role,
        targets: {
          distance_m: step.target_distance_m ?? null,
          duration_s: step.target_duration_s ?? null,
          duration_basis: step.duration_basis ?? null,
          pace: step.target_pace ?? null,
        },
        actual_interval_indexes: step.actual_interval_indexes,
        status: !step.actual_interval_indexes.length
          ? 'unmapped'
          : blocked
            ? 'unavailable'
            : reasons.length
              ? 'limited'
              : 'compared',
        actual: {
          distance_m: distance,
          moving_time_s: moving,
          elapsed_time_s: elapsed,
          pace_s_per_km: pace,
          pace_basis:
            pace === null
              ? 'unavailable'
              : selected.length === 1
                ? 'source_average_speed'
                : 'pooled_moving_time_distance',
        },
        distance_difference_m:
          distance.value !== null && step.target_distance_m !== undefined
            ? distance.value - step.target_distance_m
            : null,
        duration_difference_s:
          duration !== null && step.target_duration_s !== undefined
            ? duration - step.target_duration_s
            : null,
        pace_assessment: assessment,
        pace_difference_to_bound_s_per_km: paceDifference,
        reasons,
      };
    },
  );
  const activityDate = activity.start_local?.slice(0, 10) ?? null;
  const unassigned = rows.map((_, index) => index + 1).filter((index) => !assigned.includes(index));
  const spans = options.prescription.steps.map((step) => {
    const selected = step.actual_interval_indexes.map((index) => rows[index - 1]);
    if (
      !selected.length ||
      selected.some((row) => !row || row.start_time_s === null || row.end_time_s === null)
    ) {
      return null;
    }
    return {
      start: Math.min(...selected.map((row) => row!.start_time_s!)),
      end: Math.max(...selected.map((row) => row!.end_time_s!)),
    };
  });
  const orderDiffers = spans.some(
    (span, index) =>
      span !== null &&
      spans.slice(0, index).some((previous) => previous !== null && previous.end > span.start),
  );
  const orderVerified = !globalBlocked && spans.every((span) => span !== null) && !orderDiffers;
  const reasons = [
    ...(!supported ? ['UNSUPPORTED_SPORT'] : []),
    ...(!confirmed ? ['UNCONFIRMED_PLAN_ACTIVITY_MATCH'] : []),
    ...(intervalAnalysis.data_quality.intervals_truncated ? ['TRUNCATED_INTERVALS'] : []),
    ...(timingBlocked ? ['INVALID_OR_OVERLAPPING_TIMING'] : []),
    ...(missing.length ? ['MISSING_SOURCE_INTERVALS'] : []),
    ...(options.prescription.completeness === 'partial' ? ['PARTIAL_PRESCRIPTION'] : []),
    ...(options.prescription.scheduled_date === undefined
      ? ['PRESCRIPTION_DATE_UNAVAILABLE']
      : activityDate === null
        ? ['ACTIVITY_DATE_UNAVAILABLE']
        : activityDate !== options.prescription.scheduled_date
          ? ['SCHEDULE_DATE_DIFFERS']
          : []),
    ...(steps.some((step) => step.status !== 'compared') ? ['INCOMPLETE_STEP_COMPARISON'] : []),
    ...(unassigned.length ? ['UNASSIGNED_SOURCE_INTERVALS'] : []),
    ...(orderDiffers
      ? ['STEP_ORDER_DIFFERS']
      : steps.length > 1 && !orderVerified
        ? ['UNVERIFIED_STEP_ORDER']
        : []),
  ];
  return {
    method_version: 'running-execution/1.0.0',
    status: !supported
      ? 'unsupported_sport'
      : !confirmed
        ? 'unconfirmed_match'
        : reasons.length
          ? 'limited'
          : 'ok',
    match_basis: options.match_basis,
    prescription_origin: 'supplied_for_this_request',
    reported_source: options.prescription.reported_source,
    extraction_basis: options.prescription.extraction_basis,
    scheduled_date: options.prescription.scheduled_date ?? null,
    activity_date: activityDate,
    prescription_completeness: options.prescription.completeness,
    steps,
    data_quality: {
      returned_interval_count: rows.length,
      supplied_step_count: steps.length,
      mapped_step_count: steps.filter(
        (step) =>
          step.actual_interval_indexes.length > 0 &&
          step.actual_interval_indexes.every((index) => index <= rows.length),
      ).length,
      compared_step_count: steps.filter((step) => step.status === 'compared').length,
      missing_interval_indexes: missing,
      unassigned_interval_indexes: unassigned,
      intervals_truncated: intervalAnalysis.data_quality.intervals_truncated,
      chronological_step_order_verified: orderVerified,
      step_order_differs: orderDiffers,
      reasons,
    },
    provenance: {
      actual_metrics: source('icu_intervals', 'm, s, m/s; nullable source metrics'),
      differences: computed(
        'actual - supplied target; positive pace difference means slower; pace bound difference is zero within supplied range',
        'm, s, s/km',
      ),
      single_interval_pace: computed(
        '1000 / positive source average_speed',
        's/km',
        'icu_intervals.average_speed',
      ),
      multiple_interval_pace: computed(
        '1000 * sum moving_time / sum distance; all positive values required',
        's/km',
        'icu_intervals.distance, icu_intervals.moving_time',
      ),
    },
    limitations: [
      'This is a stateless comparison of an existing supplied prescription, not plan creation, storage, rescheduling or adaptation. The server reads only Intervals.icu; it does not fetch or authenticate any prescription provider. Source labels never select connectors or trigger network access.',
      'Targets are supplied operands, not computed targets or verified provider provenance. Reported source, extraction, completeness and match basis are caller assertions.',
      'Mapping and plan/activity association must come from an explicit source link or athlete confirmation; names/dates alone do not prove a match. Interval indexes are 1-based source positions, never guessed from pace or labels.',
      'Partial structured exports must not be treated as complete. Description-derived targets remain labeled; missing targets or mappings are unknown, not failed or skipped repetitions. Compared-step counts describe supplied steps, not whole-plan adherence.',
      'Interval-average pace can be compared with a prescribed range; it does not measure time in range or instantaneous pace. Multiple source intervals can map to one planned step, but one interval cannot be split into multiple steps without streams.',
      'Duration uses the explicitly selected moving/elapsed field, never one substituted for the other. No overall execution score, physiological fatigue inference, race prediction or guaranteed device-lap structure.',
    ],
  };
}
