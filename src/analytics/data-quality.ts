import { dateSchema, inRange, todayInTimezone, type DateRange } from '../utils/dates';
import { checkRange } from '../utils/dates';
import { AppError } from '../utils/errors';
import type { AnalyticsActivity, AnalysisContext, DataQuality, Decision } from './contracts';

/** Analytics use an explicitly configured IANA timezone; an absent/invalid timezone never uses server-local time. */
export function resolveContext(range: DateRange, timezone: string, now: Date): AnalysisContext {
  checkRange(range);
  try {
    if (!timezone) {
      throw new Error('Missing timezone');
    }

    return {
      range,
      timezone,
      today: todayInTimezone(now, timezone),
      coverage: { inventory: 'unknown', saturated: false },
    };
  } catch {
    throw new AppError(
      'configuration',
      'A valid athlete timezone and current instant are required for analytics.',
    );
  }
}

export function validatePeriods(current: DateRange, baseline: DateRange): void {
  checkRange(current);
  checkRange(baseline);
  if (current.start_date <= baseline.end_date && baseline.start_date <= current.end_date) {
    throw new AppError(
      'invalid_input',
      'Comparison periods must not overlap (inclusive local dates).',
    );
  }
}

export function localDay(activity: AnalyticsActivity): string | null {
  const day = activity.start_local?.slice(0, 10);
  return day && dateSchema.safeParse(day).success ? day : null;
}

/** Stable ID ordering makes input permutations deterministic. Conflicting same-ID records are quarantined, not guessed. */
export function prepareActivities(rows: readonly AnalyticsActivity[], context: AnalysisContext) {
  checkRange(context.range);
  const groups = new Map<string, AnalyticsActivity[]>();
  for (const row of rows) {
    const entries = groups.get(row.id) ?? [];
    entries.push(row);
    groups.set(row.id, entries);
  }

  const decisions: Decision[] = [];
  const activities: AnalyticsActivity[] = [];
  const conflicting: string[] = [];
  let duplicateCount = 0;
  for (const [id, entries] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const row = entries[0]!;
    // Schema-normalized objects may arrive with different property insertion orders.
    const fingerprints = entries.map((entry) =>
      JSON.stringify(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))),
    );
    if (new Set(fingerprints).size > 1) {
      conflicting.push(id);
      decisions.push({
        activity_id: id,
        outcome: 'insufficient_data',
        reasons: ['CONFLICTING_DUPLICATE_ID'],
        missing_fields: [],
      });
      continue;
    }

    duplicateCount += entries.length - 1;
    const day = localDay(row);
    if (!day) {
      decisions.push({
        activity_id: id,
        outcome: 'insufficient_data',
        reasons: ['MISSING_LOCAL_DATE'],
        missing_fields: ['start_local'],
      });
    } else if (!inRange(day, context.range)) {
      decisions.push({
        activity_id: id,
        outcome: 'excluded',
        reasons: ['OUTSIDE_REQUESTED_RANGE'],
        missing_fields: [],
      });
    } else {
      activities.push(row);
    }
  }

  activities.sort(
    (a, b) => a.start_local!.localeCompare(b.start_local!) || a.id.localeCompare(b.id),
  );
  const starts = new Set<string>();
  let overlapCount = 0;
  for (const row of activities) {
    if (starts.has(row.start_local!)) {
      overlapCount++;
    }
    starts.add(row.start_local!);
  }

  return {
    activities,
    decisions,
    conflicting,
    duplicateCount,
    overlapCount,
    retrievedCount: rows.length,
    uniqueCount: groups.size,
  };
}

export type Prepared = ReturnType<typeof prepareActivities>;

export function structuralGap(prepared: Prepared, context: AnalysisContext): boolean {
  return (
    context.coverage.saturated ||
    context.coverage.inventory === 'partial' ||
    prepared.decisions.some((d) => d.outcome === 'insufficient_data')
  );
}

/** Activity span describes observed dates, never an inferred guarantee that intervening days are covered. */
export function dataQuality(
  prepared: Prepared,
  context: AnalysisContext,
  decisions: Decision[],
  limitations: string[] = [],
): DataQuality {
  const all = [...prepared.decisions, ...decisions].map((decision) => ({
    ...decision,
    reasons: [...new Set(decision.reasons)],
    missing_fields: [...new Set(decision.missing_fields)],
  }));
  const eligible = decisions.filter(
    (d) => d.outcome === 'eligible' || d.outcome === 'eligible_with_caveats',
  );
  const dates = prepared.activities.map((a) => localDay(a)!).sort();
  const reasons: Record<string, number> = {};
  for (const decision of all) {
    for (const reason of decision.reasons) {
      reasons[reason] = (reasons[reason] ?? 0) + 1;
    }
  }

  const partialDay = inRange(context.today, context.range);
  const future = context.range.end_date > context.today;
  const missing = all.filter(
    (d) => d.outcome === 'insufficient_data' || d.missing_fields.length > 0,
  ).length;
  const partial =
    structuralGap(prepared, context) || all.some((d) => d.reasons.includes('UNKNOWN_SPORT'));
  const verified = context.coverage.inventory === 'verified' && !partial && !partialDay && !future;

  return {
    requested_range: context.range,
    actual_activity_range: dates.length ? { start_date: dates[0]!, end_date: dates.at(-1)! } : null,
    athlete_timezone: context.timezone,
    current_day_included: partialDay,
    future_days_included: future,
    retrieved_count: prepared.retrievedCount,
    unique_count: prepared.uniqueCount,
    eligible_count: eligible.length,
    excluded_count: all.length - eligible.length,
    missing_required_count: missing,
    duplicate_record_count: prepared.duplicateCount,
    conflicting_ids: prepared.conflicting,
    possible_overlap_count: prepared.overlapCount,
    completeness: partial ? 'partial' : verified && missing === 0 ? 'complete' : 'uncertain',
    inventory_coverage: context.coverage.inventory,
    metric_scope: 'retrieved_records',
    empty_status: eligible.length
      ? 'not_empty'
      : prepared.retrievedCount
        ? 'no_eligible_activities'
        : verified && all.length === 0
          ? 'verified_zero_activities'
          : 'no_activities_returned',
    exclusion_reasons: reasons,
    missing_fields: [...new Set(all.flatMap((d) => d.missing_fields))].sort(),
    decisions: all.slice(0, 100),
    decisions_truncated: all.length > 100,
    limitations: [
      ...(context.coverage.inventory !== 'verified'
        ? [
            'API success does not verify synchronization or a complete real-world activity inventory; totals cover returned records only.',
          ]
        : []),
      ...(partialDay ? ['Current athlete-local day is partial; no full-day extrapolation.'] : []),
      ...(future ? ['Requested future days are not completed training coverage.'] : []),
      ...(partial
        ? [
            'Saturation, restricted stubs or conflicting IDs prevent complete returned-record totals.',
          ]
        : []),
      ...(prepared.duplicateCount
        ? ['Identical same-ID records were counted once; duplicate_record_count is explicit.']
        : []),
      ...(prepared.overlapCount
        ? [
            'Distinct IDs sharing a local start were retained; legitimate sessions and cross-device duplicates cannot be distinguished.',
          ]
        : []),
      ...limitations,
    ],
  };
}
