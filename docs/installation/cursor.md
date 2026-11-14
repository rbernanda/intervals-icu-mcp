# Cursor

Prerequisites: your deployed HTTPS `/mcp` and a Cursor version supporting Agent Skills, Streamable HTTP and OAuth. These are documented provider features, but Cursor is unavailable in this development environment. Live authorization, discovery and activation remain untested. [Official skills](https://cursor.com/docs/skills) and [MCP](https://cursor.com/docs/mcp) guides.

## Connect

In your target project, merge this non-secret URL entry into `.cursor/mcp.json`, preserving existing servers:

```json
{
  "mcpServers": {
    "intervals": {
      "url": "https://your-worker.example.net/mcp"
    }
  }
}
```

Enable the server in Cursor's MCP settings and complete its browser OAuth flow as the configured owner. If your version cannot use CIMD, enable instance `OAUTH_ENABLE_DCR=true` and explicitly redeploy, then reconnect. Do not configure an Intervals API key, GitHub app secret or static MCP client secret in this JSON. If authorization still fails, preserve the secure server configuration and record the client/version error for investigation.

## Install and invoke

From the server checkout:

```bash
pnpm skill:install --agent cursor --project ../my-training-project
pnpm run doctor --agent cursor --project ../my-training-project
```

The copy goes in `.cursor/skills/intervals-training-analyst/`. Cursor also documents `.agents/skills`, but install only one copy per project to avoid duplicate skills. The installer does not rely on symlink support, change settings or enable cloud skill sync.

Start Cursor in that project, type `/` in Agent chat and select `intervals-training-analyst`. Request a latest-run review. Try an implicit “Compare my last five long runs” and an unrelated programming negative control. Check ten tools and privately verify the athlete profile before [first insight](../first-insight.md). File validation is not proof of Cursor discovery. See [troubleshooting](../troubleshooting.md), [matrix](../compatibility.md) and [updates](../training-analyst-skill.md).
