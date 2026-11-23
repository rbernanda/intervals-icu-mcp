import { describe, expect, it } from 'vitest';
import {
  executionReviewSchema,
  reviewRunningExecution,
} from '../../src/analytics/sports/running/execution-review';
import { inputs } from '../../src/tools/contracts';
import { executionFixture } from '../fixtures/execution';

describe('existing prescription execution review', () => {
  it('compares different repetitions against their own distance/pace targets and recovery against elapsed time', () => {
    const { activity, intervals, options } = executionFixture();
    const result = reviewRunningExecution(activity, intervals, options);
    expect(executionReviewSchema.safeParse(result).success).toBe(true);
    expect(result.status).toBe('ok');
    expect(result.steps[0]).toMatchObject({
      status: 'compared',
      distance_difference_m: 0,
      pace_assessment: 'within_range',
      pace_difference_to_bound_s_per_km: 0,
    });
    expect(result.steps[1]).toMatchObject({
      status: 'compared',
      duration_difference_s: 0,
      actual: { moving_time_s: { value: 0 }, elapsed_time_s: { value: 60 } },
    });
    expect(result.steps[2]).toMatchObject({
      distance_difference_m: -100,
      pace_assessment: 'slower_than_range',
    });
    expect(result.steps[2]!.pace_difference_to_bound_s_per_km).toBeCloseTo(5);
    expect(result.data_quality.compared_step_count).toBe(3);
    expect(result).not.toHaveProperty('score');
  });

  it('defaults to unconfirmed pairing and withholds numerical comparisons without explicit association', () => {
    const { activity, intervals, options } = executionFixture();
    const input = inputs.executionReview.parse({
      activity_id: activity.id,
      prescription: options.prescription,
    });
    const result = reviewRunningExecution(activity, intervals, input);
    expect(result.status).toBe('unconfirmed_match');
    expect(
      result.steps.every(
        (step) =>
          step.distance_difference_m === null &&
          step.duration_difference_s === null &&
          step.pace_assessment !== 'within_range',
      ),
    ).toBe(true);
    expect(result.steps[0]!.actual.distance_m).toMatchObject({ value: null, known_sum: 600 });
  });

  it('does not automatically map steps by position, labels, date or source WORK type', () => {
    const { activity, intervals, options } = executionFixture();
    options.prescription.steps.forEach((step) => {
      step.actual_interval_indexes = [];
    });
    const result = reviewRunningExecution(activity, intervals, options);
    expect(result.steps.every((step) => step.status === 'unmapped')).toBe(true);
    expect(result.data_quality.unassigned_interval_indexes).toEqual([1, 2, 3]);
    expect(result.steps[0]!.actual.distance_m.value).toBeNull();
  });

  it('compares available targets while explicitly limiting a description-derived partial prescription', () => {
    const { activity, intervals, options } = executionFixture();
    options.prescription.completeness = 'partial';
    options.prescription.extraction_basis = 'workout_description';
    options.prescription.reported_source = 'Example plan export';
    const result = reviewRunningExecution(activity, intervals, options);
    expect(result.status).toBe('limited');
    expect(result.data_quality.reasons).toContain('PARTIAL_PRESCRIPTION');
    expect(result.steps[0]!.pace_assessment).toBe('within_range');
    expect(result.prescription_origin).toBe('supplied_for_this_request');
    expect(result.extraction_basis).toBe('workout_description');
  });

  it('supports a no-faster-than ceiling without inventing a slower pace limit', () => {
    const { activity, intervals, options } = executionFixture();
    options.prescription.steps[0]!.target_pace = { min_s_per_km: 310 };
    let result = reviewRunningExecution(activity, intervals, options);
    expect(result.steps[0]).toMatchObject({
      pace_assessment: 'faster_than_range',
      pace_difference_to_bound_s_per_km: -10,
    });
    options.prescription.steps[0]!.target_pace = { min_s_per_km: 290 };
    result = reviewRunningExecution(activity, intervals, options);
    expect(result.steps[0]!.pace_assessment).toBe('within_range');
  });

  it.each([
    ['Coach email', 'athlete_supplied'],
    ['Example calendar service', 'structured_fields'],
    ['New provider not known to the server', 'workout_description'],
    ['Coach PDF', 'document'],
    ['Example exported workout', 'exported_file'],
    ['runna_via_coros', 'structured_fields'],
  ])('uses the same numeric contract for %s (%s)', (label, extraction) => {
    const { activity, intervals, options } = executionFixture();
    const baseline = reviewRunningExecution(activity, intervals, options);
    const input = inputs.executionReview.parse({
      activity_id: activity.id,
      ...options,
      prescription: {
        ...options.prescription,
        reported_source: label,
        extraction_basis: extraction,
      },
    });
    const result = reviewRunningExecution(activity, intervals, input);
    expect(result.reported_source).toBe(label);
    expect(result.extraction_basis).toBe(extraction);
    expect(result.steps).toEqual(baseline.steps);
    expect(result.data_quality).toEqual(baseline.data_quality);
    expect(executionReviewSchema.safeParse(result).success).toBe(true);
  });

  it('reviews undated athlete-confirmed instructions without inventing a schedule date', () => {
    const { activity, intervals, options } = executionFixture();
    delete options.prescription.scheduled_date;
    const input = inputs.executionReview.parse({ activity_id: activity.id, ...options });
    const result = reviewRunningExecution(activity, intervals, input);
    expect(result.scheduled_date).toBeNull();
    expect(result.status).toBe('limited');
    expect(result.data_quality.reasons).toContain('PRESCRIPTION_DATE_UNAVAILABLE');
    expect(result.data_quality.reasons).not.toContain('SCHEDULE_DATE_DIFFERS');
    expect(result.steps[0]!.distance_difference_m).toBe(0);
  });

  it('trims attribution labels while accepting the 120-character boundary', () => {
    const { activity, options } = executionFixture();
    const label = 'x'.repeat(120);
    const input = inputs.executionReview.parse({
      activity_id: activity.id,
      ...options,
      prescription: { ...options.prescription, reported_source: ' ' + label + ' ' },
    });
    expect(input.prescription.reported_source).toBe(label);
  });

  it.each([
    '',
    '   ',
    'x'.repeat(121),
    'Coach\nPlan',
    'Coach\u0000Plan',
    'Coach\u0085Plan',
    'Coach\u2028Plan',
    'Coach\u2029Plan',
  ])('rejects an empty, oversized or control-character attribution label', (label) => {
    const { activity, options } = executionFixture();
    expect(
      inputs.executionReview.safeParse({
        activity_id: activity.id,
        ...options,
        prescription: { ...options.prescription, reported_source: label },
      }).success,
    ).toBe(false);
  });

  it('compares exact inclusive pace boundaries without floating-point false failures', () => {
    const { activity, intervals, options } = executionFixture();
    options.prescription.steps[0]!.target_pace = { min_s_per_km: 300, max_s_per_km: 300 };
    expect(reviewRunningExecution(activity, intervals, options).steps[0]!.pace_assessment).toBe(
      'within_range',
    );
  });

  it('supports split laps mapped to one step using pooled moving pace and complete totals', () => {
    const { activity, intervals, options } = executionFixture();
    options.prescription.steps = [
      {
        role: 'work',
        target_distance_m: 1500,
        target_pace: { min_s_per_km: 310, max_s_per_km: 320 },
        actual_interval_indexes: [1, 3],
      },
    ];
    const result = reviewRunningExecution(activity, intervals, options);
    expect(result.steps[0]!.actual).toMatchObject({
      distance_m: { value: 1500 },
      pace_s_per_km: 318,
      pace_basis: 'pooled_moving_time_distance',
    });
    expect(result.data_quality.unassigned_interval_indexes).toEqual([2]);
    expect(result.status).toBe('limited');
  });

  it('preserves explicit duration basis and never substitutes missing elapsed time with moving time', () => {
    const { activity, intervals, options } = executionFixture();
    intervals[1]!.elapsed_time_s = null;
    let result = reviewRunningExecution(activity, intervals, options);
    expect(result.steps[1]!.duration_difference_s).toBeNull();
    expect(result.steps[1]!.reasons).toContain('DURATION_UNAVAILABLE');
    options.prescription.steps[1]!.duration_basis = 'moving';
    result = reviewRunningExecution(activity, intervals, options);
    expect(result.steps[1]!.duration_difference_s).toBe(-60);
  });

  it('does not fill missing source speed from distance/time for a single interval', () => {
    const { activity, intervals, options } = executionFixture();
    intervals[0]!.average_speed_mps = null;
    const result = reviewRunningExecution(activity, intervals, options);
    expect(result.steps[0]!.pace_assessment).toBe('unavailable');
    expect(result.steps[0]!.distance_difference_m).toBe(0);
    expect(result.steps[0]!.status).toBe('limited');
  });

  it('does not silently drop a missing requested interval or call it a skipped repetition', () => {
    const { activity, intervals, options } = executionFixture();
    options.prescription.steps[0]!.actual_interval_indexes = [1, 4];
    const result = reviewRunningExecution(activity, intervals, options);
    expect(result.data_quality.missing_interval_indexes).toEqual([4]);
    expect(result.steps[0]!.status).toBe('unavailable');
    expect(result.steps[0]!.distance_difference_m).toBeNull();
    expect(result.steps[1]!.status).toBe('compared');
  });

  it('flags a changed scheduled date without discarding an explicitly confirmed rescheduled workout', () => {
    const { activity, intervals, options } = executionFixture();
    options.prescription.scheduled_date = '2026-03-07';
    const result = reviewRunningExecution(activity, intervals, options);
    expect(result.data_quality.reasons).toContain('SCHEDULE_DATE_DIFFERS');
    expect(result.steps[0]!.distance_difference_m).toBe(0);
  });

  it.each(['truncated', 'overlap', 'invalid-timing'])(
    'withholds comparison for %s data',
    (issue) => {
      const { activity, intervals, options } = executionFixture();
      if (issue === 'overlap') {
        intervals[1]!.start_time_s = 170;
      }
      if (issue === 'invalid-timing') {
        intervals[1]!.end_time_s = 100;
      }
      const result = reviewRunningExecution(activity, intervals, options, issue === 'truncated');
      expect(result.status).toBe('limited');
      expect(
        result.steps.every(
          (step) => step.distance_difference_m === null && step.duration_difference_s === null,
        ),
      ).toBe(true);
    },
  );

  it('rejects unsupported sports without producing running comparisons', () => {
    const { activity, intervals, options } = executionFixture();
    activity.sport_type = 'Ride';
    const result = reviewRunningExecution(activity, intervals, options);
    expect(result.status).toBe('unsupported_sport');
    expect(result.steps[0]!.distance_difference_m).toBeNull();
  });

  it.each([
    { target_distance_m: -1 },
    { target_duration_s: 60 },
    { duration_basis: 'elapsed' },
    { target_pace: {} },
    { target_pace: { min_s_per_km: 330, max_s_per_km: 300 } },
    { actual_interval_indexes: [0] },
    { actual_interval_indexes: [201] },
    { actual_interval_indexes: [1, 1] },
    { arbitrary: true },
  ])('rejects invalid step arguments: %j', (changes) => {
    const { activity, options } = executionFixture();
    Object.assign(options.prescription.steps[0]!, changes);
    expect(inputs.executionReview.safeParse({ activity_id: activity.id, ...options }).success).toBe(
      false,
    );
  });

  it('rejects sharing one actual interval between multiple planned steps and unknown input fields', () => {
    const { activity, options } = executionFixture();
    options.prescription.steps[2]!.actual_interval_indexes = [1];
    expect(inputs.executionReview.safeParse({ activity_id: activity.id, ...options }).success).toBe(
      false,
    );
    expect(
      inputs.executionReview.safeParse({
        activity_id: activity.id,
        ...executionFixture().options,
        create_plan: true,
      }).success,
    ).toBe(false);
  });

  it('flags reordered steps without silently changing the supplied mapping', () => {
    const { activity, intervals, options } = executionFixture();
    options.prescription.steps.reverse();
    const result = reviewRunningExecution(activity, intervals, options);
    expect(result.data_quality.step_order_differs).toBe(true);
    expect(result.data_quality.chronological_step_order_verified).toBe(false);
    expect(result.data_quality.reasons).toContain('STEP_ORDER_DIFFERS');
    expect(result.status).toBe('limited');
    expect(result.steps[0]!.actual_interval_indexes).toEqual([3]);
  });

  it('keeps numeric observations but does not verify step order when timestamps are missing', () => {
    const { activity, intervals, options } = executionFixture();
    intervals[0]!.start_time_s = null;
    const result = reviewRunningExecution(activity, intervals, options);
    expect(result.data_quality.reasons).toContain('UNVERIFIED_STEP_ORDER');
    expect(result.steps[0]!.distance_difference_m).toBe(0);
    expect(result.prescription_origin).toBe('supplied_for_this_request');
    expect(result.provenance).not.toHaveProperty('targets');
  });

  it('bounds oversized interval collections and withholds aggregate comparisons', () => {
    const { activity, intervals, options } = executionFixture();
    const rows = Array.from({ length: 201 }, (_, index) => ({
      ...intervals[0]!,
      start_time_s: index * 180,
      end_time_s: (index + 1) * 180,
    }));
    const result = reviewRunningExecution(activity, rows, options);
    expect(result.data_quality.returned_interval_count).toBe(200);
    expect(result.data_quality.intervals_truncated).toBe(true);
    expect(result.steps[0]!.distance_difference_m).toBeNull();
  });
});
