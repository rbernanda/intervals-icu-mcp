import { z } from 'zod';
import { analyticsContextShape, rangeSchema } from '../../analytics/contracts';
import { periodComparisonSchema } from '../../analytics/training-load';
import { efficiencyTrendSchema } from '../../analytics/sports/running/aerobic-efficiency';
import { runningSettingsSchema } from '../../analytics/sports/running/eligibility';
import {
  sessionTypeSchema,
  workoutComparisonSchema,
} from '../../analytics/sports/running/workout-comparability';
import { activityIdSchema } from '../../intervals/schemas';
import { rangeShape } from '../../utils/dates';

const sport = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[A-Za-z][A-Za-z0-9 ]*$/);
const activityIds = z
  .array(activityIdSchema)
  .min(1)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, 'Activity IDs must be unique.');

export const analyticsInputs = {
  compare: z
    .object({
      current: rangeSchema,
      baseline: rangeSchema,
      sport_type: sport.optional(),
    })
    .strict(),
  efficiency: z
    .object({
      ...rangeShape,
      sport_type: sport.default('running'),
      steady_aerobic_activity_ids: z
        .array(activityIdSchema)
        .max(100)
        .refine((ids) => new Set(ids).size === ids.length, 'Activity IDs must be unique.')
        .default([]),
      settings: runningSettingsSchema.prefault({}),
      min_samples: z.number().int().min(4).max(100).default(4),
      change_tolerance_percent: z.number().finite().min(0).max(100).default(2),
      max_average_hr_bpm: z.number().finite().positive().max(300).optional(),
    })
    .strict(),
  workouts: z
    .object({
      ...rangeShape,
      sport_type: sport.default('running'),
      activity_ids: activityIds.optional(),
      reference_activity_id: activityIdSchema.optional(),
      session_type: sessionTypeSchema.default('any'),
      limit: z.number().int().min(2).max(20).default(5),
      settings: runningSettingsSchema.prefault({}),
    })
    .strict(),
};

export const analyticsOutputs = {
  compare: z.object({ ...analyticsContextShape, analysis: periodComparisonSchema }),
  efficiency: z.object({ ...analyticsContextShape, analysis: efficiencyTrendSchema }),
  workouts: z.object({ ...analyticsContextShape, analysis: workoutComparisonSchema }),
};
