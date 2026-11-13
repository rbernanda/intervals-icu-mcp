import { z } from 'zod';
import { dateSchema } from '../utils/dates';
const optionalNumber = z.number().finite().nullish();
const optionalText = z.string().max(2000).nullish();
const nonnegative = z.number().finite().nonnegative().nullish();
const localTimestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?$/)
  .refine((value) => dateSchema.safeParse(value.slice(0, 10)).success)
  .nullish();
export const activityIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
export const athleteSchema = z.object({
  id: z.string().min(1),
  name: optionalText,
  timezone: optionalText,
  weight: nonnegative,
  icu_weight: nonnegative,
  icu_form_as_percent: z.boolean().nullish(),
  sportSettings: z
    .array(
      z.object({
        types: z.array(z.string()).nullish(),
        ftp: optionalNumber,
        lthr: optionalNumber,
        max_hr: optionalNumber,
        threshold_pace: nonnegative,
      }),
    )
    .max(100)
    .nullish(),
});
export const activitySchema = z.object({
  id: activityIdSchema,
  icu_athlete_id: z.string().nullish(),
  paired_event_id: z.number().int().nullish(),
  name: optionalText,
  type: optionalText,
  start_date: optionalText,
  start_date_local: localTimestamp,
  timezone: optionalText,
  distance: nonnegative,
  moving_time: nonnegative,
  elapsed_time: nonnegative,
  average_speed: nonnegative,
  max_speed: nonnegative,
  average_heartrate: nonnegative,
  max_heartrate: nonnegative,
  average_cadence: nonnegative,
  icu_average_watts: nonnegative,
  total_elevation_gain: nonnegative,
  icu_training_load: nonnegative,
  icu_ctl: optionalNumber,
  icu_atl: optionalNumber,
});
export const wellnessSchema = z.object({
  id: dateSchema,
  updated: optionalText,
  ctl: optionalNumber,
  atl: optionalNumber,
  rampRate: optionalNumber,
  ctlLoad: optionalNumber,
  atlLoad: optionalNumber,
  weight: nonnegative,
  restingHR: nonnegative,
  hrv: nonnegative,
  hrvSDNN: nonnegative,
  sleepSecs: nonnegative,
  sleepScore: optionalNumber,
  sleepQuality: optionalNumber,
  soreness: optionalNumber,
  fatigue: optionalNumber,
  stress: optionalNumber,
  mood: optionalNumber,
  motivation: optionalNumber,
  readiness: optionalNumber,
  spO2: optionalNumber,
  steps: nonnegative,
});
export const eventSchema = z.object({
  id: z.number().int(),
  start_date_local: localTimestamp,
  end_date_local: localTimestamp,
  name: optionalText,
  type: optionalText,
  category: optionalText,
  moving_time: nonnegative,
  distance: nonnegative,
  icu_training_load: nonnegative,
});
export const intervalSchema = z.object({
  id: z.number().int().nullish(),
  type: optionalText,
  label: optionalText,
  start_time: nonnegative,
  end_time: nonnegative,
  distance: nonnegative,
  moving_time: nonnegative,
  elapsed_time: nonnegative,
  average_speed: nonnegative,
  average_heartrate: nonnegative,
  max_heartrate: nonnegative,
  average_cadence: nonnegative,
  average_watts: nonnegative,
  total_elevation_gain: nonnegative,
  training_load: nonnegative,
});
export const intervalsSchema = z.object({
  id: activityIdSchema,
  icu_intervals: z.array(intervalSchema).max(1000).nullish(),
});
export type SourceAthlete = z.infer<typeof athleteSchema>;
export type SourceActivity = z.infer<typeof activitySchema>;
export type SourceWellness = z.infer<typeof wellnessSchema>;
export type SourceEvent = z.infer<typeof eventSchema>;
export type SourceInterval = z.infer<typeof intervalSchema>;
