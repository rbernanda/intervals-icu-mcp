import { describe, expect, it } from 'vitest';
import {
  analyzeAerobicEfficiency,
  type EfficiencyOptions,
} from '../../src/analytics/sports/running/aerobic-efficiency';
import {
  compareRunningWorkouts,
  type WorkoutOptions,
} from '../../src/analytics/sports/running/workout-comparability';
import { runningEligibility } from '../../src/analytics/sports/running/eligibility';
import { context, run, settings, steadyRuns } from './fixtures';

function efficiencyOptions(): EfficiencyOptions {
  return {
    sport_type: 'running',
    steady_aerobic_activity_ids: steadyRuns().map((r) => r.id),
    settings: settings(),
    min_samples: 4,
    change_tolerance_percent: 2,
  };
}

function workoutOptions(): WorkoutOptions {
  return {
    sport_type: 'running',
    activity_ids: steadyRuns().map((r) => r.id),
    settings: settings(),
    session_type: 'easy',
    limit: 5,
  };
}

describe('running aerobic efficiency proxy', () => {
  it.each([3.06, 2.94])(
    'keeps the inclusive ±2%% boundary stable for floating-point speed %s',
    (speed) => {
      const result = analyzeAerobicEfficiency(steadyRuns(speed), context, efficiencyOptions());
      expect(Math.abs(result.proxy_change.percentage_change!)).toBeCloseTo(2, 12);
      expect(result.observed_direction).toBe('within_tolerance');
    },
  );
  it.each([
    [3.3, 'increase', 10],
    [3, 'within_tolerance', 0],
    [2.7, 'decrease', -10],
  ] as const)('reports %s m/s as an observed %s', (speed, direction, change) => {
    const result = analyzeAerobicEfficiency(steadyRuns(speed), context, efficiencyOptions());
    expect(result.status).toBe('ok');
    expect(result.observed_direction).toBe(direction);
    expect(result.proxy_change.percentage_change).toBeCloseTo(change, 10);
    expect(result.early.mean).toBeCloseTo(0.02, 12);
    expect(result.samples[0]).toMatchObject({
      speed_hr_proxy: 0.02,
      source_efficiency_factor: 1.7,
      source_decoupling: 3.5,
    });
    expect(result.provenance.speed_hr_proxy?.origin).toBe('computed');
    expect(result.provenance.source_efficiency_factor?.source_field).toBe(
      'Activity.icu_efficiency_factor',
    );
  });

  it.each([
    ['missing HR', { average_heart_rate_bpm: null }],
    ['zero HR', { average_heart_rate_bpm: 0 }],
    ['missing speed', { average_speed_mps: null }],
    ['zero speed', { average_speed_mps: 0 }],
    ['invalid speed', { average_speed_mps: -2 }],
    ['ignored HR', { ignore_hr: true }],
    ['short session', { moving_time_s: 600 }],
  ])('excludes an unusable %s sample', (_name, changes) => {
    const rows = steadyRuns();
    rows[0] = { ...rows[0]!, ...changes };
    const result = analyzeAerobicEfficiency(rows, context, efficiencyOptions());
    expect(result.status).toBe('insufficient_evidence');
    expect(result.proxy_change.percentage_change).toBeNull();
    expect(
      result.data_quality.decisions.find((d) => d.activity_id === rows[0]!.id)?.reasons.length,
    ).toBeGreaterThan(0);
  });

  it('does not classify an interval workout by its friendly name or all running records as aerobic', () => {
    const rows = steadyRuns().map((row) => ({
      ...row,
      name: 'Easy aerobic run with 10 hard repetitions',
    }));
    const result = analyzeAerobicEfficiency(rows, context, {
      ...efficiencyOptions(),
      steady_aerobic_activity_ids: [],
    });
    expect(result.samples).toHaveLength(0);
    expect(result.data_quality.exclusion_reasons.STEADY_AEROBIC_CLASSIFICATION_REQUIRED).toBe(4);
    expect(result.observed_direction).toBe('unavailable');
  });

  it('excludes races, known indoor/outdoor and large-elevation mismatches', () => {
    const rows = steadyRuns();
    rows[0]!.trainer = true;
    rows[1]!.elevation_gain_m = 1000;
    rows[2]!.source_sub_type = 'RACE';
    const result = analyzeAerobicEfficiency(rows, context, efficiencyOptions());
    expect(result.status).toBe('insufficient_evidence');
    expect(result.data_quality.exclusion_reasons.INDOOR_OUTDOOR_MISMATCH).toBe(1);
    expect(result.data_quality.exclusion_reasons.ELEVATION_MISMATCH).toBe(1);
    expect(result.data_quality.exclusion_reasons.SESSION_TYPE_MISMATCH).toBe(1);
  });

  it('requires two sessions in each disjoint calendar half, not simply four recent runs', () => {
    const rows = steadyRuns().map((row, index) => ({
      ...row,
      start_local: `2026-02-${20 + index}T08:00:00`,
    }));
    const result = analyzeAerobicEfficiency(rows, context, efficiencyOptions());
    expect(result.status).toBe('insufficient_evidence');
    expect(result.early.sample_count).toBe(0);
    expect(result.later.sample_count).toBe(4);
    expect(result.proxy_change.current).toBeNull();
  });

  it('reports unknown setting/elevation as caveats and honors an explicit HR ceiling', () => {
    const rows = steadyRuns().map((row) => ({ ...row, trainer: null, elevation_gain_m: null }));
    const result = analyzeAerobicEfficiency(rows, context, efficiencyOptions());
    expect(result.status).toBe('ok');
    expect(result.data_quality.exclusion_reasons.INDOOR_OUTDOOR_UNKNOWN).toBe(4);
    expect(
      analyzeAerobicEfficiency(rows, context, { ...efficiencyOptions(), max_average_hr_bpm: 140 })
        .status,
    ).toBe('insufficient_evidence');
  });

  it('returns an explicit unsupported sport result, never a cycling/swimming proxy', () => {
    for (const sport_type of ['Ride', 'cycling', 'Swim']) {
      const result = analyzeAerobicEfficiency(steadyRuns(), context, {
        ...efficiencyOptions(),
        sport_type,
      });
      expect(result.status).toBe('unsupported_sport');
      expect(result.samples).toEqual([]);
      expect(result.proxy_change.percentage_change).toBeNull();
    }
  });

  it('is deterministic across input order, includes missing requested IDs, and keeps a short history insufficient', () => {
    const rows = steadyRuns();
    expect(analyzeAerobicEfficiency(rows, context, efficiencyOptions())).toEqual(
      analyzeAerobicEfficiency([...rows].reverse(), context, efficiencyOptions()),
    );
    const result = analyzeAerobicEfficiency(rows.slice(0, 1), context, efficiencyOptions());
    expect(result.status).toBe('insufficient_evidence');
    expect(result.data_quality.exclusion_reasons.REQUESTED_ACTIVITY_NOT_RETURNED).toBe(3);
  });
});

