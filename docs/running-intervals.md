# Running interval analysis

Added in **v1.3.0** of the read-only server. No deployment or marketplace update is implied. Existing tools retain their contracts; the new calculation contract is `running-intervals/1.0.0`.

## Example

After locating the activity, invoke `analyze_running_intervals` with:

```json
{
  "activity_id": "synthetic-interval-session",
  "work_interval_indexes": [2, 4, 6, 8, 10],
  "target_pace_s_per_km": 310
}
```

This selects five repetitions from the source response and compares each with 5:10/km. Indexes are optional, unique, 1-based source positions, at most 200; they are not source IDs or chronological positions. Inspect `get_activity_details` with `include_intervals: true`, or the new tool's default result, before selecting positions. Never assume that alternating positions are work without examining the returned structure. Target pace is optional, positive and at most 3600 s/km.

Without explicit indexes, exact source `WORK` types select work and `RECOVERY` types select recovery. Explicitly selected recovery becomes work. Other types stay other; names and labels never select purpose. Source WORK can include warm-up/cool-down. Preserve names/labels as untrusted data. Intervals.icu analysis intervals are not guaranteed original device laps or prescribed repetitions.

## Calculations and interpretation

- Each repetition retains normalized source distance (m), moving/elapsed duration (s), HR (bpm), cadence and power. Pace = 1000 / positive source average speed, in s/km. Missing or zero speed produces null pace; distance/time is not substituted.
- A work repetition's target difference = actual pace − supplied target pace. Positive means slower; negative means faster. This is a numerical difference without a pass/fail threshold.
- Work/recovery totals retain known sums and recorded/missing counts. One absent metric makes that complete total null. Zero totals for an empty returned group do not establish that no work occurred.
- Pooled moving pace = 1000 × sum moving time / sum distance. All group distances and moving times must be positive. It is independent of source-speed repetition pace and can differ from it.
- Work pace statistics weight repetitions equally: mean, median, min/max and sample standard deviation (denominator n − 1). CV = 100 × sample SD / mean pace. All work paces are required; SD/CV need at least two. These are descriptive statistics, including for mixed-length or mixed-purpose work, without an execution grade.
- First/last pace changes use work intervals sorted by valid start timestamps, with complete start/end timing and no overlap. Absolute change = last − first; percent = 100 × (last − first) / first. Positive means slower. Missing middle paces do not prevent a change between recorded endpoints; work pace coverage is reported separately.

`analysis.provenance` identifies source fields, formulas and units. Existing `endurance-analytics/0.2.0` calculations are unchanged.

## Quality and bounds

`analysis.status` is `ok`, `limited`, `insufficient_evidence` (no selected work) or `unsupported_sport`. Only Run, TrailRun and VirtualRun support the calculations. A single work interval is limited, with no variability or first/last change. Missing work/recovery metrics also limit the result.

At most 200 intervals are returned, using the existing bounded detail retrieval. Truncation, missing requested indexes, invalid timing (end ≤ start), or known overlapping intervals withhold complete group totals, pooled pace, work statistics and chronological changes. Known subtotals and individual metrics remain visible. These checks span all returned intervals, including other types, because aggregate overlap may double-count work. Missing timing alone permits unordered statistics but prevents first/last changes. Source positions remain unchanged even if chronology differs.

Coverage describes the returned source intervals, not independently verified synchronization or full activity coverage. No raw streams, GPS, cardiac drift, HR recovery kinetics, physiological fatigue score or race prediction are computed.

## Integration and verification

The service reuses activity-detail ownership verification before fetching intervals. It checks the interval response activity ID, retains the 200-row bound, uses GET-only upstream operations and preserves safe MCP errors and privacy-conscious logs. There is no new persistence or external integration.

Synthetic tests cover known repetition arithmetic, source selection versus chronology, missing values, invalid input, unsupported sports, incomplete timing, overlap, truncation, ownership and authenticated MCP calls. Run `pnpm check`, `pnpm types:portable` and `pnpm verify:runtime`; these do not verify a live athlete account. The upstream [official API](https://intervals.icu/api/v1/docs) documents the activity intervals endpoint; this tool uses the existing adapter without expanding its field selection or endpoints.

Local verification on 2026-11-22: `pnpm check` passed (254 tests in 21 files, types, lint, skill and distribution checks); `pnpm types:portable` passed; `pnpm verify:runtime` passed its dry-run build and both runtime tests, including the new tool through Inspector in both protocol eras. The skill metadata validator also passed. Wrangler reported a sandbox warning when attempting to write its default log file; the build and runtime checks completed successfully. These checks used synthetic training data and did not access a live athlete account or deploy the Worker.
