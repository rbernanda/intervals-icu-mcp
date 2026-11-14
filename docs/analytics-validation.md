# Analytics v0.2 validation

Executed locally on 2026-11-14 with Node.js 22.23.4 and pnpm 10.34.9. All activity/wellness fixtures are synthetic; no live athlete data or production credentials were used. This records the feature implementation, not a new release or production deployment.

## Actual results

| Check                                      | Result                                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Baseline `pnpm test` before changes        | 114 tests passed in 10 files                                                                       |
| Final `pnpm check`                         | TypeScript, ESLint/Prettier, skill validation, 198 tests in 17 files and publication checks passed |
| `pnpm types:portable`                      | Passed, including analytics without Workers types                                                  |
| `pnpm verify:runtime`                      | Dry-run Worker build and 2 workerd runtime tests passed                                            |
| Build size                                 | 1578.72 KiB; gzip 290.75 KiB                                                                       |
| `pnpm types:check`                         | Generated Worker bindings unchanged and current                                                    |
| Built-in skill-creator `quick_validate.py` | Passed                                                                                             |
| `git diff --check`                         | Passed                                                                                             |

The tsx CLI needs a local IPC socket, and workerd/Inspector need loopback listeners. Those checks ran with local sandbox permission; none used a production deploy command. The build script invokes Wrangler with `--dry-run`. No package or lockfile changes were required.

## Numerical and quality coverage

- Positive/negative/zero-baseline/missing differences, physical units, duration and distance aggregation, source load coverage, pooled distance/time speed and pace, sample standard deviation and floating-point precision.
- Reference arithmetic: 40→50 km (+25%), 50→40 km (−20%), 0→10 km (undefined percentage), 10→0 km (−100%). Inclusive tolerance boundaries, including ±2% and fractional distance differences, tolerate binary rounding without rounding outputs.
- One/all missing loads, empty returned versus verified-zero library coverage, exact/conflicting duplicate IDs, retained distinct simultaneous sessions, sport filters, unknown/absent types, saturation and restricted stubs.
- Source wellness CTL/ATL, dated/stale context, explicit computed same-day form, missing fitness and conflicting same-date fitness records. No source TSB is fabricated.
- Athlete-local midnight/inclusive dates, different timezones, DST spring/fall transitions, invalid/unavailable timezone, reversed/overlapping/oversized periods, unequal windows and partial-current/future-day flags.
- Running eligibility, missing/zero/ignored HR, absent/invalid speed, short sessions, unclassified interval-like runs, source races, known trainer/type mismatches, elevation/duration/distance/HR mismatches, unknown setting/elevation caveats, optional missing power/cadence and sparse histories.
- Increasing/decreasing/within-tolerance speed/HR patterns, equal-session descriptive statistics, disjoint early/later windows, required sample counts, source EF/proxy separation, unsupported cycling/swimming, input-order reproducibility and bounded selections/decisions.

## MCP and security coverage

The official MCP client initializes the same authenticated Streamable HTTP transport and discovers ten read-only tools. Existing seven-tool regression behavior remains covered. All three new tools are invoked with mocked upstream responses and their structured outputs are validated against actual schemas.

Tests reject missing, invalid, expired, wrong-owner and wrong-scope OAuth tokens before upstream data access. They check strict arguments, SDK/service double validation of defaults, upstream failures, safe error bodies, secret redaction, privacy-safe logs, source-field selection, response bounds and GET-only upstream operations. No new endpoint, authorization flow, database or persistent analytics cache was added.

The built Worker runs in workerd. MCP Inspector performs strict discovery, original profile invocation and deterministic period-comparison invocation in both supported protocol eras. The smoke script verifies unauthorized rejection, ten-tool discovery and validated original profile/activity retrieval. All outbound runtime responses are synthetic; this is not live Intervals or hosted ChatGPT validation.

## Skill regression scope

The canonical ten-file skill and repository discovery symlink remain intact. Validation checks frontmatter, relocatable links, templates, metadata and documented names against actual ten-tool discovery. Four workflows remain available; preferences select analytical tools for period, efficiency and workout comparisons while retaining details/wellness/calendar retrieval and an explicitly disclosed older-server fallback.

Ten new scenario specifications cover weekly comparison, aerobic proxy, five long runs, missing HRV/resting HR, negative computed form, insufficient history, unsupported cycling efficiency, missing analytics tools, disconnected MCP and unrelated programming. Vitest executes the **declared** service contracts and checks skill guidance; hostile activity text also passes through the analytics service without credential access or additional network calls.

These are deterministic contract/fixture regressions. They do **not** prove independent LLM tool selection, automatic activation, prompt-following reliability or comparative model performance. The earlier skill's partially completed model evaluation is recorded separately in [initial skill validation](training-analyst-validation.md). No new independent model benchmark is claimed.

## Remaining boundaries

- No live Intervals API retrieval or deployed analytics endpoint was tested for this change.
- No production deployment, commit, push, publication, tag or release was performed. Existing deployed instances keep their old tools until explicitly updated.
- Hosted ChatGPT and Claude Code use of the updated analytics skill was not tested. Local skill installation does not update a ChatGPT plugin or authorize MCP.
- The API cannot certify synchronization completeness or reliably classify every easy/steady/threshold/interval session. Strict aerobic analysis requires athlete-designated sessions; source EF/decoupling retain unresolved source-specific basis/units.
- Raw streams, custom drift, physiology/race predictions and sport-specific cycling/swimming efficiency remain unsupported. See [methodology](analytics-methodology.md) for exact formulas, units and selection assumptions.
