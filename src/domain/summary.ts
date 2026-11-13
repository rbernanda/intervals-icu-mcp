import { z } from 'zod';
import { daysBetween, mondayOf, shiftDate, type DateRange } from '../utils/dates';
import {
  activityOutputSchema,
  fitnessOutputSchema,
  isRunning,
  type Activity,
  type Fitness,
} from './models';
const nullableNumber = z.number().nullable();
export const sumSchema = z.object({
  value: nullableNumber,
  recorded_count: z.number().int(),
  missing_count: z.number().int(),
  complete: z.boolean(),
});
export function sumRecorded(values: (number | null)[]): z.infer<typeof sumSchema> {
  const recorded = values.filter((value): value is number => value !== null);
  const complete = recorded.length === values.length;
  return {
    value: complete ? recorded.reduce((total, value) => total + value, 0) : null,
    recorded_count: recorded.length,
    missing_count: values.length - recorded.length,
    complete,
  };
}
export const summarySchema = z.object({
  aggregation_origin: z.literal('computed from retrieved source records'),
  activity_count: z.number().int(),
  total_distance_m: sumSchema,
  total_moving_time_s: sumSchema,
  total_elapsed_time_s: sumSchema,
  total_training_load: sumSchema,
  weekly_running_distance: z.array(
    z.object({
      week_start: z.string(),
      covered_start: z.string(),
      covered_end: z.string(),
      partial_week: z.boolean(),
      activity_count: z.number().int(),
      distance_m: sumSchema,
    }),
  ),
  average_weekly_distance_m: nullableNumber,
  average_weekly_running_distance_m: nullableNumber,
  longest_run: activityOutputSchema.nullable(),
  latest_fitness: fitnessOutputSchema.nullable(),
});
export function aggregateSummary(
  activities: Activity[],
  fitness: Fitness[],
  range: DateRange,
): z.infer<typeof summarySchema> {
  const running = activities.filter((a) => isRunning(a.sport_type));
  const total = sumRecorded(activities.map((a) => a.distance_m));
  const runningTotal = sumRecorded(running.map((a) => a.distance_m));
  const weeks: z.infer<typeof summarySchema>['weekly_running_distance'] = [];
  for (let week = mondayOf(range.start_date); week <= range.end_date; week = shiftDate(week, 7)) {
    const coveredStart = week < range.start_date ? range.start_date : week;
    const weekEnd = shiftDate(week, 6);
    const coveredEnd = weekEnd > range.end_date ? range.end_date : weekEnd;
    const records = running.filter((a) => {
      const day = a.start_local?.slice(0, 10);
      return !!day && day >= coveredStart && day <= coveredEnd;
    });
    weeks.push({
      week_start: week,
      covered_start: coveredStart,
      covered_end: coveredEnd,
      partial_week: coveredStart !== week || coveredEnd !== weekEnd,
      activity_count: records.length,
      distance_m: sumRecorded(records.map((a) => a.distance_m)),
    });
  }
  const weekCount = (daysBetween(range.start_date, range.end_date) + 1) / 7;
  return {
    aggregation_origin: 'computed from retrieved source records',
    activity_count: activities.length,
    total_distance_m: total,
    total_moving_time_s: sumRecorded(activities.map((a) => a.moving_time_s)),
    total_elapsed_time_s: sumRecorded(activities.map((a) => a.elapsed_time_s)),
    total_training_load: sumRecorded(activities.map((a) => a.training_load)),
    weekly_running_distance: weeks,
    average_weekly_distance_m: total.value === null ? null : total.value / weekCount,
    average_weekly_running_distance_m:
      runningTotal.value === null ? null : runningTotal.value / weekCount,
    longest_run: runningTotal.complete
      ? ([...running].sort((a, b) => (b.distance_m ?? 0) - (a.distance_m ?? 0))[0] ?? null)
      : null,
    latest_fitness:
      [...fitness]
        .sort((a, b) => b.date.localeCompare(a.date))
        .find((f) => f.fitness_ctl !== null && f.fatigue_atl !== null) ?? null,
  };
}
