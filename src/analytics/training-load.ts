import { z } from 'zod';
import { matchesSport, type Fitness } from '../domain/models';
import { daysBetween, inRange } from '../utils/dates';
import {
  metricSchema,
  nullableMetric,
  provenanceSchema,
  qualitySchema,
  rangeSchema,
  changeSchema,
  type AnalysisContext,
  type AnalyticsActivity,
  type Metric,
} from './contracts';
import { computed, derivedMetric, difference, source, totalMetric } from './core';
import { dataQuality, prepareActivities, structuralGap, validatePeriods } from './data-quality';

const fitnessContextSchema = z.object({
  date: z.string().nullable(),
  stale_days: z.number().int().nonnegative().nullable(),
  fitness_ctl: nullableMetric,
  fatigue_atl: nullableMetric,
  source_form_tsb: z.null(),
  computed_same_day_form: nullableMetric,
  unavailable_reason: z.string().nullable(),
  provenance: z.object({
    fitness_ctl: provenanceSchema,
    fatigue_atl: provenanceSchema,
    computed_same_day_form: provenanceSchema,
  }),
});

const metricNames = [
  'activity_count',
  'distance_m',
  'moving_time_s',
  'elapsed_time_s',
  'training_load',
  'average_load_per_activity',
  'longest_distance_m',
  'weekly_distance_m',
  'weekly_moving_time_s',
] as const;

const metricMapSchema = z.object(
  Object.fromEntries(metricNames.map((name) => [name, metricSchema])) as Record<
    (typeof metricNames)[number],
    typeof metricSchema
  >,
);

export const periodSummarySchema = z.object({
  range: rangeSchema,
  inclusive_days: z.number().int().positive(),
  metrics: metricMapSchema,
  fitness: fitnessContextSchema,
  data_quality: qualitySchema,
});

export const periodComparisonSchema = z.object({
  sport_filter: z.string().nullable(),
  current: periodSummarySchema,
  baseline: periodSummarySchema,
  changes: z.object(
    Object.fromEntries(metricNames.map((name) => [name, changeSchema])) as Record<
      (typeof metricNames)[number],
      typeof changeSchema
    >,
  ),
  fitness_changes: z.object({
    fitness_ctl: changeSchema,
    fatigue_atl: changeSchema,
    computed_same_day_form: changeSchema,
  }),
  comparison_validity: z.enum(['comparable_returned_records', 'limited']),
  limitations: z.array(z.string()),
});

/** End-date context uses the latest available in-period source row; it never reconstructs/interpolates CTL or ATL. */
function fitnessContext(
  rows: readonly Fitness[],
  context: AnalysisContext,
): z.infer<typeof fitnessContextSchema> {
  const latest = [...rows]
    .filter((row) => inRange(row.date, context.range))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const sameDate = latest ? rows.filter((row) => row.date === latest.date) : [];
  const conflicting =
    new Set(sameDate.map((row) => JSON.stringify([row.fitness_ctl, row.fatigue_atl]))).size > 1;
  const ctl = conflicting ? null : (latest?.fitness_ctl ?? null);
  const atl = conflicting ? null : (latest?.fatigue_atl ?? null);
  return {
    date: latest?.date ?? null,
    stale_days: latest ? daysBetween(latest.date, context.range.end_date) : null,
    fitness_ctl: ctl,
    fatigue_atl: atl,
    source_form_tsb: null,
    computed_same_day_form: ctl !== null && atl !== null ? ctl - atl : null,
    unavailable_reason: conflicting
      ? 'CONFLICTING_FITNESS_RECORDS'
      : !latest
        ? 'NO_FITNESS_RECORD'
        : ctl === null || atl === null
          ? 'MISSING_FITNESS_VALUE'
          : null,
    provenance: {
      fitness_ctl: source('Wellness.ctl', 'source training-load units'),
      fatigue_atl: source('Wellness.atl', 'source training-load units'),
      computed_same_day_form: computed(
        'same-day ctl - atl; not source TSB or percentage form',
        'source training-load units',
        'Wellness.ctl,Wellness.atl',
      ),
    },
  };
}

