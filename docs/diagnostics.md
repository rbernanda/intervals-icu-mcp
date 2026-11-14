# Setup diagnostics

`pnpm run doctor` prints `PASS`, `WARN`, `FAIL` or `NOT_TESTED` per executed check. Any `FAIL` exits nonzero. Warnings and unexecuted checks never become successes. Results are printed only; no report is saved. Doctor never starts OAuth, extracts another client's tokens, changes infrastructure or bypasses authentication.

Use **`pnpm run doctor`**, including `run`: pnpm already has a built-in `doctor` command, which would otherwise take precedence over this repository's script.

## Offline checks

```bash
pnpm run doctor
pnpm run doctor --config .dev.vars
pnpm run doctor --agent cursor --project ../my-training-project
```

By default the command validates the canonical skill and reads `.dev.vars` **only if present**. It checks required names/formats and warns about permissive file permissions, without printing values. `--config` explicitly selects another dotenv file; it does not load configuration into the process environment. A missing optional local file is `NOT_TESTED`; an explicitly requested missing file fails. Installed-copy checks validate resources, not client discovery or model activation. The normal repository symlink is checked with canonical discovery.

The generated deployment configuration is validated during `pnpm build:instance`; `pnpm check:distribution` checks required binding declarations and fail-closed defaults in the public template. Neither proves Cloudflare has received the owner's real secrets.

## Endpoint checks

```bash
pnpm run doctor --url https://your-worker.example.net/mcp
```

Only an explicit `--url` enables network requests. HTTPS is required except for loopback HTTP. URL credentials, query parameters, fragments and redirects are rejected. The unauthenticated check must receive 401 before a bearer token can be sent. Without a token, authenticated initialization, discovery and data access are `NOT_TESTED`.

For a legitimately issued short-lived OAuth token you already control, save it locally in an owner-readable file **outside the repository** using your secure editor or secret manager. Do not put tokens in command arguments, shell history, issues or chat. Doctor does not promise a token export mechanism for every client. Prefer the client's normal browser authorization and in-chat verification if no safe export exists.

```bash
chmod 600 /path/to/private-oauth-token
pnpm run doctor --url https://your-worker.example.net/mcp --token-file /path/to/private-oauth-token
```

The authenticated command initializes MCP, verifies ten read-only tools, validates a profile, checks identity against `INTERVALS_ATHLETE_ID` from the selected local config when explicit (not `0`), retrieves at most one recent running activity, and invokes one deterministic period comparison. Payloads, tokens and athlete identifiers are withheld. It derives completed-day ranges in the profile timezone. Identity mismatch stops data analysis. Empty activity results warn; failed upstream access fails. The comparison's successful schema validation does not establish complete synchronization or useful training evidence.

Limits: 60-second overall HTTP deadline, 15 seconds per request, 1 MB per response, no cross-origin requests or followed redirects, at most three tool calls. Doctor tests use synthetic data. It cannot verify an LLM's skill choice or diagnose physiological readiness.

See [troubleshooting](troubleshooting.md) for corrective actions and [the runbook](onboarding-runbook.md) for browser authorization checks.
