# ChatGPT Custom MCP Server

Requires a public HTTPS deployment and an account/workspace that permits custom MCP plugins. This server uses **Streamable HTTP**, not STDIO. Follow the [official connection guide](https://developers.openai.com/plugins/quickstart) and [OAuth guide](https://developers.openai.com/plugins/build/auth); the public sample's anonymous authentication option is inappropriate for private training data.

1. Open **ChatGPT → Plugins → + → Add custom MCP server**. Menu placement can vary by surface/account policy.
2. Name: `Intervals.icu Training` (or your preferred name). Server URL: your actual `https://<your-origin>/mcp`.
3. Select **OAuth**, prefer **CIMD**, and leave manual client ID/secret empty. OIDC is not required. Read scope is `intervals:read`; `offline_access` permits refresh. The server advertises authorization metadata and S256 PKCE.
4. Review the registration warning, create the plugin, authorize through your Worker and GitHub as its configured owner, then install/connect.
5. In a new **ChatGPT-mode** conversation, select the plugin using `@`. Verify ten read-only tools, privately confirm profile identity and run [first insight](../first-insight.md).

A Codex-mode connection, OAuth callback success or “desktop only” plugin does not prove the hosted ChatGPT conversation can call tools. Missing registry entries mean no data has been accessed in that conversation. Follow the detailed [onboarding runbook](../onboarding-runbook.md#6-register-in-chatgpt-mode) and [troubleshooting](../troubleshooting.md).

## Skill is separate

Installing `.agents/skills`, `.claude/skills` or `.cursor/skills` locally does **not** install a skill into hosted ChatGPT. This repository distributes the portable folder for local compatible agents. A hosted plugin that bundles skill resources and a registered connection is a distinct packaging/integration task; no such universal ChatGPT skill installer or marketplace publication is claimed here. You may ask ChatGPT to use the deterministic MCP tools directly, but that does not verify skill activation.

An earlier owner connection was reported working. This candidate has not been deployed or live-tested in ChatGPT. Inspect the [matrix](../compatibility.md) for current evidence boundaries.
