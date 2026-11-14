import { z } from 'zod';
import { activityOutputSchema } from '../domain/models';
import { rangeShape } from '../utils/dates';

export const METHOD_VERSION = 'endurance-analytics/0.2.0' as const;

const finite = z.number().finite();

export const nullableMetric = finite.nullable();

export const rangeSchema = z.object(rangeShape).strict();

/** Analytics-only additions keep the seven original tool contracts unchanged. */
export const analyticsActivitySchema = activityOutputSchema.extend({
  source_efficiency_factor: nullableMetric,
  source_decoupling: nullableMetric,
  trainer: z.boolean().nullable(),
  source_sub_type: z.string().nullable(),
  ignore_hr: z.boolean(),
});

export type AnalyticsActivity = z.infer<typeof analyticsActivitySchema>;

export const provenanceSchema = z.object({
  origin: z.enum(['intervals_source', 'computed']),
  source_field: z.string().nullable(),
  method: z.string().nullable(),
  unit: z.string(),
});

export const metricSchema = z.object({
  value: nullableMetric,
  known_sum: nullableMetric,
  recorded_count: z.number().int().nonnegative(),
  missing_count: z.number().int().nonnegative(),
  complete_returned_records: z.boolean(),
  unavailable_reason: z.string().nullable(),
  provenance: provenanceSchema,
});

export type Metric = z.infer<typeof metricSchema>;

export const decisionSchema = z.object({
  activity_id: z.string(),
  outcome: z.enum(['eligible', 'eligible_with_caveats', 'excluded', 'insufficient_data']),
  reasons: z.array(z.string()),
  missing_fields: z.array(z.string()),
});

export type Decision = z.infer<typeof decisionSchema>;

export interface Coverage {
  /** Only a trusted caller with an independent inventory may set verified; the MCP adapter never does. */
  inventory: 'verified' | 'unknown' | 'partial';
  saturated: boolean;
}

export interface AnalysisContext {
  range: z.infer<typeof rangeSchema>;
  timezone: string;
  /** Injected local day makes pure computations independent of the wall clock and server timezone. */
  today: string;
  coverage: Coverage;
}

export const qualitySchema = z.object({
  requested_range: rangeSchema,
  actual_activity_range: rangeSchema.nullable(),
  athlete_timezone: z.string(),
  current_day_included: z.boolean(),
  future_days_included: z.boolean(),
  retrieved_count: z.number().int().nonnegative(),
  unique_count: z.number().int().nonnegative(),
  eligible_count: z.number().int().nonnegative(),
  excluded_count: z.number().int().nonnegative(),
  missing_required_count: z.number().int().nonnegative(),
  duplicate_record_count: z.number().int().nonnegative(),
  conflicting_ids: z.array(z.string()).max(1000),
  possible_overlap_count: z.number().int().nonnegative(),
  completeness: z.enum(['complete', 'uncertain', 'partial']),
  inventory_coverage: z.enum(['verified', 'unknown', 'partial']),
  metric_scope: z.literal('retrieved_records'),
  empty_status: z.enum([
    'not_empty',
    'no_eligible_activities',
    'no_activities_returned',
    'verified_zero_activities',
  ]),
  exclusion_reasons: z.record(z.string(), z.number().int().nonnegative()),
  missing_fields: z.array(z.string()),
  decisions: z.array(decisionSchema).max(100),
  decisions_truncated: z.boolean(),
  limitations: z.array(z.string()),
});

export type DataQuality = z.infer<typeof qualitySchema>;

export const analyticsContextShape = {
  source: z.literal('Intervals.icu'),
  retrieved_at: z.string(),
  method_version: z.literal(METHOD_VERSION),
  date_context: z.string(),
  warnings: z.array(z.string()),
};

export const statsSchema = z.object({
  sample_count: z.number().int().nonnegative(),
  mean: nullableMetric,
  median: nullableMetric,
  min: nullableMetric,
  max: nullableMetric,
  sample_standard_deviation: nullableMetric,
});

export const changeSchema = z.object({
  current: nullableMetric,
  baseline: nullableMetric,
  absolute_change: nullableMetric,
  percentage_change: nullableMetric,
  unavailable_reason: z.string().nullable(),
  provenance: provenanceSchema,
});
