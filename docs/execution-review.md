# Existing-plan execution review

Unreleased read-only `review_running_execution` tool. The workflow reviews an existing prescription; it does not create, store, schedule or adapt a training plan. The deployed v1.3.0 tools remain unchanged until a future reviewed release/deployment.

## Sources and responsibilities

The athlete's chosen plan remains authoritative. Prescription inputs are provider-neutral: an agent can normalize targets from an available authorized read-only connection, an explicitly linked calendar entry, coach/athlete instructions, a document or a workout export. Neither COROS nor any other prescription provider is required. The Worker itself retrieves actual activity measurements only from Intervals.icu. It receives numeric targets and attribution/association metadata for one request; it contains no external-provider client, credential storage, file importer or OCR.

Source and extraction labels are caller assertions. `match_basis` defaults to unconfirmed, which withholds comparisons. Set athlete_confirmed or source_linked only when the actual association is established. Same-date or similarly named sessions are not automatically matched. Different scheduled/completed dates remain flagged even for a confirmed rescheduled session. scheduled_date is optional for undated instructions; omission returns null and PRESCRIPTION_DATE_UNAVAILABLE without inventing a date or blocking otherwise valid per-step comparison.

Any source may provide a degraded/incomplete export or an updated prescription. Original descriptions can retain explicit targets; label the extraction method and keep ambiguous/unsupported parts partial. A current calendar entry does not independently establish the original instructions for a past activity. Actual connected-source availability and export fidelity must be verified rather than inferred from the provider name.

The skill documents [normalization and an optional COROS example](../skills/intervals-training-analyst/references/execution-review.md). That example is an adapter workflow, not a server dependency or promise of a direct integration.

## Synthetic request

```json
{
  "activity_id": "synthetic-run",
  "match_basis": "athlete_confirmed",
  "prescription": {
    "reported_source": "Independent coach",
    "extraction_basis": "document",
    "completeness": "partial",
    "steps": [
      {
        "role": "work",
        "target_distance_m": 600,
        "target_pace": { "min_s_per_km": 295, "max_s_per_km": 305 },
        "actual_interval_indexes": [2]
      },
      {
        "role": "recovery",
        "target_duration_s": 60,
        "duration_basis": "elapsed",
        "actual_interval_indexes": [3]
      }
    ]
  }
}
```

reported_source is an arbitrary 1–120 character attribution label after trimming; empty labels and control characters are rejected. The same schema is used for input/output. Labels never choose a connector, authenticate a provider or cause URLs to be fetched. Existing labels such as athlete_supplied or runna_via_coros remain accepted as ordinary text.

extraction_basis describes how the caller obtained targets: structured_fields, workout_description, document, exported_file or athlete_supplied. Document/export labels do not claim built-in parsing; the caller/host must actually read the supplied material and normalize explicit targets. Provider names and extraction formats do not change numerical calculations.

This remains running analysis with distance/time/pace targets and Intervals.icu actuals. HR-, power- or RPE-only prescriptions, unavailable source intervals and unreadable files cannot be fully assessed; never manufacture pace targets or claim all sports/file formats are supported.

At most 200 supplied steps and 200 source intervals; source indexes are 1-based, bounded and unique across the entire mapping. Unknown properties, invalid dates, reversed/empty pace bounds, nonpositive targets and durations without an explicit basis are rejected. Targets are bounded to 100 km, 24 hours and 3600 s/km. These are implementation bounds, not physiological recommendations. Expand repeat sets explicitly; there is no text parser or plan generator in the server.

## Output and calculations

`analysis.method_version` is `running-execution/1.0.0`. Status is ok/limited/unconfirmed_match/unsupported_sport; ok means the supplied comparison is usable, not that execution met every target. Each supplied step reports its targets, selected source indexes, actual coverage-aware distance/moving/elapsed totals, average pace, target differences, pace-range assessment and reasons. Unsupported sports produce no running comparisons.

- Differences are actual − target, in m or s. Duration uses the requested moving/elapsed field without substitution.
- One interval's pace is 1000 / positive source average_speed, never filled from distance/time. Multiple mapped intervals use pooled moving pace = 1000 × sum moving_time / sum distance, with all positive inputs required.
- Pace classification is faster_than_range/within_range/slower_than_range against supplied bounds, with the existing floating-point boundary tolerance. Difference to the nearest violated bound is negative when faster, positive when slower, zero within range. An absent pace target is not_requested; missing evidence is unavailable. No implicit tolerance or overall execution score is invented.
- A no-faster-than pace ceiling maps to the lower seconds/km bound only; slower running remains within that prescription's one-sided numerical constraint. This does not establish easy physiological effort.
- Single source intervals cannot be split across planned steps without streams. Missing mappings are unmapped, not failed/skipped. Unassigned actual intervals and missing requested indexes remain visible. Complete/partial refers to the supplied prescription, not independently verified full-session coverage.
- Truncation or invalid/overlapping source timing blocks comparisons. Missing required metrics block only their comparisons. Missing selected intervals block that step, while other independently usable steps remain visible. Known sums remain labeled subtotals.

Step order is checked separately when timestamps cover every supplied mapping. Reordered/interleaved steps and unverified chronology are flagged without silently reassigning source positions or discarding otherwise usable per-step observations.

All private operations reuse existing owner OAuth, activity ownership checks, response identity checks, GET-only retrieval and the 200-interval bound. Inputs/targets are not logged or persisted; only synthetic fixtures belong in source. No account writes or automatic plan changes are authorized by a review.

## Validation

Run `pnpm check`, `pnpm types:portable`, `pnpm types:check`, `pnpm verify:runtime` and `pnpm test:fresh`. Numerical fixtures exercise heterogeneous repetitions, elapsed rest, pace limits, split laps, missing/partial data, explicit matching and unsafe mappings. Protected MCP and workerd/Inspector tests cover the new tool. Synthetic tests do not establish live provider integrations, file parsing support, export fidelity or original-prescription retention.

Local verification on 2026-11-23: all commands above passed, including the provider-neutral contract regressions in 23 files, both runtime tests and relocated skill installation/diagnostics for all three supported local targets. The skill metadata validator and diff whitespace checks also passed. This records local synthetic validation; no new tool deployment, release, commit or independent model-behavior benchmark is implied.
