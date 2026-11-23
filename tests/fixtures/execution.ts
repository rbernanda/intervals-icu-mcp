import { executionOptionsSchema } from '../../src/analytics/sports/running/execution-review';
import { normalizeActivity, normalizeInterval } from '../../src/intervals/normalizers';

/** Invented prescription and measurements, unrelated to any real athlete plan. */
export function executionFixture() {
  return {
    activity: normalizeActivity({
      id: 'synthetic-execution',
      type: 'Run',
      start_date_local: '2026-03-08T07:00:00',
    }),
    intervals: [
      normalizeInterval(
        {
          type: 'WORK',
          start_time: 0,
          end_time: 180,
          distance: 600,
          moving_time: 180,
          elapsed_time: 180,
          average_speed: 10 / 3,
        },
        'Run',
      ),
      normalizeInterval(
        {
          type: 'RECOVERY',
          start_time: 180,
          end_time: 240,
          distance: 0,
          moving_time: 0,
          elapsed_time: 60,
          average_speed: 0,
        },
        'Run',
      ),
      normalizeInterval(
        {
          type: 'WORK',
          start_time: 240,
          end_time: 537,
          distance: 900,
          moving_time: 297,
          elapsed_time: 297,
          average_speed: 1000 / 330,
        },
        'Run',
      ),
    ],
    options: executionOptionsSchema.parse({
      match_basis: 'athlete_confirmed',
      prescription: {
        reported_source: 'Example running coach',
        extraction_basis: 'athlete_supplied',
        scheduled_date: '2026-03-08',
        completeness: 'complete',
        steps: [
          {
            role: 'work',
            target_distance_m: 600,
            target_pace: { min_s_per_km: 295, max_s_per_km: 305 },
            actual_interval_indexes: [1],
          },
          {
            role: 'recovery',
            target_duration_s: 60,
            duration_basis: 'elapsed',
            actual_interval_indexes: [2],
          },
          {
            role: 'work',
            target_distance_m: 1000,
            target_pace: { min_s_per_km: 315, max_s_per_km: 325 },
            actual_interval_indexes: [3],
          },
        ],
      },
    }),
  };
}

/** One-step prescription for the existing synthetic a2 API fixture. */
export function executionRequestFixture() {
  return {
    activity_id: 'a2',
    ...executionOptionsSchema.parse({
      match_basis: 'athlete_confirmed',
      prescription: {
        reported_source: 'Example running coach',
        extraction_basis: 'athlete_supplied',
        scheduled_date: '2026-11-13',
        completeness: 'partial',
        steps: [
          {
            role: 'work',
            target_distance_m: 1000,
            target_pace: { min_s_per_km: 300, max_s_per_km: 300 },
            actual_interval_indexes: [1],
          },
        ],
      },
    }),
  };
}
