import { normalizeAnalyticsActivity } from '../../src/intervals/analytics-normalizer';
import type { AnalyticsActivity, AnalysisContext } from '../../src/analytics/contracts';
import { runningSettingsSchema } from '../../src/analytics/sports/running/eligibility';

export const context: AnalysisContext = {
  range: { start_date: '2026-02-01', end_date: '2026-02-28' },
  timezone: 'America/New_York',
  today: '2026-03-09',
  coverage: { inventory: 'unknown', saturated: false },
};

export function run(
  id = 'synthetic-run',
  overrides: Partial<AnalyticsActivity> = {},
): AnalyticsActivity {
  return {
    ...normalizeAnalyticsActivity({
      id,
      type: 'Run',
      start_date_local: '2026-02-03T08:00:00',
      distance: 10800,
      moving_time: 3600,
      elapsed_time: 3650,
      average_speed: 3,
      average_heartrate: 150,
      total_elevation_gain: 40,
      icu_training_load: 60,
      trainer: false,
      sub_type: 'NONE',
      icu_efficiency_factor: 1.7,
      decoupling: 3.5,
    }),
    ...overrides,
  };
}

export function steadyRuns(laterSpeed = 3.3): AnalyticsActivity[] {
  return ['03', '08', '18', '24'].map((day, index) => {
    const speed = index < 2 ? 3 : laterSpeed;
    return run(`synthetic-${index}`, {
      start_local: `2026-02-${day}T08:00:00`,
      average_speed_mps: speed,
      distance_m: speed * 3600,
    });
  });
}

export function settings() {
  return runningSettingsSchema.parse({});
}
