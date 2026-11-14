import { describe, expect, it } from 'vitest';
import {
  difference,
  nonnegative,
  pooledSpeed,
  positive,
  statistics,
  sum,
  totalMetric,
} from '../../src/analytics/core';
import { paceSecondsPerKm } from '../../src/domain/models';
import { activitySchema } from '../../src/intervals/schemas';
import { normalizeAnalyticsActivity } from '../../src/intervals/analytics-normalizer';

describe('deterministic numerical foundation', () => {
  it.each([
    [40000, 50000, 10000, 25],
    [50000, 40000, -10000, -20],
    [0, 10000, 10000, null],
    [10000, 0, -10000, -100],
  ])('compares baseline %s to current %s', (baseline, current, absolute, percent) => {
    expect(difference(current, baseline, 'm')).toMatchObject({
      absolute_change: absolute,
      percentage_change: percent,
    });
  });

  it('explains zero/missing/negative baseline percentages without losing absolute changes', () => {
    expect(difference(10, 0, 'm').unavailable_reason).toBe('ZERO_BASELINE');
    expect(difference(10, null, 'm')).toMatchObject({
      absolute_change: null,
      percentage_change: null,
      unavailable_reason: 'MISSING_VALUE',
    });
    expect(difference(null, 10, 'm').absolute_change).toBeNull();
    expect(difference(-16, -5, 'source units')).toMatchObject({
      absolute_change: -11,
      percentage_change: null,
      unavailable_reason: 'NONPOSITIVE_BASELINE',
    });
    expect(difference(Number.NaN, 10, 'm').absolute_change).toBeNull();
  });

  it('rejects invalid external numerical values and preserves zeros only where meaningful', () => {
    for (const value of [-1, Number.NaN, Infinity, null]) {
      expect(nonnegative(value)).toBeNull();
      expect(positive(value)).toBeNull();
    }
    expect(nonnegative(0)).toBe(0);
    expect(positive(0)).toBeNull();
    expect(() => activitySchema.parse({ id: 'a', distance: -1 })).toThrow();
    expect(() => activitySchema.parse({ id: 'a', moving_time: Infinity })).toThrow();
  });

  it('retains physical units, nulls and source EF independently from the proxy', () => {
    const row = normalizeAnalyticsActivity({
      id: 'a',
      distance: 5000,
      moving_time: 1500,
      elapsed_time: 1600,
      average_speed: 10 / 3,
      average_cadence: 80,
      type: 'Run',
      icu_efficiency_factor: 1.7,
      decoupling: -2,
    });
    expect(row).toMatchObject({
      distance_m: 5000,
      moving_time_s: 1500,
      elapsed_time_s: 1600,
      average_pace_s_per_km: 300,
      source_efficiency_factor: 1.7,
      source_decoupling: -2,
      average_cadence_spm: 160,
    });
    expect(row.average_heart_rate_bpm).toBeNull();
    expect(paceSecondsPerKm(0)).toBeNull();
  });

  it('pools distance/time rather than averaging pace or session speed blindly', () => {
    const result = pooledSpeed([
      { distance_m: 1000, moving_time_s: 300 },
      { distance_m: 10000, moving_time_s: 3600 },
    ]);
    expect(result.speed_mps).toBeCloseTo(11000 / 3900, 12);
    expect(result.pace_s_per_km).toBeCloseTo(3900 / 11, 12);
    expect(result.pace_s_per_km).not.toBe(330);
    expect(pooledSpeed([{ distance_m: 0, moving_time_s: 100 }]).pace_s_per_km).toBeNull();
    expect(pooledSpeed([{ distance_m: 100, moving_time_s: null }]).speed_mps).toBeNull();
    expect(pooledSpeed([]).speed_mps).toBeNull();
  });

  it('keeps precision and uses sample variability, including empty and single observations', () => {
    expect(sum([1e16, 1, -1e16])).toBe(1);
    expect(sum([0.1, 0.2])).toBeCloseTo(0.3, 14);
    expect(statistics([1, 2, 3])).toMatchObject({
      mean: 2,
      median: 2,
      sample_standard_deviation: 1,
    });
    expect(statistics([1, 2]).median).toBe(1.5);
    expect(statistics([1]).sample_standard_deviation).toBeNull();
    expect(statistics([]).mean).toBeNull();
    expect(totalMetric([5, null, -1], 'source', 'm')).toMatchObject({
      value: null,
      known_sum: 5,
      missing_count: 2,
    });
  });
});