describe('explainable workout comparability', () => {
  it('accepts exact duration, HR and elevation tolerance boundaries', () => {
    const reference = run('reference');
    const row = run('boundary', {
      distance_m: reference.distance_m! * 1.25,
      moving_time_s: reference.moving_time_s! * 1.25,
      average_heart_rate_bpm: 160,
      elevation_gain_m: 185,
    });
    const decision = runningEligibility(row, settings(), reference);
    expect(decision.outcome).toBe('eligible');
    expect(decision.reasons).toEqual([]);
    expect(
      runningEligibility(
        run('fraction', { distance_m: reference.distance_m! * 1.1 }),
        { ...settings(), max_distance_difference_fraction: 0.1 },
        reference,
      ).outcome,
    ).toBe('eligible');
    expect(runningEligibility(run('minimum', { moving_time_s: 1800 }), settings()).outcome).toBe(
      'eligible',
    );
  });
  it('compares similar user-selected easy runs without requiring cadence or power', () => {
    const result = compareRunningWorkouts(steadyRuns(), context, workoutOptions());
    expect(result.status).toBe('ok');
    expect(result.comparability).toBe('high');
    expect(result.samples).toHaveLength(4);
    expect(
      result.samples.every((s) => s.average_power_w === null && s.average_cadence_spm === null),
    ).toBe(true);
    expect(result.pooled_moving_speed_mps).toBeCloseTo(3.15, 12);
    expect(result.pooled_moving_pace_s_per_km).toBeCloseTo(1000 / 3.15, 12);
  });

  it.each([
    [{ distance_m: 25000 }, 'DISTANCE_MISMATCH'],
    [{ moving_time_s: 6000 }, 'DURATION_MISMATCH'],
    [{ elevation_gain_m: 1200 }, 'ELEVATION_MISMATCH'],
    [{ source_sub_type: 'RACE' }, 'SESSION_TYPE_MISMATCH'],
    [{ sport_type: 'Ride' }, 'DIFFERENT_SPORT'],
    [{ sport_type: 'VirtualRun' }, 'RUNNING_TYPE_MISMATCH'],
    [{ trainer: true }, 'INDOOR_OUTDOOR_MISMATCH'],
    [{ average_heart_rate_bpm: 175 }, 'HR_MISMATCH'],
  ])('explains ineligible sample %o', (changes, reason) => {
    const result = runningEligibility(run('a', changes), settings(), run('reference'));
    expect(result.outcome).toBe('excluded');
    expect(result.reasons).toContain(reason);
  });

  it('keeps missing HR insufficient by default and allows explicitly waived HR with a caveat', () => {
    const row = run('a', { average_heart_rate_bpm: null });
    expect(runningEligibility(row, settings()).outcome).toBe('insufficient_data');
    expect(runningEligibility(row, { ...settings(), require_hr: false }).reasons).toContain(
      'MISSING_OR_IGNORED_HR',
    );
  });

  it('does not silently classify threshold/interval sessions; labels long-run candidate heuristics', () => {
    expect(
      compareRunningWorkouts(steadyRuns(), context, {
        ...workoutOptions(),
        activity_ids: undefined,
        session_type: 'threshold',
      }).status,
    ).toBe('insufficient_evidence');
    const rows = steadyRuns().map((r) => ({ ...r, moving_time_s: 6000, distance_m: 18000 }));
    const result = compareRunningWorkouts(rows, context, {
      ...workoutOptions(),
      activity_ids: undefined,
      session_type: 'long_run',
    });
    expect(result.classification_basis).toBe('duration_candidate_heuristic');
    expect(result.comparability).toBe('moderate');
    expect(result.data_quality.exclusion_reasons.LONG_RUN_PURPOSE_UNVERIFIED).toBe(4);
  });

  it('bounds results, reports missing/invalid references and sparse histories, and never pads a five-run request', () => {
    const rows = steadyRuns();
    const result = compareRunningWorkouts(rows, context, { ...workoutOptions(), limit: 2 });
    expect(result.samples.map((s) => s.activity_id)).toEqual(['synthetic-2', 'synthetic-3']);
    expect(result.data_quality.exclusion_reasons.RESULT_LIMIT).toBe(2);
    expect(
      compareRunningWorkouts(rows, context, {
        ...workoutOptions(),
        reference_activity_id: 'missing',
      }).status,
    ).toBe('insufficient_evidence');
    expect(compareRunningWorkouts(rows.slice(0, 1), context, workoutOptions()).status).toBe(
      'insufficient_evidence',
    );
  });
});
