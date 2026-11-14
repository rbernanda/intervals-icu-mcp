import { z } from 'zod';
import { isRunning } from '../../../domain/models';
import type { AnalyticsActivity, Decision } from '../../contracts';
import { exceedsTolerance, nonnegative, positive } from '../../core';

/** Selection tolerances are operational heuristics, not universal physiological thresholds. */
export const runningSettingsSchema = z
  .object({
    min_duration_s: z.number().finite().min(0).max(43200).default(1800),
    max_duration_difference_fraction: z.number().finite().min(0).max(1).default(0.25),
    max_distance_difference_fraction: z.number().finite().min(0).max(1).default(0.25),
    max_elevation_difference_m_per_km: z.number().finite().min(0).max(1000).default(10),
    max_hr_difference_bpm: z.number().finite().min(0).max(100).default(10),
    require_hr: z.boolean().default(true),
  })
  .strict();

export type RunningSettings = z.infer<typeof runningSettingsSchema>;

export function elevationPerKm(row: AnalyticsActivity): number | null {
  const distance = positive(row.distance_m);
  const elevation = nonnegative(row.elevation_gain_m);
  return distance !== null && elevation !== null ? (elevation * 1000) / distance : null;
}

/** Never deduces road/terrain from Run or treadmill status solely from VirtualRun. */
export function runningEligibility(
  row: AnalyticsActivity,
  settings: RunningSettings,
  reference?: AnalyticsActivity,
): Decision {
  const excluded: string[] = [];
  const missing: string[] = [];
  const caveats: string[] = [];
  if (!row.sport_type) {
    missing.push('sport_type');
  } else if (!isRunning(row.sport_type)) {
    excluded.push('DIFFERENT_SPORT');
  }
  if (positive(row.distance_m) === null) {
    missing.push('positive_distance_m');
  }
  if (positive(row.moving_time_s) === null) {
    missing.push('positive_moving_time_s');
  } else if (row.moving_time_s! < settings.min_duration_s) {
    excluded.push('SHORT_SESSION');
  }
  if (positive(row.average_speed_mps) === null) {
    missing.push('positive_average_speed_mps');
  }
  if (row.ignore_hr || positive(row.average_heart_rate_bpm) === null) {
    if (settings.require_hr) {
      missing.push('usable_average_heart_rate_bpm');
    } else {
      caveats.push('MISSING_OR_IGNORED_HR');
    }
  }
  if (elevationPerKm(row) === null) {
    caveats.push('ELEVATION_UNKNOWN');
  }
  if (row.trainer === null) {
    caveats.push('INDOOR_OUTDOOR_UNKNOWN');
  }
  if (reference) {
    if (elevationPerKm(reference) === null) {
      caveats.push('REFERENCE_ELEVATION_UNKNOWN');
    }
    if (reference.trainer === null) {
      caveats.push('REFERENCE_SETTING_UNKNOWN');
    }
    if (reference.ignore_hr || positive(reference.average_heart_rate_bpm) === null) {
      caveats.push('REFERENCE_HR_UNKNOWN');
    }
    if (row.sport_type !== reference.sport_type) {
      excluded.push('RUNNING_TYPE_MISMATCH');
    }
    if (row.trainer !== null && reference.trainer !== null && row.trainer !== reference.trainer) {
      excluded.push('INDOOR_OUTDOOR_MISMATCH');
    }
    if (
      row.source_sub_type !== reference.source_sub_type &&
      (row.source_sub_type === 'RACE' || reference.source_sub_type === 'RACE')
    ) {
      excluded.push('SESSION_TYPE_MISMATCH');
    }
    if (
      positive(row.moving_time_s) !== null &&
      positive(reference.moving_time_s) !== null &&
      exceedsTolerance(
        Math.abs(row.moving_time_s! / reference.moving_time_s! - 1),
        settings.max_duration_difference_fraction,
      )
    ) {
      excluded.push('DURATION_MISMATCH');
    }
    if (
      positive(row.distance_m) !== null &&
      positive(reference.distance_m) !== null &&
      exceedsTolerance(
        Math.abs(row.distance_m! / reference.distance_m! - 1),
        settings.max_distance_difference_fraction,
      )
    ) {
      excluded.push('DISTANCE_MISMATCH');
    }
    const gain = elevationPerKm(row);
    const referenceGain = elevationPerKm(reference);
    if (
      gain !== null &&
      referenceGain !== null &&
      exceedsTolerance(Math.abs(gain - referenceGain), settings.max_elevation_difference_m_per_km)
    ) {
      excluded.push('ELEVATION_MISMATCH');
    }
    if (
      positive(row.average_heart_rate_bpm) !== null &&
      positive(reference.average_heart_rate_bpm) !== null &&
      !row.ignore_hr &&
      !reference.ignore_hr &&
      exceedsTolerance(
        Math.abs(row.average_heart_rate_bpm! - reference.average_heart_rate_bpm!),
        settings.max_hr_difference_bpm,
      )
    ) {
      excluded.push('HR_MISMATCH');
    }
  }

  return {
    activity_id: row.id,
    outcome: excluded.length
      ? 'excluded'
      : missing.length
        ? 'insufficient_data'
        : caveats.length
          ? 'eligible_with_caveats'
          : 'eligible',
    reasons: [
      ...excluded,
      ...missing.map((field) => `MISSING_OR_INVALID_${field.toUpperCase()}`),
      ...caveats,
    ],
    missing_fields: missing,
  };
}

export function isEligible(decision: Decision): boolean {
  return decision.outcome === 'eligible' || decision.outcome === 'eligible_with_caveats';
}
