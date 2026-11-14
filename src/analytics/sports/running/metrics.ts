import { z } from 'zod';
import { nullableMetric, type AnalyticsActivity } from '../../contracts';
import { computed, source } from '../../core';
import { elevationPerKm } from './eligibility';
import { paceSecondsPerKm } from '../../../domain/models';

export const workoutSampleSchema = z.object({
  activity_id: z.string(),
  date: z.string(),
  distance_m: nullableMetric,
  moving_time_s: nullableMetric,
  elapsed_time_s: nullableMetric,
  average_speed_mps: nullableMetric,
  average_pace_s_per_km: nullableMetric,
  average_heart_rate_bpm: nullableMetric,
  training_load: nullableMetric,
  elevation_gain_m: nullableMetric,
  elevation_gain_m_per_km: nullableMetric,
  average_power_w: nullableMetric,
  average_cadence_spm: nullableMetric,
  source_efficiency_factor: nullableMetric,
  source_decoupling: nullableMetric,
});

export function workoutSample(row: AnalyticsActivity): z.infer<typeof workoutSampleSchema> {
  return {
    activity_id: row.id,
    date: row.start_local!.slice(0, 10),
    distance_m: row.distance_m,
    moving_time_s: row.moving_time_s,
    elapsed_time_s: row.elapsed_time_s,
    average_speed_mps: row.average_speed_mps,
    average_pace_s_per_km: paceSecondsPerKm(row.average_speed_mps),
    average_heart_rate_bpm: row.ignore_hr ? null : row.average_heart_rate_bpm,
    training_load: row.training_load,
    elevation_gain_m: row.elevation_gain_m,
    elevation_gain_m_per_km: elevationPerKm(row),
    average_power_w: row.average_power_w,
    average_cadence_spm: row.average_cadence_spm,
    source_efficiency_factor: row.source_efficiency_factor,
    source_decoupling: row.source_decoupling,
  };
}

export const runningProvenance = {
  distance_m: source('Activity.distance', 'm'),
  moving_time_s: source('Activity.moving_time', 's'),
  elapsed_time_s: source('Activity.elapsed_time', 's'),
  average_speed_mps: source('Activity.average_speed', 'm/s'),
  average_pace_s_per_km: computed('1000 / average_speed', 's/km', 'Activity.average_speed'),
  average_heart_rate_bpm: source('Activity.average_heartrate', 'bpm'),
  training_load: source('Activity.icu_training_load', 'source training-load units'),
  elevation_gain_m: source('Activity.total_elevation_gain', 'm'),
  elevation_gain_m_per_km: computed(
    '1000 * total_elevation_gain / distance',
    'm/km',
    'Activity.total_elevation_gain,Activity.distance',
  ),
  average_power_w: source('Activity.icu_average_watts', 'W'),
  average_cadence_spm: computed('2 * source rpm for running', 'spm', 'Activity.average_cadence'),
  source_efficiency_factor: source(
    'Activity.icu_efficiency_factor',
    'source-defined; basis not established by API schema',
  ),
  source_decoupling: source(
    'Activity.decoupling',
    'source-defined; calculation/sign convention not established by API schema',
  ),
  speed_statistics_mps: computed(
    'equal-session descriptive statistics; sample standard deviation denominator n-1',
    'm/s',
    'Activity.average_speed',
  ),
  pooled_moving_speed_mps: computed(
    'sum distance / sum moving_time; complete positive inputs',
    'm/s',
    'Activity.distance,Activity.moving_time',
  ),
  pooled_moving_pace_s_per_km: computed(
    '1000 * sum moving_time / sum distance',
    's/km',
    'Activity.distance,Activity.moving_time',
  ),
};
