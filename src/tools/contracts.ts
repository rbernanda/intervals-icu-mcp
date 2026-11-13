import { z } from 'zod';
import { MAX_ACTIVITIES, MAX_EVENTS } from '../intervals/client';
import { activityIdSchema } from '../intervals/schemas';
import { dateSchema, rangeShape } from '../utils/dates';
import {
  activityOutputSchema,
  fitnessOutputSchema,
  intervalOutputSchema,
  profileOutputSchema,
  wellnessOutputSchema,
  calendarEntrySchema,
} from '../domain/models';
import { summarySchema } from '../domain/summary';

const sportSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[A-Za-z][A-Za-z0-9 ]*$/)
  .optional();
export const inputs = {
  profile: z.object({}).strict(),
  recent: z
    .object({
      start_date: dateSchema.optional(),
      end_date: dateSchema.optional(),
      limit: z.number().int().min(1).max(100).default(20),
      sport_type: sportSchema,
    })
    .strict(),
  detail: z
    .object({ activity_id: activityIdSchema, include_intervals: z.boolean().default(false) })
    .strict(),
  range: z.object(rangeShape).strict(),
  summary: z
    .object({
      days: z
        .union([z.literal(7), z.literal(14), z.literal(28), z.literal(42), z.literal(90)])
        .default(28),
      sport_type: sportSchema,
    })
    .strict(),
};
const contextShape = {
  source: z.literal('Intervals.icu'),
  retrieved_at: z.string(),
  date_context: z.string(),
  warnings: z.array(z.string()),
};
const rangeOutput = z.object(rangeShape);
export const outputs = {
  profile: z.object({ ...contextShape, athlete: profileOutputSchema }),
  recent: z.object({
    ...contextShape,
    range: rangeOutput,
    activities: z.array(activityOutputSchema).max(100),
    matching_count: z.number().int(),
    returned_count: z.number().int(),
    upstream_saturated: z.boolean(),
  }),
  detail: z.object({
    ...contextShape,
    activity: activityOutputSchema,
    intervals: z.array(intervalOutputSchema).max(200).nullable(),
    intervals_truncated: z.boolean(),
  }),
  fitness: z.object({
    ...contextShape,
    range: rangeOutput,
    daily: z.array(fitnessOutputSchema).max(90),
  }),
  wellness: z.object({
    ...contextShape,
    range: rangeOutput,
    daily: z.array(wellnessOutputSchema).max(90),
  }),
  calendar: z.object({
    ...contextShape,
    range: rangeOutput,
    entries: z.array(calendarEntrySchema).max(MAX_EVENTS + MAX_ACTIVITIES),
  }),
  summary: z.object({
    ...contextShape,
    range: rangeOutput,
    sport_filter: z.string().nullable(),
    summary: summarySchema,
  }),
};
