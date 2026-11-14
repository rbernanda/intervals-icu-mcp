# Onboarding runbook: Cloudflare to ChatGPT

Use this checklist to deploy your own instance and connect it to **ChatGPT mode**. No source-code changes are needed. Each owner needs their own Intervals.icu credentials, Cloudflare account and GitHub OAuth app. The supported v1 path uses a terminal; there is no one-click installation.

**Important:** a successful Codex connection does not connect ChatGPT mode. A plugin marked **desktop only** still needs the ChatGPT registration in step 6. Do not rebuild the Worker or remove authentication to solve missing tools.

## 1. Install the project

Install Git and Node.js **22.14+ or 24 LTS**, then run:

```bash
npm install --global pnpm@10.34.9
git clone https://github.com/rbernanda/intervals-icu-mcp.git
cd intervals-icu-mcp
pnpm install --frozen-lockfile
```

Use your own fork instead if preferred. Optional local development is covered in [self-hosting](self-hosting.md#local-development); you do not need a localhost OAuth app for this production-only path.

## 2. Collect your account settings

| Setting                | Where to get it                                                                             | How it is used                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Intervals API key      | [Intervals.icu Settings](https://intervals.icu/settings)                                    | Workers Secret; never entered in ChatGPT                                                        |
| Athlete ID             | Your Intervals account; confirm the intended athlete                                        | Workers Secret; `0` means the key owner, or use the exact explicit ID, including its `i` prefix |
| Athlete timezone       | Your athlete's IANA timezone, such as `Etc/UTC`                                             | Default date ranges and weekly summaries                                                        |
| Numeric GitHub user ID | `gh api user --jq .id`, or the `id` field at `https://api.github.com/users/<your-username>` | Restricts sign-in to this owner; different from your username or athlete ID                     |

Enter secrets only in local terminal prompts or the provider's own interface. Do not paste them into chat, screenshots, issues or committed files.

## 3. Create OAuth storage and choose your URL

Sign in to your Cloudflare account and create **one KV namespace**:

```bash
pnpm wrangler login
pnpm wrangler kv namespace create OAUTH_KV --update-config=false
```

Alternatively, open **Cloudflare dashboard → Workers KV → Create KV namespace**. Some dashboard versions call this **Create instance**; both create a namespace. Give it a descriptive name, then copy its **namespace ID**, not its name or your account ID. Do either the CLI or dashboard path, not both. Keep this namespace for future updates; never share it between owners.

Find your account's `workers.dev` subdomain under Workers & Pages and choose a Worker name. Your intended origin has this shape:

```text
https://<worker-name>.<your-account-subdomain>.workers.dev
```

A Workers custom domain is also supported. Use one exact HTTPS origin without `/mcp` or a trailing slash. Provisioning resources and deploying can incur Cloudflare usage charges.

## 4. Create your GitHub OAuth app and instance config

In **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**, create an app you control:

| GitHub field               | Value                                |
| -------------------------- | ------------------------------------ |
| Application name           | A descriptive name for your instance |
| Homepage URL               | Your intended HTTPS origin           |
| Authorization callback URL | Your origin followed by `/callback`  |

Generate the GitHub client secret privately. Save the public client ID for the setup wizard. **GitHub's callback points to your Worker**, not to ChatGPT or a loopback address.

```bash
pnpm setup:deploy
```

Enter the Worker name, origin, KV namespace ID, GitHub client ID, numeric owner ID and timezone. Leave additional browser origins empty and legacy client registration (`DCR`) `false` for the normal ChatGPT CIMD setup.

The offline wizard creates ignored `wrangler.instance.jsonc` with public instance settings and the `OAUTH_KV` binding. It does not deploy, upload secrets or modify shared source. If setup was already completed, reuse that file rather than creating another namespace or OAuth app.

## 5. Store secrets, review and deploy

Enter each value through its secure prompt:

```bash
pnpm wrangler secret put INTERVALS_API_KEY --config wrangler.instance.jsonc
pnpm wrangler secret put INTERVALS_ATHLETE_ID --config wrangler.instance.jsonc
pnpm wrangler secret put GITHUB_CLIENT_SECRET --config wrangler.instance.jsonc
pnpm build:instance
```

`build:instance` is a dry run. Setting the first secret may create a Worker stub. Review your configuration before the next command, which **deploys to production**:

```bash
pnpm deploy:instance
```

Copy the actual URL printed by Wrangler. Confirm its origin matches `PUBLIC_ORIGIN` in your instance config and the GitHub app's homepage/callback. Your MCP endpoint is that origin plus `/mcp`.

Check the deployed server using your actual origin:

```bash
export MCP_ORIGIN='https://<worker-name>.<your-account-subdomain>.workers.dev'
curl -i "$MCP_ORIGIN/health"
curl -i "$MCP_ORIGIN/mcp"
curl -fsS "$MCP_ORIGIN/.well-known/oauth-protected-resource/mcp"
curl -fsS "$MCP_ORIGIN/.well-known/oauth-authorization-server"
```

Expect health **200**, unauthenticated MCP **401** with `WWW-Authenticate`, and metadata describing your own resource/issuer URLs with S256 and CIMD support. A successful health check alone does not verify your upstream API key or OAuth app secret.

## 6. Register in ChatGPT mode

Use the [ChatGPT Plugins page](https://chatgpt.com/plugins), even if the server already works in Codex. Custom-server availability depends on your account/workspace policy; menu labels may vary.

1. Select **Add** (or **+**) → **Add custom MCP server**.
2. Set the name to **Intervals.icu Training**, with an optional short description.
3. Under **Connection**, select **Server URL** and enter your actual HTTPS `/mcp` endpoint. If a transport selector appears, choose **Streamable HTTP**, not STDIO.
4. Select **OAuth**. In **Advanced OAuth settings**, use discovered endpoints and **CIMD** if a client setup selector appears. Do not supply manual client credentials.
5. If scopes are editable, use base scope `intervals:read` and default scopes `intervals:read offline_access`. This server does not use OIDC; leave it disabled if offered.
6. Review the warning, check **I understand and want to continue**, then select **Create as a plugin**.
7. Complete the connection's authorization flow when prompted: review your Worker's client/redirect details, allow the read scope, and sign in to GitHub as the configured owner. Install/connect the resulting plugin and review the ten read-only tools.
8. Start a **new conversation in ChatGPT mode**. Type `@` and select the newly registered plugin. For a project, select it in the intended project conversation too.

No API key, athlete ID or GitHub client secret is entered into ChatGPT. The Worker holds those values. Native Codex may instead show a URL/transport form followed by **Authenticate**; completing that flow is a separate client authorization, not proof that ChatGPT mode is connected.

See OpenAI's [connection workflow](https://developers.openai.com/plugins/deploy/connect-chatgpt) and [OAuth compatibility](https://developers.openai.com/plugins/build/auth) for current platform requirements.

## 7. Verify real access before requesting analysis

With the plugin selected, send:

> Call get_athlete_profile using Intervals.icu Training. Report the athlete ID from the live response and compare it with my configured athlete. Do not use remembered data. If the tool is unavailable or fails, stop and report the exact error.

Compare the returned ID with your intended Intervals athlete. An explicit ID such as `i123456` is valid; it does not need to be changed to `0`. This is a synthetic example, not an account to configure.

Then send:

> Retrieve my latest three running activities using get_recent_activities with limit=3 and sport_type="running". Show source IDs, dates, distance in meters and moving time in seconds. Preserve missing values and do not use cached or remembered activity data.

Compare one returned run with Intervals.icu. Also check that discovery lists all ten tools documented in the [README](../README.md#tools).

Record each acceptance check separately, without saving private payloads or tokens in Git:

- [ ] Local checks/Inspector passed with synthetic data, if run.
- [ ] Deployed URL, health, metadata and unauthenticated rejection verified.
- [ ] Owner OAuth completed for the intended client.
- [ ] Seven tools discovered in ChatGPT mode.
- [ ] Live athlete identity and recent activity matched Intervals.icu.

An authorization success message alone does not prove that tools are available in a conversation or that live data retrieval works.

## Troubleshooting and recovery

| Symptom                                                                           | Action                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare only shows **Create KV namespace**                                     | That is the correct action. Copy the namespace ID into the wizard; no separate instance is needed.                                                                                                                                                          |
| Server works in Codex but is absent in ChatGPT mode; plugin says **desktop only** | Complete step 6 on ChatGPT Plugins, install/connect that registration, and select it with `@` in a new ChatGPT conversation.                                                                                                                                |
| Authentication completed, but tools are absent                                    | Check the active account/workspace and selected plugin. Refresh the custom connection's metadata if offered, then start a new chat. Do not treat a model's remembered tool names as discovery evidence.                                                     |
| No OAuth field in a native desktop form                                           | That can be the native Codex client. Use ChatGPT Plugins for ChatGPT mode; native transport is Streamable HTTP and authentication follows saving.                                                                                                           |
| **Forbidden** before consent or after **Allow**                                   | Update an older deployment to current code, redeploy deliberately, and restart authorization with a fresh link. Current code permits OAuth GET navigation and preserves the consent POST Origin. Do not allow wildcard/null Origins or disable CSRF checks. |
| GitHub rejects the callback or owner                                              | Check the app's exact `<origin>/callback`, its matching client ID/secret, and `ALLOWED_GITHUB_USER_ID`. Use the configured owner's GitHub account. Client redirects shown by ChatGPT/Codex are separate and validated from client metadata.                 |
| MCP returns 401 after previously working                                          | Reconnect/reauthorize through that client's OAuth controls. Anonymous `/mcp` requests should always return 401.                                                                                                                                             |
| Server returns 503                                                                | Check required bindings, exact origin and IANA timezone in your instance config. Confirm secrets exist for that Worker.                                                                                                                                     |
| Upstream authorization fails or athlete is wrong                                  | Re-enter your own Intervals key/athlete ID using Wrangler secret prompts. Compare the source account before retrying.                                                                                                                                       |
| Wellness or other metrics are missing                                             | Confirm they exist in Intervals for the requested dates. Missing source data stays null; it is not a reason to replace credentials.                                                                                                                         |
| Upstream returns 429                                                              | Respect `Retry-After`, wait, and narrow the request range. Do not repeatedly reconnect OAuth.                                                                                                                                                               |

For updates, reuse your instance config and KV namespace, follow [update and operate](self-hosting.md#update-and-operate), then refresh ChatGPT's custom connection and verify again. Do not share OAuth callback URLs containing codes/state, browser cookies, tokens or activity/wellness payloads in support reports. Share only the failing step, safe error category/status and client surface.
