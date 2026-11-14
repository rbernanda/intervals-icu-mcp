import { METHOD_VERSION } from '../../analytics/contracts';
import { resolveContext, validatePeriods } from '../../analytics/data-quality';
import { comparePeriods } from '../../analytics/training-load';
import { analyzeAerobicEfficiency } from '../../analytics/sports/running/aerobic-efficiency';
import { compareRunningWorkouts } from '../../analytics/sports/running/workout-comparability';
import type { IntervalsClient } from '../../intervals/client';
import { MAX_ACTIVITIES } from '../../intervals/client';
import { normalizeAnalyticsActivity } from '../../intervals/analytics-normalizer';
import { normalizeFitness } from '../../intervals/normalizers';
import { checkRange, type DateRange } from '../../utils/dates';
import { analyticsInputs, analyticsOutputs } from './contracts';

/** Request-scoped orchestration only: all numerical/domain functions remain network- and environment-free. */
export class AnalyticsService {
  constructor(
    private readonly client: IntervalsClient,
    private readonly options: { timezone: string; now: () => Date },
  ) {}

  private context(now: Date) {
    return {
      source: 'Intervals.icu' as const,
      retrieved_at: now.toISOString(),
      method_version: METHOD_VERSION,
      date_context: `Inclusive athlete-local calendar dates in ${this.options.timezone}; current day is partial. Date arithmetic counts calendar days across DST.`,
      warnings: [
        'Read data_quality and provenance before interpretation. API success does not certify synchronization completeness. No physiological diagnosis or prediction is produced.',
      ],
    };
  }

  private async activities(range: DateRange, now: Date) {
    const context = resolveContext(range, this.options.timezone, now);
    const rows = await this.client.activities(range);
    context.coverage.saturated = rows.length > MAX_ACTIVITIES;
    if (context.coverage.saturated) {
      context.coverage.inventory = 'partial';
    }

    return { activities: rows.map(normalizeAnalyticsActivity), context };
  }

  async compare(args: unknown) {
    const input = analyticsInputs.compare.parse(args);
    validatePeriods(input.current, input.baseline);
    const now = this.options.now();
    // Validate timezone before even the parallel wellness requests begin.
    resolveContext(input.current, this.options.timezone, now);
    const [current, baseline, currentFitness, baselineFitness] = await Promise.all([
      this.activities(input.current, now),
      this.activities(input.baseline, now),
      this.client.wellness(input.current),
      this.client.wellness(input.baseline),
    ]);

    return analyticsOutputs.compare.parse({
      ...this.context(now),
      analysis: comparePeriods(
        current.activities,
        baseline.activities,
        currentFitness.map(normalizeFitness),
        baselineFitness.map(normalizeFitness),
        current.context,
        baseline.context,
        input.sport_type,
      ),
    });
  }

  async efficiency(args: unknown) {
    const input = analyticsInputs.efficiency.parse(args);
    const now = this.options.now();
    const range = checkRange({ start_date: input.start_date, end_date: input.end_date });
    const { activities, context } = await this.activities(range, now);

    return analyticsOutputs.efficiency.parse({
      ...this.context(now),
      analysis: analyzeAerobicEfficiency(activities, context, input),
    });
  }

  async workouts(args: unknown) {
    const input = analyticsInputs.workouts.parse(args);
    const now = this.options.now();
    const range = checkRange({ start_date: input.start_date, end_date: input.end_date });
    const { activities, context } = await this.activities(range, now);

    return analyticsOutputs.workouts.parse({
      ...this.context(now),
      analysis: compareRunningWorkouts(activities, context, input),
    });
  }
}
