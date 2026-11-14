# Your first weekly insight

This worked example is **synthetic**, not a private athlete export. It illustrates the evidence a connected client should retrieve, not canned output to substitute for your records.

Ask:

```text
Review my running over the last seven completed local days against the preceding seven.
Use compare_training_periods. Include distance, moving duration, source training load,
source CTL/ATL and labeled computed same-day form. Retrieve relevant wellness if available.
Explain incomplete data and distinguish observations from interpretation.
```

## Expected orchestration

1. Confirm the MCP registry exposes ten read-only tools. Verify the athlete profile and timezone using `get_athlete_profile`; do not print identity in public diagnostics.
2. Resolve dates using that timezone, excluding today for two completed seven-day windows. For an example athlete-local day **2026-03-09**, use current **March 2–8** and baseline **February 23–March 1**, inclusive.
3. Invoke `compare_training_periods` with those explicit ranges and `sport_type: "running"`. Read the returned quality, coverage and provenance. Do not redo deterministic calculations.
4. Optionally call `get_wellness` for relevant recovery context; missing HRV/RHR/sleep stay missing. Use `get_recent_activities` or details only for a specific observation requiring them.

## Example evidence and interpretation

| Metric                                                              | Baseline | Current  | Computed change                                 |
| ------------------------------------------------------------------- | -------- | -------- | ----------------------------------------------- |
| Returned running distance                                           | 28,000 m | 30,000 m | +2,000 m; +7.14%                                |
| Moving duration                                                     | 8,940 s  | 9,500 s  | +560 s; +6.26%                                  |
| Source activity training-load sum, all returned activities recorded | 150      | 160      | +10; +6.67%                                     |
| Latest available source CTL / ATL                                   | 45 / 50  | 46 / 62  | CTL +1; ATL +12                                 |
| Computed same-day CTL − ATL                                         | −5       | −16      | −11 source load units; not source-provided Form |
| HRV / resting HR                                                    | Missing  | Missing  | Unavailable; do not infer recovery              |

A grounded review can say returned running volume and source load increased, while source ATL rose more than CTL. It cannot diagnose overtraining from negative form or infer physiological improvement/recovery from this table. Keep the specific endpoint dates and field provenance in the response. Synchronization coverage remains unknown unless separately verified, even when all returned activities have metrics.

If one activity lacks training load, report the known subtotal and missing count; the complete total/change is unavailable. Zero baseline makes percentage change unavailable. No activities returned is distinct from confirmed zero training. An error or absent tool is a connection/coverage limitation, never permission to fill in remembered or fabricated records.

Successful acceptance requires real calls in your client and a private comparison against Intervals.icu. Synthetic tests and this example do not establish live access, skill invocation or useful data for your account.
