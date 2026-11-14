# Analysis methods

Use only the section relevant to the chosen workflow. These are descriptive comparisons, not diagnostic models. Obtain data through the connected MCP tools; use local deterministic arithmetic where useful, without exporting private data or adding network services.

## Dates, aggregation and coverage

- Resolve a reliable current instant into the configured athlete timezone. A rolling N-day window includes today: start = end minus (N − 1) calendar days. Use calendar-date arithmetic across DST, not elapsed local hours. Each request covers at most 90 inclusive days.
- “This week” means local Monday through today unless the athlete defines another week. “Last week” means the previous complete Monday–Sunday. “Last seven days” is rolling, not necessarily a calendar week. Compare a partial week to the same elapsed days of its prior week, or disclose unequal coverage; never present a partial week as a full-week decline.
- For historical periods, retrieve activities with explicit dates; rolling `get_training_summary` cannot set its end date. Reuse its complete, covered totals when it does match the intended rolling period. A limited/saturated recent list is not a full-period dataset. Split only within the relevant requested range if needed, without overlapping dates; deduplicate by activity ID.
- Sum completed activity distance (m), moving time (s), elapsed time (s) and load separately for the stated sport filter. Do not count planned events as completed training. If any selected record lacks a metric, report its total unavailable with n recorded/N selected, or an explicitly labeled recorded-only subtotal. Unknown/missing records mean unverified completeness. Empty successful ranges mean zero retrieved records, not zero real-world training.
- Weeks start Monday; label partial edge weeks. Equivalent average weekly volume = complete period total × 7 / inclusive day count. This normalizes covered days, not full-week observations. A longest run requires recorded distance and a sufficiently complete candidate set. Long-run contribution = selected long-run distance / complete period running distance × 100%; undefined when the denominator is zero/missing. The longest session is not automatically a purposeful long run.
- Report source daily CTL/ATL, dates and gaps. Latest fitness may precede period end and be all-sport even for a running-filtered summary. Never interpolate missing wellness or reconstruct CTL/ATL.

## Period comparison and trend evaluation

For matched periods with complete, comparable metrics A (current) and B (baseline), report absolute change A − B in the metric's unit. Percentage change = 100 × (A − B) / B only when B > 0; for B = 0 say percentage unavailable and report the absolute change. Do not average pace strings or training-load values from incompatible methods.

For pooled pace, prefer a consistent definition: `1000 × sum(moving_time_s) / sum(distance_m)` in seconds/km, with full positive distance/moving-time coverage, explicitly labeled an agent-computed moving-time pace. It can differ from source speed-derived pace. Alternatively compare individual source paces and their distribution without conflating definitions. Keep full precision until presentation.

Report sample size, date span, excluded sessions and coverage for every trend. Compare representative early/late subsets using a consistent metric and include variability/outliers, not just the best session. A pair of sessions supports a comparison, not a robust trend; a few sessions cannot establish physiological adaptation or causation. Do not extrapolate sparse observations into forecasts.

Do not apply a universal “safe weekly percentage,” acute:chronic ratio threshold or negative-form cutoff as an injury/overtraining rule. Describe changes and the athlete's available context, including gaps.

## Post-workout execution

Locate the session without assuming the latest activity is a run. With an explicit activity ID, fetch details; with “yesterday,” resolve the local date and list the relevant run(s), clarifying if needed. Use source sport, duration/distance and interval structure to describe a likely session type; a name alone is weak evidence.

For interval consistency, compare WORK bouts of comparable duration/distance; keep recoveries and warm-up separate. Show pace/power/HR variation only where recorded. Source analysis intervals are not guaranteed device laps, and absent/truncated intervals limit execution claims. Compare plan versus completion only through explicit calendar pairing; otherwise state the plan is unverified.

Whole-run means support an overview, not a claim about rising HR or late-session pacing. Explain what the exposed summaries cannot establish before offering plausible factors such as intensity, hills or measurement variation; do not assert unrecorded heat, dehydration or fueling.

## Comparable activities and aerobic efficiency proxies

Choose inclusion criteria before ranking results: same sport/setting (outdoor/treadmill if known), similar purpose/intensity, duration/distance and elevation. Treat TrailRun, Run and VirtualRun separately unless a justified comparison is possible. Terrain, weather and device changes are not exposed by these tools; use only athlete-provided context and mark unknown factors. Do not infer treadmill status from VirtualRun alone or course conditions from a name alone.

For “five long runs,” describe the selection rule (user-designated long runs, or a clearly labeled duration/distance-based candidate heuristic), then confirm comparable purpose. If only three suitable sessions exist, compare three and explain the gap rather than padding with races, trail runs or short fast sessions.

Where consistent positive speed v (m/s) and average HR h (bpm) exist in comparable mostly steady runs, an **aerobic efficiency proxy** is E = v / h, units `(m/s)/bpm`. Relative change = 100 × (E_recent / E_baseline − 1), only with positive comparable baselines. Missing or implausible HR/speed invalidates the proxy. If effort varies, summaries alone cannot establish matched HR; say so. Optionally show observed source pace/HR pairs without computing a score.

Report included n/N and assumptions, not statistical certainty. HR lag, pauses, hills, mixed intensities, environment and sensor differences can change this ratio. It is not VO2max, oxygen cost, lactate threshold or laboratory running economy. Faster pace at similar average HR is an observation, not proof of an adaptation or its cause.

## Heart-rate drift / decoupling boundary

Proper within-session decoupling requires comparable steady segments with aligned speed (or suitable power) and HR, with warm-up, stops and changing workload excluded. For two eligible segments, E1 = v1/h1 and E2 = v2/h2 as above; an explicitly defined efficiency-drop percentage is D = 100 × (E1 − E2) / E1. Sign conventions differ; state this one. Do not apply universal diagnostic cutoffs.

This MCP does not expose streams or a dedicated decoupling metric. Comparable source intervals may support only a **segment-level descriptive proxy** when timing, workload and HR coverage are sufficient; otherwise report drift as unassessable. Whole-session averages, an HR maximum or unaligned intervals cannot prove drift, dehydration or poor aerobic fitness. Do not claim to have examined a continuous trace.

## Race preparation evidence

Resolve race distance/date/goal before a goal-specific judgment. For distance d meters and target T seconds, required average pace = `1000 × T / d` seconds/km. This is arithmetic describing the target, **not a finish-time prediction**. State if official distance, course, conditions or timing basis are unknown.

Use 42–90 relevant recent days where available; avoid requesting entire histories. Review consistency, completed race-specific sessions, long runs, recent actual performances and taper context. Separate easy-run pace from race effort, and short repetitions/recovery breaks from continuous race-distance performance. Fitness/load trends and wellness provide context, not a definitive readiness score. Planned calendar workouts do not prove preparation already completed.

Show supporting evidence, conflicting evidence and missing evidence. A sparse history may support only a limited snapshot. Do not implement a race-time estimator in v1, convert VO2max to a time, promise a target or prescribe an aggressive taper increase to improve CTL. Ask for material race/context details and discuss conservative considerations without diagnosing health conditions.
