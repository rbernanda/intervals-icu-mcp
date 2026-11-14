# Codex

Prerequisites: your deployed HTTPS `/mcp` URL, owner GitHub sign-in, and a Codex version supporting remote MCP OAuth/CIMD. Requires a trusted local project for skill discovery. [Official MCP guide](https://learn.chatgpt.com/docs/extend/mcp) and [skills guide](https://learn.chatgpt.com/docs/build-skills).

## Connect

Run yourself when ready; `codex mcp add` modifies your Codex configuration. No upstream API key belongs in the client.

```bash
codex mcp add intervals --url https://your-worker.example.net/mcp
codex mcp login intervals --oauth-client-registration cimd --scopes intervals:read,offline_access
```

Review the server consent and authenticate as the configured numeric GitHub owner. The GitHub OAuth app callback stays `<server-origin>/callback`; the client's loopback callback is separate. Do not add custom bearer headers or turn off server authentication. If your CLI lacks a flag above, consult its `--help` and current guide instead of guessing. This task does not run configuration-changing commands on your behalf.

## Install and invoke

From the server checkout:

```bash
pnpm skill:install --agent codex --project ../my-training-project
pnpm run doctor --agent codex --project ../my-training-project
```

Open Codex in that project, confirm the skill appears, then invoke `$intervals-training-analyst Analyze my latest running activity.` For implicit selection ask “Compare my last five long runs.” It should use `compare_running_workouts` when available. Ask an unrelated programming question as a negative control; it should not invoke training tools.

In this repository the existing `.agents/skills` symlink already points to the canonical source; the installer leaves it unchanged. Codex documents symlink support. Copied installations in other projects are generated distributions, not additional editable sources. Update using the [skill guide](../training-analyst-skill.md).

## Verify

Confirm ten tools in the client; call `get_athlete_profile`, privately compare identity, then follow [first insight](../first-insight.md). Missing tools require MCP connection repair, not skill reinstallation. Restart a stale session if discovery does not refresh. Native Codex configuration does not register a ChatGPT-mode plugin. Current verification boundaries are in the [matrix](../compatibility.md).
