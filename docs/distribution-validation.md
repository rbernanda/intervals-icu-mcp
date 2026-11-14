# Portable distribution validation

Candidate **1.2.0-rc.1**, reviewed **2026-11-14**. This is the portable-distribution milestone; previously published v1.0.0/v1.1.0 tags are not replaced. No production deployment, publication or remote push is part of this validation.

## Evidence boundaries

- Automated tests use synthetic Intervals records and the existing real OAuth provider with fixture grants. No real athlete records or credentials are required.
- A source-only temporary checkout excludes all ignored local state, installs locked dependencies, runs checks/build/protocol tests and installs the skill into a separate project for all three target paths.
- Filesystem/resource tests do not prove Claude Code or Cursor selected/invoked a skill. Live OAuth, ChatGPT connection and a real weekly review are separate owner-run checks.
- Doctor checks presence/formats locally; remote checks are opt-in and never print private payloads. An unexecuted check is `NOT_TESTED`, not `PASS`.

See [analytics validation](analytics-validation.md) for the earlier numerical milestone and [compatibility](compatibility.md) for current client scope.

## Executed checks

Environment: macOS, Node.js **22.23.4**, pnpm **10.34.9**, Wrangler **4.161.0**, official MCP client/server **2.4.0**, Inspector **2.15.0**. No application dependencies, lockfile, OAuth behavior or analytics calculations were changed. The only production-runtime change is the repository version identity.

| Check                                                 | Result                           | Evidence / scope                                                                                                                                                                                         |
| ----------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline `pnpm test`                                  | PASS                             | 198 existing tests across 17 files before adding the distribution tests                                                                                                                                  |
| `pnpm check`                                          | PASS                             | TypeScript, ESLint/Prettier, skill resources, **218 tests across 19 files**, public-source scanning and distribution validation                                                                          |
| `pnpm types:portable`                                 | PASS                             | Portable domain, analytics, client and utility compilation without Workers types                                                                                                                         |
| `pnpm types:check`                                    | PASS                             | Wrangler generated declarations unchanged and current                                                                                                                                                    |
| `pnpm verify:runtime`                                 | PASS                             | Dry-run build, **2 runtime tests**: synthetic instance configuration plus actual workerd/Inspector interoperability in both protocol eras; ten tools, authenticated calls, smoke and doctor CLI          |
| Built-in skill-creator `quick_validate.py`            | PASS                             | Frontmatter/name/resources; not behavioral activation proof                                                                                                                                              |
| `pnpm pack:skill`                                     | PASS                             | Versioned archive, MIT license, manifest, SHA-256 file; extracted manifest/content hash and resource validation                                                                                          |
| `pnpm audit --audit-level=high`                       | PASS                             | Registry reported no known vulnerabilities at execution time                                                                                                                                             |
| `pnpm licenses list --prod --json`                    | PASS                             | Four runtime packages: MIT or Apache-2.0; preserved notices in THIRD_PARTY_NOTICES.md                                                                                                                    |
| `pnpm run doctor`                                     | PASS for executed offline checks | Canonical resources validate; absent local credentials and remote access correctly report NOT_TESTED                                                                                                     |
| Native Codex copied-skill discovery                   | PASS                             | Codex **0.168.0**, app-server `skills/list`, isolated Git project: correct skill name, enabled, repository scope, no discovery errors                                                                    |
| Client command syntax                                 | PASS                             | Codex OAuth flags and Claude Code **2.1.295** HTTP/project-scope flags checked against installed CLI help and official docs; commands that change client settings were not run                           |
| Local documentation links, versions and public source | PASS                             | `check:distribution` validates destinations/headings, package/server/skill/changelog consistency, MIT copy, declared bindings and fail-closed defaults. Secret heuristics complement manual diff review. |

New tests exercise install/relocation/rerun/update behavior, preservation of edited/unmanaged packages, symlink refusal, receipts, required deployment settings, broken documentation links, token/payload redaction, safe endpoint URLs, auth rejection, identity mismatch, and empty versus failed retrieval. Existing auth, read-only tool and numerical regressions still pass.

## Fresh-install scenarios

| Scenario                                     | Status     | Actual execution                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A: clean source installation                 | PASS       | Source-only copy into a new temporary directory, independent Git metadata, `pnpm install --frozen-lockfile`, full check, portable compilation and Worker build; ignored owner configuration/state excluded. Package caches may be reused; installed dependencies are new.                                                      |
| B: portable skill installation               | PASS       | CLI installed complete copies for all three targets in a separate project, then `pnpm run doctor` validated each. Unit test also removes the original skill source before validating the copy. Native Codex discovery was separately observed. Claude/Cursor host discovery and explicit/implicit execution remain NOT_TESTED. |
| C: MCP protocol with synthetic data          | PASS       | Initialization, ten-tool discovery, valid/invalid calls, unauthorized/authorized requests, safe errors, missing-data behavior and Inspector invocation through the production bundle.                                                                                                                                          |
| D: production preparation without deployment | PASS       | Public template required declarations and missing-config failure, plus generated synthetic HTTPS instance configuration built by actual Wrangler dry-run. Real account secrets/bindings are NOT_TESTED.                                                                                                                        |
| E: real owner end-to-end weekly review       | NOT_TESTED | Candidate not deployed; no live OAuth/data retrieval or model skill invocation attempted. Requires owner's authorized deployment/client session.                                                                                                                                                                               |

The clean-source run caught two formatting issues and the pnpm built-in `doctor` name collision. Both were corrected and the complete workflow rerun successfully. Use **`pnpm run doctor`**; bare `pnpm doctor` invokes pnpm's own command. Initial restricted tsx IPC failure was resolved by running local verification with loopback/IPC permission; no access control was weakened.

## Remaining verification

No production deployment, external configuration changes, release/tag creation, push, marketplace or npm publication occurred. CI changes are locally exercised but have not run on GitHub until an approved push. GitHub branch protection, private reporting and secret-scanning settings were documented, not changed or independently verified. The Deploy to Cloudflare button remains deferred after documentation review because the complete owner OAuth setup was not executed through that flow.

Explicit and implicit model skill activation, Claude/Cursor live OAuth, hosted ChatGPT skill packaging and a real-data weekly review remain unverified. These limits do not prevent review of the tested CLI distribution candidate. Recommendation: **READY FOR RELEASE REVIEW**, not “all clients/live deployment verified.”