export function summarizePeriod(
  rows: readonly AnalyticsActivity[],
  fitness: readonly Fitness[],
  context: AnalysisContext,
  sport?: string,
): z.infer<typeof periodSummarySchema> {
  const prepared = prepareActivities(rows, context);
  const selected = prepared.activities.filter((row) => matchesSport(row.sport_type, sport));
  const unknownSports = prepared.activities.some((row) => !row.sport_type);
  const blocked = structuralGap(prepared, context) || unknownSports;
  const duration = daysBetween(context.range.start_date, context.range.end_date) + 1;
  const distance = totalMetric(
    selected.map((a) => a.distance_m),
    'Activity.distance',
    'm',
    blocked,
  );
  const moving = totalMetric(
    selected.map((a) => a.moving_time_s),
    'Activity.moving_time',
    's',
    blocked,
  );
  const load = totalMetric(
    selected.map((a) => a.training_load),
    'Activity.icu_training_load',
    'source training-load units',
    blocked,
  );
  const count: Metric = {
    value: blocked ? null : selected.length,
    known_sum: selected.length,
    recorded_count: selected.length,
    missing_count: 0,
    complete_returned_records: !blocked,
    unavailable_reason: blocked ? 'INCOMPLETE_COVERAGE' : null,
    provenance: computed(
      'count unique selected returned activity IDs',
      'activities',
      'Activity.id',
    ),
  };
  const decisions = prepared.activities.map((a) => ({
    activity_id: a.id,
    outcome: !a.sport_type
      ? ('insufficient_data' as const)
      : matchesSport(a.sport_type, sport)
        ? ('eligible' as const)
        : ('excluded' as const),
    reasons: !a.sport_type
      ? ['UNKNOWN_SPORT']
      : matchesSport(a.sport_type, sport)
        ? []
        : ['SPORT_FILTER'],
    missing_fields: !a.sport_type ? ['sport_type'] : [],
  }));
  for (const decision of decisions) {
    if (decision.outcome === 'eligible') {
      const row = selected.find((a) => a.id === decision.activity_id)!;
      decision.missing_fields.push(
        ...(['distance_m', 'moving_time_s', 'training_load'] as const).filter(
          (key) => row[key] === null,
        ),
      );
      if (decision.missing_fields.length) {
        decision.reasons.push('MISSING_AGGREGATION_METRICS');
      }
    }
  }
  const metrics = {
    activity_count: count,
    distance_m: distance,
    moving_time_s: moving,
    elapsed_time_s: totalMetric(
      selected.map((a) => a.elapsed_time_s),
      'Activity.elapsed_time',
      's',
      blocked,
    ),
    training_load: load,
    average_load_per_activity: derivedMetric(
      load,
      'sum source load / selected activity count',
      'source training-load units/activity',
      (value) => (selected.length ? value / selected.length : null),
    ),
    longest_distance_m: derivedMetric(
      distance,
      'maximum recorded activity distance; requires all selected distances',
      'm',
      () => (selected.length ? Math.max(...selected.map((a) => a.distance_m!)) : null),
    ),
    weekly_distance_m: derivedMetric(
      distance,
      'distance_m * 7 / inclusive_days',
      'm/week',
      (value) => (value * 7) / duration,
    ),
    weekly_moving_time_s: derivedMetric(
      moving,
      'moving_time_s * 7 / inclusive_days',
      's/week',
      (value) => (value * 7) / duration,
    ),
  };
  if (!selected.length && !blocked) {
    metrics.average_load_per_activity.unavailable_reason = 'NO_ACTIVITIES';
    metrics.longest_distance_m.unavailable_reason = 'NO_ACTIVITIES';
  }

  return {
    range: context.range,
    inclusive_days: duration,
    metrics,
    fitness: fitnessContext(fitness, context),
    data_quality: dataQuality(prepared, context, decisions),
  };
}

export function comparePeriods(
  currentRows: readonly AnalyticsActivity[],
  baselineRows: readonly AnalyticsActivity[],
  currentFitness: readonly Fitness[],
  baselineFitness: readonly Fitness[],
  currentContext: AnalysisContext,
  baselineContext: AnalysisContext,
  sport?: string,
): z.infer<typeof periodComparisonSchema> {
  validatePeriods(currentContext.range, baselineContext.range);
  const current = summarizePeriod(currentRows, currentFitness, currentContext, sport);
  const baseline = summarizePeriod(baselineRows, baselineFitness, baselineContext, sport);
  const changes = Object.fromEntries(
    metricNames.map((name) => [
      name,
      difference(
        current.metrics[name].value,
        baseline.metrics[name].value,
        current.metrics[name].provenance.unit,
      ),
    ]),
  ) as z.infer<typeof periodComparisonSchema>['changes'];
  const fitnessChanges = {
    fitness_ctl: difference(
      current.fitness.fitness_ctl,
      baseline.fitness.fitness_ctl,
      'source training-load units',
    ),
    fatigue_atl: difference(
      current.fitness.fatigue_atl,
      baseline.fitness.fatigue_atl,
      'source training-load units',
    ),
    computed_same_day_form: difference(
      current.fitness.computed_same_day_form,
      baseline.fitness.computed_same_day_form,
      'source training-load units',
    ),
  };
  const unequal = current.inclusive_days !== baseline.inclusive_days;
  const limited =
    unequal ||
    [current, baseline].some(
      (p) =>
        p.data_quality.current_day_included ||
        p.data_quality.future_days_included ||
        p.data_quality.completeness === 'partial',
    );

  return {
    sport_filter: sport ?? null,
    current,
    baseline,
    changes,
    fitness_changes: fitnessChanges,
    comparison_validity: limited ? 'limited' : 'comparable_returned_records',
    limitations: [
      'All sums and changes describe returned records, not independently verified total real-world training. Source training-load methods may vary between activities.',
      'Fitness context is all-sport; source values are not reconstructed from activity loads. No source daily TSB is documented.',
      ...(unequal
        ? [
            'Unequal day counts: raw totals are not matched exposure; weekly-normalized volume is descriptive, not extrapolated completed training.',
          ]
        : []),
      ...(limited
        ? ['Partial days or incomplete/unequal coverage limit period comparability.']
        : []),
    ],
  };
}
