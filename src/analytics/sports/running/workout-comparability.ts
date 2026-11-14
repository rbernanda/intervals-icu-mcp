import { z } from 'zod';
import {
  nullableMetric,
  provenanceSchema,
  qualitySchema,
  statsSchema,
  type AnalyticsActivity,
  type AnalysisContext,
  type Decision,
} from '../../contracts';
import { pooledSpeed, statistics } from '../../core';
import { runningProvenance, workoutSample, workoutSampleSchema } from './metrics';
import { dataQuality, prepareActivities } from '../../data-quality';
import {
  isEligible,
  runningEligibility,
  runningSettingsSchema,
  type RunningSettings,
} from './eligibility';

export const sessionTypeSchema = z.enum(['any', 'easy', 'long_run', 'threshold', 'intervals']);

/** Candidate search heuristic only; explicit athlete-selected long runs can be shorter. */
const LONG_RUN_CANDIDATE_MIN_SECONDS = 90 * 60;

export interface WorkoutOptions {
  sport_type: string;
  activity_ids?: string[];
  reference_activity_id?: string;
  session_type: z.infer<typeof sessionTypeSchema>;
  limit: number;
  settings: RunningSettings;
}

export const workoutComparisonSchema = z.object({
  status: z.enum(['ok', 'insufficient_evidence', 'unsupported_sport']),
  session_type: sessionTypeSchema,
  classification_basis: z.enum([
    'user_selected_ids',
    'duration_candidate_heuristic',
    'unclassified',
  ]),
  reference_activity_id: z.string().nullable(),
  comparability: z.enum(['high', 'moderate', 'low', 'unavailable']),
  settings: runningSettingsSchema,
  samples: z.array(workoutSampleSchema).max(20),
  speed_statistics_mps: statsSchema,
  pooled_moving_speed_mps: nullableMetric,
  pooled_moving_pace_s_per_km: nullableMetric,
  provenance: z.record(z.string(), provenanceSchema),
  data_quality: qualitySchema,
  limitations: z.array(z.string()),
});

