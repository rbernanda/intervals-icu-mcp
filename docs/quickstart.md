# First installation

Deploy one private server per owner. The server and optional skill are installed separately. No source-code edits are needed. Requires Node.js 22.14+ or 24 LTS, pnpm 10.34.9, and your own Intervals.icu, GitHub and Cloudflare accounts.

## 1. Check the source locally

```bash
git clone https://github.com/rbernanda/intervals-icu-mcp.git
cd intervals-icu-mcp
pnpm install --frozen-lockfile
pnpm check
pnpm verify:runtime
pnpm run doctor
```

No credentials are required for tests/builds. An unconfigured `doctor` reports local/remote access as `NOT_TESTED`; that is expected, not proof of a working deployment. Choose a reviewed tag from [releases](https://github.com/rbernanda/intervals-icu-mcp/releases) instead of following moving `main` for production. See [versioning](releases.md).

## 2. Deploy your server

Follow [self-hosting](self-hosting.md): obtain your Intervals API key, create your GitHub OAuth app and owner-specific OAuth KV, run `pnpm setup:deploy`, enter the three secrets through Wrangler prompts, dry-run `pnpm build:instance`, then explicitly deploy. Read the [configuration inventory](self-hosting.md#configuration-reference). Never paste keys into a chat or configure them in a skill.

For live local development instead, create a separate development GitHub OAuth app, then run `pnpm setup:local` and `pnpm dev`. OAuth remains mandatory on localhost. The automated runtime tests use synthetic upstream responses and never require an account.

## 3. Connect your client and install the skill

Choose [Codex](installation/codex.md), [Claude Code](installation/claude-code.md), [Cursor](installation/cursor.md) or [ChatGPT](installation/chatgpt.md). Connection and skill installation are separate steps. From this checkout, install into an existing project:

```bash
pnpm skill:install --agent codex --project ../my-training-project
pnpm run doctor --agent codex --project ../my-training-project
```

Use `--agent claude-code` or `--agent cursor` for those clients. The installer does not configure MCP, log in, upload files or change global settings. See [skill installation and updates](training-analyst-skill.md).

## 4. Verify and obtain the first insight

Discover ten read-only tools and confirm `get_athlete_profile` matches your source account privately. Check your deployed endpoint using [doctor](diagnostics.md), then follow the [synthetic first-review example](first-insight.md). Confirm dates, units and one actual run against Intervals.icu before interpreting trends.

```text
Review my running over the last seven completed local days against the preceding seven.
Use compare_training_periods. Include distance, moving duration, source training load,
source CTL/ATL, labeled computed same-day form, and relevant available wellness context.
Explain missing data and coverage. Do not invent any metrics.
```

The [compatibility matrix](compatibility.md) separates installed files, local protocol tests and observed live-client behavior. Your first live review remains an owner-run acceptance check.
