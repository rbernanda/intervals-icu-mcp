# Changelog

Repository releases use [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The historical v0.1/v0.2 names describe implementation milestones, not the already published repository tags. Published versions must not be replaced.

## [Unreleased]

## [1.4.0] — 2026-11-23

- Add stateless `review_running_execution` for explicit existing-plan/activity association, per-step distance/duration/pace targets, source interval mapping and quality-aware comparison. Preserve moving versus elapsed rest and one-sided pace limits.
- Add provider-neutral prescription attribution and optional read-only skill orchestration for available connected sources or user-supplied text/documents/exports. COROS is an optional retrieval example; unknown schedule dates remain unknown. Preserve degraded-export and original-prescription limitations. No duplicate plan, profile storage, provider credentials, writes or plan adaptation.
- Add running-execution/1.0.0 calculation contract and twelve-tool discovery; existing eleven tool contracts and owner OAuth remain unchanged. Server, scripts and canonical skill share release version 1.4.0.
- Update development dependencies: Workers types 5.20261117.1, Stylistic 6.0.1, ESLint 10.15.0, TypeScript 6.0.3 and Vitest 5.1.0. Resolve overlapping lockfile changes and validate the combined toolchain.

## [1.3.0] — 2026-11-22

- Add read-only `analyze_running_intervals`: bounded repetition metrics, explicit work selection, target pace differences, coverage-aware work/recovery totals, descriptive pace consistency and timing-verified first/last changes.
- Preserve existing tool contracts and ownership checks; update skill routing, discovery diagnostics and synthetic regression coverage for eleven tools.
- New interval method: `running-intervals/1.0.0`; existing analytics methods remain unchanged. Server, scripts and canonical skill share release version 1.3.0.

## [1.2.0] — 2026-11-14

Stable portable-distribution milestone (originally called v1.0 in the roadmap), promoted from v1.2.0-rc.1 without changing tool contracts or analytics methods.

- Add a project-scoped portable skill installer for Codex, Claude Code and Cursor, with complete resource copies, version/checksum receipts, safe reruns and explicit managed updates.
- Add privacy-conscious local and optional authenticated remote `doctor` checks, including identity, discovery, activity retrieval and deterministic comparison validation.
- Add distribution/version/link checks, a validated skill archive with license/checksum, fresh-source install tests, client guides, a synthetic first-insight example and release/upgrade/rollback procedures.
- Align package, server and skill release identity. Numerical method version remains `endurance-analytics/0.2.0`; existing tool contracts, authentication and calculations are preserved.
- Expand CI with clean installation, artifact and dependency checks. No automatic deployment, npm publication or marketplace integration.

## [1.1.0] — 2026-11-14

- Deterministic training volume/load period comparisons, running aerobic-efficiency proxy trends and comparable running workouts.
- Ten read-only MCP tools; explicit quality, provenance, missing-data and athlete-local date handling.
- Existing Training Analyst Skill updated to prefer analytical tools. No production analytics deployment implied.
- Historical package/server identity remained 1.0.0 in this tag; corrected in the distribution candidate.

## [1.0.0] — 2026-11-14

- Initial self-hosted read-only Intervals.icu server and portable Training Analyst Skill.
- Streamable HTTP, single-owner GitHub OAuth, Workers deployment preparation and synthetic protocol/security tests.
