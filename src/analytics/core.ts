import type { Metric, metricSchema, provenanceSchema } from './contracts';
import type { z } from 'zod';
import { paceSecondsPerKm } from '../domain/models';

const BOUNDARY_ROUNDING_ULPS = 32;

/** Inclusive configured boundaries tolerate floating-point roundoff, without rounding the reported values. */
export function exceedsTolerance(value: number, limit: number): boolean {
  const rounding =
    Number.EPSILON * BOUNDARY_ROUNDING_ULPS * Math.max(1, Math.abs(value), Math.abs(limit));
  return value - limit > rounding;
}

export function nonnegative(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

export function positive(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

/** Neumaier summation reduces cancellation/rounding error; no presentation rounding enters calculations. */
export function sum(values: readonly number[]): number {
  let total = 0;
  let correction = 0;
  for (const value of values) {
    const next = total + value;
    correction += Math.abs(total) >= Math.abs(value) ? total - next + value : value - next + total;
    total = next;
  }

  return total + correction;
}

export function mean(values: readonly number[]): number | null {
  return values.length ? sum(values) / values.length : null;
}

export function statistics(values: readonly number[]) {
  const average = mean(values);
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return {
    sample_count: values.length,
    mean: average,
    median: sorted.length
      ? sorted.length % 2
        ? sorted[middle]!
        : (sorted[middle - 1]! + sorted[middle]!) / 2
      : null,
    min: sorted[0] ?? null,
    max: sorted.at(-1) ?? null,
    sample_standard_deviation:
      average !== null && values.length > 1
        ? Math.sqrt(sum(values.map((value) => (value - average) ** 2)) / (values.length - 1))
        : null,
  };
}

export function computed(
  method: string,
  unit: string,
  sourceField: string | null = null,
): z.infer<typeof provenanceSchema> {
  return { origin: 'computed', method, unit, source_field: sourceField };
}

export function source(sourceField: string, unit: string): z.infer<typeof provenanceSchema> {
  return { origin: 'intervals_source', source_field: sourceField, unit, method: null };
}

/** A subtotal stays visible when missing metrics or structural coverage prevent a complete returned-record total. */
export function totalMetric(
  values: readonly (number | null)[],
  sourceField: string,
  unit: string,
  blocked = false,
): Metric {
  const recorded = values.map(nonnegative).filter((value): value is number => value !== null);
  const missing = values.length - recorded.length;

  return {
    value: !blocked && missing === 0 ? sum(recorded) : null,
    known_sum: recorded.length || values.length === 0 ? sum(recorded) : null,
    recorded_count: recorded.length,
    missing_count: missing,
    complete_returned_records: !blocked && missing === 0,
    unavailable_reason: blocked ? 'INCOMPLETE_COVERAGE' : missing ? 'MISSING_VALUES' : null,
    provenance: computed('sum of returned records', unit, sourceField),
  };
}

export function derivedMetric(
  base: Metric,
  method: string,
  unit: string,
  calculate: (value: number) => number | null,
): z.infer<typeof metricSchema> {
  return {
    ...base,
    value: base.value === null ? null : calculate(base.value),
    known_sum: null,
    provenance: computed(method, unit, base.provenance.source_field),
  };
}

/** Zero baselines permit an absolute difference but never a percentage. Signed fitness values are kept separate. */
export function difference(current: number | null, baseline: number | null, unit: string) {
  const valid =
    current !== null && baseline !== null && Number.isFinite(current) && Number.isFinite(baseline);
  const absolute = valid ? current - baseline : null;

  return {
    current,
    baseline,
    absolute_change: absolute,
    percentage_change:
      absolute !== null && baseline !== null && baseline > 0 ? (absolute / baseline) * 100 : null,
    unavailable_reason: !valid
      ? 'MISSING_VALUE'
      : baseline === 0
        ? 'ZERO_BASELINE'
        : baseline < 0
          ? 'NONPOSITIVE_BASELINE'
          : null,
    provenance: computed(
      'current - baseline; 100 * (current - baseline) / baseline when baseline > 0',
      unit,
    ),
  };
}

/** Distance/time pooling weights session speed by moving duration; arithmetic means of paces are not pooled pace. */
export function pooledSpeed(
  records: readonly { distance_m: number | null; moving_time_s: number | null }[],
) {
  if (
    !records.length ||
    records.some((row) => positive(row.distance_m) === null || positive(row.moving_time_s) === null)
  ) {
    return { speed_mps: null, pace_s_per_km: null };
  }

  const speed =
    sum(records.map((row) => row.distance_m!)) / sum(records.map((row) => row.moving_time_s!));
  return { speed_mps: speed, pace_s_per_km: paceSecondsPerKm(speed) };
}
