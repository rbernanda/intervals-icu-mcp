import { z } from 'zod';

const nullableNumber = z.number().finite().nullable();
const nullableString = z.string().nullable();
export const RUN_TYPES = ['Run', 'TrailRun', 'VirtualRun'];
export function isRunning(type: string | null | undefined): boolean {
  return RUN_TYPES.includes(type ?? '');
}
export function matchesSport(type: string | null | undefined, filter?: string): boolean {
  if (!filter) return true;
  return filter.toLowerCase() === 'run' || filter.toLowerCase() === 'running'
    ? isRunning(type)
    : type?.toLowerCase() === filter.toLowerCase();
}
export function paceSecondsPerKm(speed: number | null | undefined): number | null {
  return speed != null && speed > 0 ? 1000 / speed : null;
}
export const activityOutputSchema = z.object({
  id: z.string(),
  name: nullableString,
  sport_type: nullableString,
  start_timestamp: nullableString,
  start_local: nullableString,
  timezone: nullableString,
  distance_m: nullableNumber,
  moving_time_s: nullableNumber,
  elapsed_time_s: nullableNumber,
  average_speed_mps: nullableNumber,
  max_speed_mps: nullableNumber,
  average_pace_s_per_km: nullableNumber,
  average_heart_rate_bpm: nullableNumber,
  max_heart_rate_bpm: nullableNumber,
  average_cadence_source_rpm: nullableNumber,
  average_cadence_spm: nullableNumber,
  average_power_w: nullableNumber,
  elevation_gain_m: nullableNumber,
  training_load: nullableNumber,
});
export type Activity = z.infer<typeof activityOutputSchema>;
export const profileOutputSchema = z.object({
  id: z.string(),
  display_name: nullableString,
  timezone: nullableString,
  weight_kg: nullableNumber,
  icu_weight_kg: nullableNumber,
  form_as_percent: z.boolean().nullable(),
  sport_settings: z.array(
    z.object({
      types: z.array(z.string()),
      ftp_w: nullableNumber,
      lthr_bpm: nullableNumber,
      max_hr_bpm: nullableNumber,
      threshold_speed_mps: nullableNumber,
    }),
  ),
});
export const formSchema = z.object({
  value: nullableNumber,
  origin: z.literal('computed'),
  formula: z.literal('same-day ctl - atl'),
  unit: z.literal('source training-load units'),
});
export const fitnessOutputSchema = z.object({
  date: z.string(),
  fitness_ctl: nullableNumber,
  fatigue_atl: nullableNumber,
  source_form_tsb: z.null(),
  computed_form: formSchema,
  source_values: z.object({
    ctl: nullableNumber,
    atl: nullableNumber,
    ctlLoad: nullableNumber,
    atlLoad: nullableNumber,
    rampRate: nullableNumber,
  }),
});
export type Fitness = z.infer<typeof fitnessOutputSchema>;
export const wellnessOutputSchema = z.object({
  date: z.string(),
  updated: nullableString,
  resting_heart_rate_bpm: nullableNumber,
  hrv_source: nullableNumber,
  hrv_sdnn_source: nullableNumber,
  sleep_duration_s: nullableNumber,
  sleep_score: nullableNumber,
  sleep_quality: nullableNumber,
  weight_kg: nullableNumber,
  fatigue: nullableNumber,
  soreness: nullableNumber,
  stress: nullableNumber,
  mood: nullableNumber,
  motivation: nullableNumber,
  readiness: nullableNumber,
  spo2_percent: nullableNumber,
  steps: nullableNumber,
});
export const intervalOutputSchema = z.object({
  id: nullableNumber,
  type: nullableString,
  label: nullableString,
  start_time_s: nullableNumber,
  end_time_s: nullableNumber,
  distance_m: nullableNumber,
  moving_time_s: nullableNumber,
  elapsed_time_s: nullableNumber,
  average_speed_mps: nullableNumber,
  average_pace_s_per_km: nullableNumber,
  average_heart_rate_bpm: nullableNumber,
  max_heart_rate_bpm: nullableNumber,
  average_cadence_source_rpm: nullableNumber,
  average_cadence_spm: nullableNumber,
  average_power_w: nullableNumber,
  elevation_gain_m: nullableNumber,
  training_load: nullableNumber,
});

export const calendarEntrySchema = z.object({
  date: z.string(),
  event_id: z.number().nullable(),
  activity_id: z.string().nullable(),
  name: z.string().nullable(),
  sport_type: z.string().nullable(),
  category: z.string().nullable(),
  status: z.enum(['planned', 'completed', 'calendar_event']),
  planned_duration_s: z.number().nullable(),
  planned_distance_m: z.number().nullable(),
  planned_training_load: z.number().nullable(),
  actual_duration_s: z.number().nullable(),
  actual_elapsed_time_s: z.number().nullable(),
  actual_distance_m: z.number().nullable(),
  actual_training_load: z.number().nullable(),
});
export type CalendarEntry = z.infer<typeof calendarEntrySchema>;
