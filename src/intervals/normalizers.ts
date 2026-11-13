import type { z } from 'zod';
import type { SourceActivity, SourceAthlete, SourceInterval, SourceWellness } from './schemas';
import type {
  profileOutputSchema,
  wellnessOutputSchema,
  intervalOutputSchema,
} from '../domain/models';
import { isRunning, paceSecondsPerKm, type Activity, type Fitness } from '../domain/models';

export function normalizeActivity(a: SourceActivity): Activity {
  return {
    id: a.id,
    name: a.name ?? null,
    sport_type: a.type ?? null,
    start_timestamp: a.start_date ?? null,
    start_local: a.start_date_local ?? null,
    timezone: a.timezone ?? null,
    distance_m: a.distance ?? null,
    moving_time_s: a.moving_time ?? null,
    elapsed_time_s: a.elapsed_time ?? null,
    average_speed_mps: a.average_speed ?? null,
    max_speed_mps: a.max_speed ?? null,
    average_pace_s_per_km: paceSecondsPerKm(a.average_speed),
    average_heart_rate_bpm: a.average_heartrate ?? null,
    max_heart_rate_bpm: a.max_heartrate ?? null,
    average_cadence_source_rpm: a.average_cadence ?? null,
    average_cadence_spm:
      isRunning(a.type) && a.average_cadence != null ? a.average_cadence * 2 : null,
    average_power_w: a.icu_average_watts ?? null,
    elevation_gain_m: a.total_elevation_gain ?? null,
    training_load: a.icu_training_load ?? null,
  };
}
export function normalizeProfile(p: SourceAthlete): z.infer<typeof profileOutputSchema> {
  return {
    id: p.id,
    display_name: p.name ?? null,
    timezone: p.timezone ?? null,
    weight_kg: p.weight ?? null,
    icu_weight_kg: p.icu_weight ?? null,
    form_as_percent: p.icu_form_as_percent ?? null,
    sport_settings: (p.sportSettings ?? []).map((setting) => ({
      types: setting.types ?? [],
      ftp_w: setting.ftp ?? null,
      lthr_bpm: setting.lthr ?? null,
      max_hr_bpm: setting.max_hr ?? null,
      threshold_speed_mps: setting.threshold_pace ?? null,
    })),
  };
}
export function normalizeFitness(w: SourceWellness): Fitness {
  return {
    date: w.id,
    fitness_ctl: w.ctl ?? null,
    fatigue_atl: w.atl ?? null,
    source_form_tsb: null,
    computed_form: {
      value: w.ctl != null && w.atl != null ? w.ctl - w.atl : null,
      origin: 'computed',
      formula: 'same-day ctl - atl',
      unit: 'source training-load units',
    },
    source_values: {
      ctl: w.ctl ?? null,
      atl: w.atl ?? null,
      ctlLoad: w.ctlLoad ?? null,
      atlLoad: w.atlLoad ?? null,
      rampRate: w.rampRate ?? null,
    },
  };
}
export function normalizeWellness(w: SourceWellness): z.infer<typeof wellnessOutputSchema> {
  return {
    date: w.id,
    updated: w.updated ?? null,
    resting_heart_rate_bpm: w.restingHR ?? null,
    hrv_source: w.hrv ?? null,
    hrv_sdnn_source: w.hrvSDNN ?? null,
    sleep_duration_s: w.sleepSecs ?? null,
    sleep_score: w.sleepScore ?? null,
    sleep_quality: w.sleepQuality ?? null,
    weight_kg: w.weight ?? null,
    fatigue: w.fatigue ?? null,
    soreness: w.soreness ?? null,
    stress: w.stress ?? null,
    mood: w.mood ?? null,
    motivation: w.motivation ?? null,
    readiness: w.readiness ?? null,
    spo2_percent: w.spO2 ?? null,
    steps: w.steps ?? null,
  };
}
export function normalizeInterval(
  i: SourceInterval,
  sport?: string | null,
): z.infer<typeof intervalOutputSchema> {
  return {
    id: i.id ?? null,
    type: i.type ?? null,
    label: i.label ?? null,
    start_time_s: i.start_time ?? null,
    end_time_s: i.end_time ?? null,
    distance_m: i.distance ?? null,
    moving_time_s: i.moving_time ?? null,
    elapsed_time_s: i.elapsed_time ?? null,
    average_speed_mps: i.average_speed ?? null,
    average_pace_s_per_km: paceSecondsPerKm(i.average_speed),
    average_heart_rate_bpm: i.average_heartrate ?? null,
    max_heart_rate_bpm: i.max_heartrate ?? null,
    average_cadence_source_rpm: i.average_cadence ?? null,
    average_cadence_spm:
      isRunning(sport) && i.average_cadence != null ? i.average_cadence * 2 : null,
    average_power_w: i.average_watts ?? null,
    elevation_gain_m: i.total_elevation_gain ?? null,
    training_load: i.training_load ?? null,
  };
}
