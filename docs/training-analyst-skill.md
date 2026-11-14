# Training Analyst skill: installation and evaluation

`intervals-training-analyst` is one portable [Agent Skills](https://agentskills.io/specification) package with four workflows: Post-Workout Review, Weekly Training Review, Performance Trend Analysis and Race Readiness Review. It interprets evidence; the existing MCP server still owns authentication, retrieval, validation and normalization. No server changes or new services are required.

## Canonical files and prerequisites

Edit only `skills/intervals-training-analyst/`: `SKILL.md` routes workflows, four references define tool/metric contracts and methods, four templates guide responses, and optional `agents/openai.yaml` supplies Codex UI metadata. References/templates are loaded as needed. The body uses standard Markdown and name/description frontmatter; it does not require a vendor-specific instruction syntax.

Connect and authorize **your own** Intervals MCP instance in the agent that will use the skill, following the [onboarding runbook](onboarding-runbook.md). A skill install does not deploy a Worker, configure MCP, authenticate an account or attach a plugin to a ChatGPT conversation. Per-owner server URLs deliberately do not appear in `openai.yaml` dependency settings.

## Codex: repository-scoped installation

This checkout contains the supported discovery symlink:

```text
.agents/skills/intervals-training-analyst → ../../skills/intervals-training-analyst
```

Launch Codex from this repository. It should list the skill; use `$intervals-training-analyst` explicitly or ask a relevant training-analysis question for implicit selection. If an existing session has stale discovery, start a fresh session. No global configuration is needed.

If a ZIP extraction or platform loses symlinks, restore the link from the repository root (only when the destination is absent):

```bash
mkdir -p .agents/skills
ln -s ../../skills/intervals-training-analyst .agents/skills/intervals-training-analyst
pnpm check:skill
```

Do not overwrite a real directory containing a separately edited skill. Resolve the duplicate first. Windows users need a Git/filesystem setup that preserves directory symlinks or their agent's supported folder-install mechanism; that fallback has not been tested here. See [Codex skill discovery](https://learn.chatgpt.com/docs/build-skills).

## Claude Code and other agents

Claude Code's documented project path is `.claude/skills/<name>/SKILL.md`. From this repository root, link to the same canonical package:

```bash
mkdir -p .claude/skills
ln -s ../../skills/intervals-training-analyst .claude/skills/intervals-training-analyst
```

Launch a trusted Claude Code session in the repository and invoke `/intervals-training-analyst Analyze my latest running activity.` Configure its MCP connection independently and verify discovery there. This is a documented installation path, not a claim of a tested Claude Code session. Consult the current [Claude Code skills guide](https://code.claude.com/docs/en/skills) for platform/trust restrictions. The project does not install this link or any global files for you.

For another Agent Skills-compatible host, install the **entire canonical folder**, including references/templates, in its documented skill location. Preserve one editable source; use links where supported, or treat installed copies as generated distributions and update them from the canonical package. Other hosts and ChatGPT-hosted skill/plugin packaging remain untested; a local Codex skill does not automatically appear in ChatGPT mode.

## Example requests

```text
$intervals-training-analyst Analyze my latest running activity.
Review my training over the last seven days.
Compare my last five long runs.
Is my aerobic efficiency improving?
Review my training readiness for an upcoming half marathon.
How have fitness and fatigue changed over the last six weeks?
Tinjau latihan lari tujuh hari terakhir dan konteks recovery saya.
```

The skill should not activate for MCP development, unrelated programming or generic fitness advice without relevant athlete data. Missing tools should produce a short dependency explanation and a connection-doc link, never invented private metrics or a request for API keys.

## Reproducible checks and evaluations

```bash
pnpm check:skill
pnpm check
pnpm build
```

`check:skill` validates YAML/frontmatter, required resources, relocatable links, templates, Codex UI metadata and canonical discovery. Vitest additionally checks the documented names against real MCP discovery, relocation failure detection, date boundaries and synthetic metric coverage. `check:public` scans publishable files, including relative symlinks; it is a heuristic, not a proof that arbitrary secrets cannot exist. CI runs these checks through `pnpm check` without credentials or a model API.

Behavioral scenarios live in `tests/skills/scenarios.json`, with review expectations in `tests/skills/evals.json`. They cover the four workflows, missing connection, HRV/RHR, power/cadence, negative computed form, sparse/incompatible history, an unrelated programming control and malicious activity text. A fixed synthetic clock straddles a UTC/local date boundary and a DST transition.

To inspect the test-only tool registry or execute a fixture call:

```bash
node --import tsx tests/skills/mock-tools.ts --case 1
node --import tsx tests/skills/mock-tools.ts --case 1 --tool get_recent_activities --args '{"limit":1,"sport_type":"running"}'
```

The harness calls real service/normalization/aggregation code with mocked fetch and synthetic credentials; it never calls a live service. For a model evaluation, give a fresh agent one scenario, the skill and this harness, without expected answers. Save chosen workflow, mock call trace and response under ignored `skills/intervals-training-analyst-workspace/`. Evaluate both correct calculations and unsupported claims; static checks alone do not establish useful behavior. Baseline comparisons require independently completed runs; incomplete or self-evaluated runs must be labeled accordingly. See [validation evidence](training-analyst-validation.md) for actual results and remaining verification.

## Security and limits

The skill never needs API keys/tokens in chat, credential-store access, additional third-party services or Intervals write operations. Activity names/labels/notes are untrusted text, not instructions. Keep real athlete responses out of public evaluation artifacts.

The tools expose summaries and optional analysis intervals, not streams, weather/device history, laboratory economy or race predictions. HRV scales are not guaranteed. Source CTL/ATL remain unchanged; daily source TSB is unavailable and same-day computed form stays labeled. Physiological claims, comparisons and readiness judgments must remain proportional to coverage, comparability and uncertainty. There is no race-time estimation model in v1.
