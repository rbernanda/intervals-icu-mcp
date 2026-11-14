import { z } from 'zod';
import { daysBetween, shiftDate } from '../../../utils/dates';
import {
  nullableMetric,
  provenanceSchema,
  qualitySchema,
  statsSchema,
  changeSchema,
  type AnalyticsActivity,
  type AnalysisContext,
  type Decision,
} from '../../contracts';
import { computed, difference, exceedsTolerance, statistics } from '../../core';
import { dataQuality, prepareActivities } from '../../data-quality';
import { runningProvenance, workoutSample, workoutSampleSchema } from './metrics';
import { isEligible, runningEligibility, type RunningSettings } from './eligibility';

export interface EfficiencyOptions {
  sport_type: string;
  steady_aerobic_activity_ids: string[];
  settings: RunningSettings;
  min_samples: number;
  change_tolerance_percent: number;
  max_average_hr_bpm?: number;
}

export const efficiencyTrendSchema = z.object({
  status: z.enum(['ok', 'insufficient_evidence', 'unsupported_sport']),
  observed_direction: z.enum(['increase', 'decrease', 'within_tolerance', 'unavailable']),
  reference_activity_id: z.string().nullable(),
  settings: z.object({
    min_samples: z.number().int(),
    change_tolerance_percent: z.number(),
    max_average_hr_bpm: nullableMetric,
  }),
  selection_settings: z.record(z.string(), z.union([z.number(), z.boolean()])),
  split_date: z.string(),
  early: statsSchema,
  later: statsSchema,
  overall: statsSchema,
  proxy_change: changeSchema,
  samples: z
    .array(workoutSampleSchema.extend({ speed_hr_proxy: z.number().finite().positive() }))
    .max(100),
  provenance: z.record(z.string(), provenanceSchema),
  data_quality: qualitySchema,
  limitations: z.array(z.string()),
});

