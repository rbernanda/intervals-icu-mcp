import { describe, expect, it } from 'vitest';
import { comparePeriods, summarizePeriod } from '../../src/analytics/training-load';
import { normalizeFitness } from '../../src/intervals/normalizers';
import { context, run } from './fixtures';

describe('sport-neutral period summaries and comparisons', () => {
  it('sums distance, both durations and original source load with coverage and provenance', () => {
    const result = summarizePeriod(
      [run('a'), run('b', { sport_type: 'Ride', distance_m: 20000, training_load: 40 })],
      [],
      context,
    );
    expect(result.metrics.distance_m.value).toBe(30800);
    expect(result.metrics.moving_time_s.value).toBe(7200);
    expect(result.metrics.elapsed_time_s.value).toBe(7300);
    expect(result.metrics.training_load).toMatchObject({
      value: 100,
      known_sum: 100,
      recorded_count: 2,
      missing_count: 0,
      complete_returned_records: true,
      provenance: { origin: 'computed', source_field: 'Activity.icu_training_load' },
    });
    expect(result.metrics.average_load_per_activity.value).toBe(50);
    expect(result.metrics.longest_distance_m.value).toBe(20000);
    expect(result.metrics.weekly_distance_m.value).toBe(7700);
    expect(result.data_quality.completeness).toBe('uncertain');
    expect(result.data_quality.inventory_coverage).toBe('unknown');
  });

  it.each([
    [null, 60, 60, 1, 1],
    [null, null, null, 0, 2],
  ] as const)('preserves missing loads (%s, %s)', (a, b, known, recorded, missing) => {
    const result = summarizePeriod(
      [run('a', { training_load: a }), run('b', { training_load: b })],
      [],
      context,
    );
    expect(result.metrics.training_load).toMatchObject({
      value: null,
      known_sum: known,
      recorded_count: recorded,
      missing_count: missing,
      complete_returned_records: false,
    });
    expect(result.metrics.average_load_per_activity.value).toBeNull();
    expect(result.data_quality.missing_fields).toContain('training_load');
    expect(result.data_quality.missing_required_count).toBe(missing);
  });

  it('distinguishes empty returned data from independently verified zero-activity coverage', () => {
    const uncertain = summarizePeriod([], [], context);
    expect(uncertain.metrics.distance_m.value).toBe(0);
    expect(uncertain.data_quality.empty_status).toBe('no_activities_returned');
    expect(uncertain.metrics.average_load_per_activity.value).toBeNull();
    const verified = summarizePeriod([], [], {
      ...context,
      coverage: { inventory: 'verified', saturated: false },
    });
    expect(verified.data_quality).toMatchObject({
      empty_status: 'verified_zero_activities',
      completeness: 'complete',
    });
  });

  it('counts identical duplicate IDs once, quarantines conflicting IDs and retains distinct simultaneous sessions', () => {
    const identical = summarizePeriod([run('a'), { ...run('a') }, run('b')], [], context);
    expect(identical.metrics.activity_count.value).toBe(2);
    expect(identical.data_quality).toMatchObject({
      duplicate_record_count: 1,
      possible_overlap_count: 1,
    });
    const conflict = summarizePeriod([run('a'), run('a', { distance_m: 200 })], [], context);
    expect(conflict.metrics.distance_m.value).toBeNull();
    expect(conflict.data_quality).toMatchObject({
      conflicting_ids: ['a'],
      completeness: 'partial',
    });
    expect(conflict.data_quality.exclusion_reasons.CONFLICTING_DUPLICATE_ID).toBe(1);
  });

  it('filters running without combining other sports, supports unknown-to-code sport identifiers, and flags absent types', () => {
    const rows = [
      run('a'),
      run('b', { sport_type: 'Ride' }),
      run('c', { sport_type: 'Swim' }),
      run('d', { sport_type: 'FutureEnduranceSport' }),
    ];
    expect(summarizePeriod(rows, [], context, 'running').metrics.activity_count.value).toBe(1);
    expect(
      summarizePeriod(rows, [], context, 'futureendurancesport').metrics.activity_count.value,
    ).toBe(1);
    expect(summarizePeriod(rows, [], context).metrics.activity_count.value).toBe(4);
    const missing = summarizePeriod([run('a', { sport_type: null })], [], context, 'running');
    expect(missing.metrics.distance_m.value).toBeNull();
    expect(missing.data_quality.exclusion_reasons.UNKNOWN_SPORT).toBe(1);
  });

  it('blocks complete totals for saturation, partial inventory or restricted undated stubs', () => {
    for (const coverage of [
      { inventory: 'partial' as const, saturated: true },
      { inventory: 'partial' as const, saturated: false },
    ]) {
      const result = summarizePeriod([run()], [], { ...context, coverage });
      expect(result.metrics.distance_m).toMatchObject({
        value: null,
        known_sum: 10800,
        complete_returned_records: false,
      });
      expect(result.data_quality.completeness).toBe('partial');
    }
    expect(
      summarizePeriod([run('stub', { start_local: null })], [], context).metrics.activity_count
        .value,
    ).toBeNull();
  });

  it('maps source CTL/ATL and distinctly named same-day form without using activity CTL or load approximations', () => {
    const fitness = [
      normalizeFitness({ id: '2026-02-27', ctl: 45, atl: 62, ctlLoad: 100, atlLoad: 101 }),
    ];
    const result = summarizePeriod([run()], fitness, context, 'running');
    expect(result.fitness).toMatchObject({
      date: '2026-02-27',
      stale_days: 1,
      fitness_ctl: 45,
      fatigue_atl: 62,
      source_form_tsb: null,
      computed_same_day_form: -17,
      provenance: {
        fitness_ctl: { origin: 'intervals_source', source_field: 'Wellness.ctl' },
        computed_same_day_form: { origin: 'computed' },
      },
    });
    expect(
      summarizePeriod([], [normalizeFitness({ id: '2026-02-28', ctl: 45 })], context).fitness
        .computed_same_day_form,
    ).toBeNull();
  });

  it('compares explicit periods and explains unequal durations/current-day limitations', () => {
    const baseline = { ...context, range: { start_date: '2026-01-25', end_date: '2026-01-31' } };
    const result = comparePeriods(
      [run('a', { distance_m: 50000 })],
      [run('b', { start_local: '2026-01-26T08:00:00', distance_m: 40000 })],
      [],
      [],
      context,
      baseline,
      'running',
    );
    expect(result.changes.distance_m).toMatchObject({
      absolute_change: 10000,
      percentage_change: 25,
    });
    expect(result.comparison_validity).toBe('limited');
    expect(result.current.metrics.weekly_distance_m.value).toBe(12500);
    expect(result.baseline.metrics.weekly_distance_m.value).toBe(40000);
    expect(
      summarizePeriod([run()], [], { ...context, today: '2026-02-28' }).data_quality
        .current_day_included,
    ).toBe(true);
  });

  it('produces identical numerical and quality output for reordered normalized inputs', () => {
    const a = run('a');
    const b = run('b', { start_local: '2026-02-25T08:00:00', training_load: 0 });
    expect(summarizePeriod([a, b, a], [], context)).toEqual(
      summarizePeriod([b, a, a], [], context),
    );
  });

  it('quarantines conflicting same-day wellness values rather than choosing fitness by input order', () => {
    const rows = [
      normalizeFitness({ id: '2026-02-28', ctl: 45, atl: 60 }),
      normalizeFitness({ id: '2026-02-28', ctl: 46, atl: 62 }),
    ];
    const result = summarizePeriod([], rows, context);
    expect(result.fitness).toMatchObject({
      date: '2026-02-28',
      fitness_ctl: null,
      fatigue_atl: null,
      computed_same_day_form: null,
      unavailable_reason: 'CONFLICTING_FITNESS_RECORDS',
    });
    expect(result).toEqual(summarizePeriod([], [...rows].reverse(), context));
  });
});
