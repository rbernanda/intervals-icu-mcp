# Deterministic analytics — v0.2

The analytics foundation adds three read-only tools to the original seven. Pure `src/analytics/` functions consume normalized records and an explicit date context. `src/tools/analytics/` validates inputs, fetches bounded source data, invokes those functions and validates outputs. `src/intervals/analytics-normalizer.ts` adds analytics fields without changing legacy output shapes. No authentication, storage, deployment configuration or SDK migration is required.

“v0.2” identifies this feature milestone and the `endurance-analytics/0.2.0` calculation method. Existing package/server version metadata remains unchanged; this work does not create a release or downgrade the existing v1.0.0 release.

## Verified source semantics

Verified on 2026-11-14 against the current [official OpenAPI](https://intervals.icu/api/v1/docs) and [maintainer field guide](https://forum.intervals.icu/t/download-all-activities-in-csv-format/599). The schema establishes field names/types; the field guide supplies physical units. Historical guide names can differ from current API names, so only current schema fields are requested.

| Source                                 | Normalized use                      | Semantics / limitations                                                                                                                                                                                                   |
| -------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Activity `type`                        | `sport_type`                        | String, not a closed API enum. Existing running family is Run/TrailRun/VirtualRun; other filters match exactly, case-insensitively. Unknown-to-code types remain valid generic activities. Absent type is a coverage gap. |
| `start_date_local`                     | `start_local`                       | Offset-free local timestamp; never append Z. Activities queries use inclusive local `oldest`/`newest`. Wellness `id` is a local ISO calendar date.                                                                        |
| `distance`, `total_elevation_gain`     | `distance_m`, `elevation_gain_m`    | Meters. Elevation gain alone is not a terrain profile.                                                                                                                                                                    |
| `moving_time`, `elapsed_time`          | Separate `_s` metrics               | Seconds; preserve both.                                                                                                                                                                                                   |
| `average_speed`, `average_heartrate`   | m/s, bpm                            | Positive values required for efficiency; source speed need not equal distance/moving time.                                                                                                                                |
| `icu_training_load`                    | `training_load`                     | Original source-defined load, which can use power, HR, pace or edited values. Do not relabel every value TSS or reconstruct it.                                                                                           |
| Activity `icu_ctl`, `icu_atl`          | Preserved by existing source schema | Activity-context fitness fields are not substituted for dated daily wellness.                                                                                                                                             |
| Wellness `ctl`, `atl`                  | Source Fitness/Fatigue context      | Source calculations, never reconstructed. Latest in-period row is dated and may be stale or incomplete. Fitness context is all-sport.                                                                                     |
| Daily Form/TSB                         | `source_form_tsb: null`             | No explicit daily source TSB is documented. Analytics `computed_same_day_form = ctl - atl` is labeled computed; legacy `computed_form` remains unchanged. Neither is percentage or previous-day Form.                     |
| `icu_efficiency_factor`                | `source_efficiency_factor`          | Numeric field exists. OpenAPI does not specify its unit or per-sport basis. Preserve unchanged; do not equate it to average speed/HR, aggregate it across bases or synthesize missing values.                             |
| `decoupling`                           | `source_decoupling`                 | Optional numeric source value. Calculation basis, sign convention and units are not established by the schema. No custom decoupling calculation or stream fetch is added.                                                 |
| `trainer`, `sub_type`, `icu_ignore_hr` | Setting/subtype/usable-HR checks    | Boolean trainer flag; subtype enum currently includes NONE/COMMUTE/WARMUP/COOLDOWN/RACE. No reliable easy/threshold/interval classification is documented. Ignore-HR records cannot qualify for the proxy.                |

The [maintainer's aerobic-tracking discussion](https://forum.intervals.icu/t/aerobic-tracking/702) describes power/HR and cleaned, lag-adjusted samples. The [running discussion](https://forum.intervals.icu/t/decoupling-for-running/24856) distinguishes power-based metrics and possible speed/GAP alternatives. These do not establish a universal current EF formula for every activity. Source EF and the custom proxy therefore stay separate.

## Dates and coverage

- Inputs use explicit inclusive `YYYY-MM-DD` dates, at most 90 days per period. Comparison periods cannot overlap, even on one boundary day. They need not be adjacent or equal length; unequal exposure is flagged.
- The instance's configured athlete IANA timezone is authoritative, as for the original tools. Invalid/missing timezone fails before data retrieval. If the source profile differs, resolve configuration before a boundary-sensitive analysis.
- An injected instant resolves athlete-local today using `Intl`. Date-only UTC arithmetic counts local calendar dates across DST, not 24-hour elapsed durations.
- To compare completed rolling weeks, use yesterday through six days before it, versus the preceding seven dates. Including today explicitly produces a partial-day warning; no extrapolation is performed. Future requested days are also flagged.
- The API cannot prove synchronization completeness. MCP results always use `inventory_coverage: unknown` or `partial`, never independently `verified`. Pure-library callers can provide verified coverage only with an independent inventory; tool inputs cannot assert it.
- `actual_activity_range` is the span of valid returned in-range activity dates, not a claim that intervening dates are fully covered. An empty success means `no_activities_returned`, not no exercise. Nonempty candidates with none eligible report `no_eligible_activities`. Verified zero coverage is a separate library-only state.
- Identical normalized records sharing an ID count once, with explicit duplicate counts. Conflicting same-ID records are quarantined and block complete totals. Distinct IDs at the same start are retained with a possible-overlap warning, since they may represent legitimate sessions. Deduplication does not merge sessions by names/times.
- Source stubs, missing dates/types and saturation prevent complete returned-record totals. API failure remains a safe tool error, never an empty analytical success.
- Upstream calls retain the existing timeout/retry/deadline and 1000-record sentinel bounds. Sample outputs cap at 100 efficiency sessions or 20 workouts; quality decisions cap at 100 with counts/reasons for the full candidate set and `decisions_truncated`.

## Shared numerical and provenance rules

Keep full precision until presentation. Compensated summation reduces floating-point cancellation. Inclusive comparison boundaries allow only a scaled 32-machine-epsilon rounding tolerance, so mathematically exact thresholds such as +2% or a 10% distance difference are not rejected by binary floating-point roundoff. Reported numbers are not rounded. Nonfinite/negative external distance/duration/load is rejected; zero distance/time is meaningful for volume but ineligible for a running proxy. Nulls are never replaced by zero.

Every important metric supplies compact provenance: `origin` (`intervals_source` or `computed`), `source_field`, `method`, and `unit`. Result `method_version`, dates, sample/record counts and quality metadata supply reproducibility context. Summing source load is a **computed aggregate of source values**, not a new source metric.

For baseline B and current C, absolute change = C − B. Percentage = `100 * (C − B) / B` only for B > 0. B = 0 gives `ZERO_BASELINE` and a null percentage while preserving the absolute difference. Missing operands give `MISSING_VALUE`; signed nonpositive Form baselines have no percentage. Negative Form is not an overtraining diagnosis.

## Training volume and load comparison

`compare_training_periods` accepts:

```json
{
  "current": { "start_date": "2026-02-16", "end_date": "2026-02-22" },
  "baseline": { "start_date": "2026-02-09", "end_date": "2026-02-15" },
  "sport_type": "running"
}
```

Sport-neutral calculations cover activity count, distance m, moving/elapsed s, original source load, mean load/activity, longest activity distance, weekly-normalized distance and moving duration. Omit sport to aggregate all returned sports deliberately; a running filter never includes rides/swims. Different sport distances/load methods may not be directly comparable.

Each total reports `value`, `known_sum`, recorded/missing counts, `complete_returned_records`, unavailable reason and provenance. All selected records must provide a valid metric and structural coverage must be usable for `value`. `known_sum` is a labeled subtotal, null if no value is recorded in a nonempty sample. Empty returned samples sum to zero **within the returned-record scope**; this does not certify a zero-training period. Mean load = complete load sum / selected activity count, null for no activities. Longest distance requires all selected distances and is null for no activities.

Weekly-normalized volume = total × 7 / inclusive period days. It describes recorded exposure; it does not predict a full week from a partial week. Separate source fitness/fatigue changes use each period's latest in-period wellness row, with date/staleness; missing dates/values remain missing. Conflicting CTL/ATL records on the latest date produce null context values with `CONFLICTING_FITNESS_RECORDS`, rather than choosing by order or silently using another day. Current-day, future, unequal or structurally partial periods produce limited comparability. Inventory uncertainty is always disclosed even for comparable returned records.

Reference arithmetic: 40→50 km = +10 km/+25%; 50→40 = −10 km/−20%; 0→10 = +10 km/undefined percentage; 10→0 = −10 km/−100%.

## Running comparability

`compare_running_workouts` requires `start_date`/`end_date`; optional `sport_type` defaults to running, `limit` to 5 (2–20), `session_type` to any. Optional `activity_ids` (1–100 unique IDs) designate athlete-selected purpose; `reference_activity_id` can select a valid in-scope reference. Otherwise the latest initially eligible activity is the reference. Results select the latest eligible sessions and display them chronologically; every rejection has reasons. A missing/invalid requested reference yields insufficient evidence.

Settings are conservative, configurable **selection heuristics**, not physiological laws:

| Setting                             | Default |
| ----------------------------------- | ------- |
| `min_duration_s`                    | 1800    |
| `max_duration_difference_fraction`  | 0.25    |
| `max_distance_difference_fraction`  | 0.25    |
| `max_elevation_difference_m_per_km` | 10      |
| `max_hr_difference_bpm`             | 10      |
| `require_hr`                        | true    |

Compare each candidate to the reference: absolute relative distance/duration difference ≤ tolerance, HR difference ≤ bpm tolerance, elevation gain per km difference ≤ tolerance. Running types must match exactly; known differing trainer flags exclude. Missing elevation/setting adds caveats. Run does not establish road/outdoor, and VirtualRun does not establish treadmill. Missing cadence/power does not exclude a run. HR may be explicitly waived for ordinary workout comparisons, with caveats; efficiency always requires usable HR.

Supported `session_type`: any/easy/long_run/threshold/intervals. Easy/threshold/interval categories require explicitly selected IDs; names are not parsed for classification. Without IDs, long_run uses a labeled ≥90-minute candidate heuristic, not proven purpose. Source races are excluded from non-race categories. The tool compares whole-session summaries only; selected interval details remain necessary for repetition analysis.

High comparability means at least two selected sessions pass the rules with explicit purpose selection and no setting/elevation/HR caveats. Moderate means eligible sessions have such caveats or unclassified/heuristic purpose. Unavailable means fewer than two. These levels are explainable rule outcomes, not confidence scores. Weather, terrain, measurement changes and within-session effort remain unverified.

Individual pace = `1000 / source average_speed`, s/km. Pooled moving speed = `sum distance / sum moving time`, m/s; pooled moving pace = `1000 * sum moving time / sum distance`, s/km, requiring complete positive inputs. Do not arithmetic-average paces or confuse this pooling with an individual source average. Speed descriptive statistics weight sessions equally and identify sample SD (n−1).

## Running aerobic efficiency

`analyze_aerobic_efficiency` uses the same date/sport/settings structure and accepts `steady_aerobic_activity_ids` (up to 100 unique athlete-designated steady aerobic sessions). Without classification, it returns insufficient evidence. Do not select hard intervals merely because their average HR looks low or their name says “easy.” Explicit classification is an assumption from athlete context, not stream validation.

Only usable positive HR/speed/distance/moving time, minimum duration, same running type and anchor-relative comparability qualify. RACE/WARMUP/COOLDOWN subtypes do not qualify. Optional `max_average_hr_bpm` is a caller-specified ceiling, not an inferred aerobic threshold. Source `icu_ignore_hr` excludes unusable HR even if a number is present. Cycling/swimming/other non-running efficiency returns `unsupported_sport` with no proxy.

For source speed v in m/s and average HR h in bpm, `speed_hr_proxy = v / h`, unit `(m/s)/bpm`. Source EF and decoupling remain separate sample fields and are not pooled. This proxy is not laboratory running economy, VO2max, oxygen cost or a source prediction.

Split the requested period after floor(inclusive days / 2): early dates precede `split_date`; later dates start on it. Report equal-session mean, median, min/max and sample SD for each half and overall. Require at least `min_samples` (default 4, minimum 4), with at least two in each half. Otherwise retain observed samples but return insufficient evidence and no trend change.

Change compares later mean to early mean. `change_tolerance_percent` defaults to 2: changes within ±2% are `within_tolerance`, otherwise observed `increase`/`decrease`. This tolerance is descriptive and configurable, not a test of statistical significance or a meaningful physiological threshold. Never extrapolate or infer causation from the ratio. Environment, sensors, pauses, HR lag and effort distribution can alter it.

## Reproduce validation

```bash
pnpm check
pnpm types:portable
pnpm verify:runtime
```

Synthetic Vitest cases cover arithmetic, missing values, duplicates, sports, DST/local boundaries, eligibility, sparse/trending series, source/proxy separation, authenticated discovery/invocation and safe errors. Skill regression tests exercise real services against mocked fetch and check orchestration contracts; they do not demonstrate live athlete access or independently prove LLM activation. See [analytics validation](analytics-validation.md) for executed results and remaining boundaries.