/** Equal-session means in disjoint calendar halves; source efficiency factor is never used in this computation. */
export function analyzeAerobicEfficiency(
  rows: readonly AnalyticsActivity[],
  context: AnalysisContext,
  options: EfficiencyOptions,
): z.infer<typeof efficiencyTrendSchema> {
  const prepared = prepareActivities(rows, context);
  const supported = ['run', 'running', 'trailrun', 'virtualrun'].includes(
    options.sport_type.toLowerCase(),
  );
  const chosen = new Set(options.steady_aerobic_activity_ids);
  const forcedSettings = { ...options.settings, require_hr: true };
  const explicitlySelected = prepared.activities.filter((a) => chosen.has(a.id));

  const sportMatches = (row: AnalyticsActivity) =>
    ['run', 'running'].includes(options.sport_type.toLowerCase()) ||
    row.sport_type?.toLowerCase() === options.sport_type.toLowerCase();

  const reference = [...explicitlySelected]
    .reverse()
    .find(
      (row) =>
        sportMatches(row) &&
        isEligible(runningEligibility(row, forcedSettings)) &&
        !['RACE', 'WARMUP', 'COOLDOWN'].includes(row.source_sub_type ?? '') &&
        (options.max_average_hr_bpm === undefined ||
          row.average_heart_rate_bpm! <= options.max_average_hr_bpm),
    );
  const selected: AnalyticsActivity[] = [];
  const decisions: Decision[] = prepared.activities.map((row) => {
    const decision = runningEligibility(row, forcedSettings, reference);
    if (!supported) {
      decision.outcome = 'excluded';
      decision.reasons.push('UNSUPPORTED_SPORT_ANALYSIS');
    } else if (!sportMatches(row)) {
      decision.outcome = 'excluded';
      decision.reasons.push('SPORT_FILTER');
    } else if (!chosen.has(row.id)) {
      decision.outcome = 'excluded';
      decision.reasons.push('STEADY_AEROBIC_CLASSIFICATION_REQUIRED');
    } else if (!reference) {
      decision.outcome = 'insufficient_data';
      decision.reasons.push('NO_VALID_STEADY_AEROBIC_REFERENCE');
    } else if (
      row.source_sub_type === 'RACE' ||
      row.source_sub_type === 'WARMUP' ||
      row.source_sub_type === 'COOLDOWN'
    ) {
      decision.outcome = 'excluded';
      decision.reasons.push('SESSION_TYPE_MISMATCH');
    } else if (
      options.max_average_hr_bpm !== undefined &&
      row.average_heart_rate_bpm !== null &&
      row.average_heart_rate_bpm > options.max_average_hr_bpm
    ) {
      decision.outcome = 'excluded';
      decision.reasons.push('ABOVE_USER_HR_CEILING');
    }
    if (isEligible(decision)) {
      if (selected.length >= 100) {
        decision.outcome = 'excluded';
        decision.reasons.push('SAMPLE_LIMIT');
      } else {
        selected.push(row);
        decision.outcome = 'eligible_with_caveats';
        decision.reasons.push('STEADY_AEROBIC_PURPOSE_USER_ASSERTED_NOT_STREAM_VERIFIED');
      }
    }
    return decision;
  });
  for (const id of [...chosen].sort()) {
    if (
      !prepared.activities.some((a) => a.id === id) &&
      !prepared.decisions.some((d) => d.activity_id === id)
    ) {
      decisions.push({
        activity_id: id,
        outcome: 'insufficient_data',
        reasons: ['REQUESTED_ACTIVITY_NOT_RETURNED'],
        missing_fields: ['activity_record'],
      });
    }
  }

  const days = daysBetween(context.range.start_date, context.range.end_date) + 1;
  const split = shiftDate(context.range.start_date, Math.floor(days / 2));
  const samples = selected.map((row) => ({
    ...workoutSample(row),
    speed_hr_proxy: row.average_speed_mps! / row.average_heart_rate_bpm!,
  }));
  const early = statistics(samples.filter((s) => s.date < split).map((s) => s.speed_hr_proxy));
  const later = statistics(samples.filter((s) => s.date >= split).map((s) => s.speed_hr_proxy));
  const enough =
    supported &&
    samples.length >= options.min_samples &&
    early.sample_count >= 2 &&
    later.sample_count >= 2;
  const change = difference(enough ? later.mean : null, enough ? early.mean : null, '(m/s)/bpm');
  const percent = change.percentage_change;

  return {
    status: !supported ? 'unsupported_sport' : enough ? 'ok' : 'insufficient_evidence',
    observed_direction:
      percent === null
        ? 'unavailable'
        : !exceedsTolerance(Math.abs(percent), options.change_tolerance_percent)
          ? 'within_tolerance'
          : percent > 0
            ? 'increase'
            : 'decrease',
    reference_activity_id: reference?.id ?? null,
    settings: {
      min_samples: options.min_samples,
      change_tolerance_percent: options.change_tolerance_percent,
      max_average_hr_bpm: options.max_average_hr_bpm ?? null,
    },
    selection_settings: forcedSettings,
    split_date: split,
    early,
    later,
    overall: statistics(samples.map((s) => s.speed_hr_proxy)),
    proxy_change: change,
    samples,
    provenance: {
      ...runningProvenance,
      speed_hr_proxy: computed(
        'average_speed_mps / average_heart_rate_bpm',
        '(m/s)/bpm',
        'Activity.average_speed,Activity.average_heartrate',
      ),
      early: computed(
        'equal-session proxy statistics before split_date; sample SD n-1',
        '(m/s)/bpm',
      ),
      later: computed(
        'equal-session proxy statistics on/after split_date; sample SD n-1',
        '(m/s)/bpm',
      ),
      overall: computed(
        'equal-session proxy statistics over selected sessions; sample SD n-1',
        '(m/s)/bpm',
      ),
    },
    data_quality: dataQuality(prepared, context, decisions),
    limitations: [
      'Observational speed/HR proxy, not measured running economy, oxygen cost, source efficiency factor or a physiological adaptation test.',
      'Only explicitly selected steady-aerobic IDs qualify. Caller classification must reflect athlete context, not activity names alone. Streams are not inspected; intervals/mixed effort may invalidate an assertion.',
      'Default 30-minute minimum and anchor-relative 25% distance/duration, 10 bpm HR and 10 m/km elevation tolerances are configurable selection heuristics, not physiological cutoffs.',
      'At least four eligible sessions and two in each calendar half are required; equality within the configured tolerance means only no larger observed change.',
      'Weather, terrain, devices, HR lag, pauses and within-session intensity remain potential confounders. Missing elevation/setting is reported, never inferred.',
      'No causal inference, extrapolation, custom drift algorithm or race prediction is performed.',
    ],
  };
}
