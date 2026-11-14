# Claude Code

Prerequisites: your deployed HTTPS `/mcp`, owner browser access, Claude Code with remote HTTP OAuth, and a trusted project. Follow the official [MCP](https://code.claude.com/docs/en/mcp) and [skills](https://code.claude.com/docs/en/skills) documentation. Live interoperability is untested for this candidate.

## Connect

In your target project, run yourself when ready (writes project `.mcp.json`):

```bash
claude mcp add --transport http intervals --scope project https://your-worker.example.net/mcp
```

Open Claude Code and use `/mcp` to authenticate. If the installed version requires dynamic client registration, set `OAUTH_ENABLE_DCR=true` in your private instance config and explicitly redeploy. That endpoint remains owner-authenticated for token issuance; registration grants no data access. Do not pass your GitHub OAuth app secret or Intervals key as MCP client credentials. No shared static MCP client is provisioned by this project.

## Install and invoke

From the server checkout:

```bash
pnpm skill:install --agent claude-code --project ../my-training-project
pnpm run doctor --agent claude-code --project ../my-training-project
```

The full generated copy lives at `.claude/skills/intervals-training-analyst/`. No symlink behavior is required. Start Claude Code in the target project, accept its trust prompt only after reviewing it, and invoke `/intervals-training-analyst Analyze my latest running activity.` Then try an implicit weekly review and an unrelated programming negative control. Admin policy or safe/bare modes can restrict skill loading.

Confirm ten tools, verify profile identity, and follow [first insight](../first-insight.md). Doctor validates installed files, not a successful Claude session. If `/mcp` authorization fails, review DCR settings, exact redirects and [troubleshooting](../troubleshooting.md); never relax owner, audience or PKCE checks. See [compatibility status](../compatibility.md) and [skill updates](../training-analyst-skill.md).