/** Same-type, anchor-relative comparisons; explicit IDs designate purpose, not proof of identical workout execution. */
export function compareRunningWorkouts(
  rows: readonly AnalyticsActivity[],
  context: AnalysisContext,
  options: WorkoutOptions,
): z.infer<typeof workoutComparisonSchema> {
  const prepared = prepareActivities(rows, context);
  const supported = ['run', 'running', 'trailrun', 'virtualrun'].includes(
    options.sport_type.toLowerCase(),
  );
  const byId = new Map(prepared.activities.map((a) => [a.id, a]));
  const initial = new Map<string, Decision>();
  for (const row of prepared.activities) {
    const decision = runningEligibility(row, options.settings);
    if (!supported) {
      decision.outcome = 'excluded';
      decision.reasons.push('UNSUPPORTED_SPORT_ANALYSIS');
    } else if (options.activity_ids && !options.activity_ids.includes(row.id)) {
      decision.outcome = 'excluded';
      decision.reasons.push('NOT_SELECTED');
    } else if (
      !['run', 'running'].includes(options.sport_type.toLowerCase()) &&
      row.sport_type?.toLowerCase() !== options.sport_type.toLowerCase()
    ) {
      decision.outcome = 'excluded';
      decision.reasons.push('SPORT_FILTER');
    }
    if (isEligible(decision) && options.session_type !== 'any') {
      if (row.source_sub_type === 'RACE') {
        decision.outcome = 'excluded';
        decision.reasons.push('SESSION_TYPE_MISMATCH');
      } else if (!options.activity_ids && options.session_type !== 'long_run') {
        decision.outcome = 'insufficient_data';
        decision.reasons.push('SESSION_CLASSIFICATION_REQUIRED');
        decision.missing_fields.push('user_selected_session_ids');
      } else if (!options.activity_ids && row.moving_time_s! < LONG_RUN_CANDIDATE_MIN_SECONDS) {
        decision.outcome = 'excluded';
        decision.reasons.push('LONG_RUN_CANDIDATE_DURATION_BELOW_90_MIN');
      } else if (!options.activity_ids) {
        decision.outcome = 'eligible_with_caveats';
        decision.reasons.push('LONG_RUN_PURPOSE_UNVERIFIED');
      }
    }
    initial.set(row.id, decision);
  }

  const candidates = [...prepared.activities]
    .reverse()
    .filter((a) => isEligible(initial.get(a.id)!));
  const reference = options.reference_activity_id
    ? byId.get(options.reference_activity_id)
    : candidates[0];
  const referenceValid = !!reference && isEligible(initial.get(reference.id)!);
  const selected: AnalyticsActivity[] = [];
  const decisions = prepared.activities.map((row) => {
    const decision = initial.get(row.id)!;
    if (!isEligible(decision)) {
      return decision;
    }
    if (!referenceValid) {
      return {
        ...decision,
        outcome: 'insufficient_data' as const,
        reasons: [...decision.reasons, 'REFERENCE_UNAVAILABLE'],
        missing_fields: [...decision.missing_fields, 'valid_reference_activity'],
      };
    }

    const compared = runningEligibility(row, options.settings, reference);
    return {
      ...compared,
      reasons: [...new Set([...compared.reasons, ...decision.reasons])],
      outcome:
        isEligible(compared) && decision.outcome === 'eligible_with_caveats'
          ? ('eligible_with_caveats' as const)
          : compared.outcome,
    };
  });
  // Pick the most recent comparable sessions, then return chronological samples.
  for (const row of [...prepared.activities].reverse()) {
    const decision = decisions.find((d) => d.activity_id === row.id)!;
    if (isEligible(decision)) {
      if (selected.length < options.limit) {
        selected.push(row);
      } else {
        decision.outcome = 'excluded';
        decision.reasons.push('RESULT_LIMIT');
      }
    }
  }
  selected.reverse();

  const unknownPurpose = !options.activity_ids || options.session_type === 'any';
  const caveats = unknownPurpose || decisions.some((d) => d.outcome === 'eligible_with_caveats');
  const pooled = pooledSpeed(selected);
  const missingIds = (options.activity_ids ?? []).filter((id) => !byId.has(id));
  for (const id of missingIds) {
    if (!prepared.decisions.some((d) => d.activity_id === id)) {
      decisions.push({
        activity_id: id,
        outcome: 'insufficient_data',
        reasons: ['REQUESTED_ACTIVITY_NOT_RETURNED'],
        missing_fields: ['activity_record'],
      });
    }
  }

  return {
    status: !supported ? 'unsupported_sport' : selected.length < 2 ? 'insufficient_evidence' : 'ok',
    session_type: options.session_type,
    classification_basis: options.activity_ids
      ? 'user_selected_ids'
      : options.session_type === 'long_run'
        ? 'duration_candidate_heuristic'
        : 'unclassified',
    reference_activity_id: referenceValid ? reference.id : null,
    comparability: selected.length < 2 ? 'unavailable' : caveats ? 'moderate' : 'high',
    settings: options.settings,
    samples: selected.map(workoutSample),
    speed_statistics_mps: statistics(selected.map((a) => a.average_speed_mps!)),
    pooled_moving_speed_mps: pooled.speed_mps,
    pooled_moving_pace_s_per_km: pooled.pace_s_per_km,
    provenance: runningProvenance,
    data_quality: dataQuality(prepared, context, decisions),
    limitations: [
      'Comparability levels describe rules met, not a confidence percentage or a controlled experiment. Checks are relative to the reported reference activity.',
      'Duration/distance selection does not establish session purpose or steady intensity. Explicit activity IDs represent user-selected session categories.',
      'Weather, terrain, sensor/device changes and within-session effort remain unknown. Run does not prove road/outdoor and VirtualRun does not prove treadmill.',
      'Threshold/interval comparisons use whole-session summaries only; repetition structure is not compared. Retrieve selected activity details for interval execution.',
      'Source efficiency/decoupling values retain an unspecified source basis and are not pooled or substituted for speed/HR. Faster averages do not establish fitness improvement.',
    ],
  };
}
