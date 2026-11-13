# Self-hosting your instance

Every owner deploys independently. Your instance uses your Intervals API key/athlete ID, GitHub OAuth app and Cloudflare account. Repository maintainers never receive those credentials. There is no central sign-up or hosted service.

## Guided v1 setup

You do not need to change TypeScript source. The supported path uses a terminal and a local configuration wizard; it is not a one-click browser installation.

1. Install **Node.js 22 LTS or 24 LTS**, then `npm install --global pnpm@10.34.9`. On macOS, Windows or Linux, use the official Node installer for your platform. Avoid entering credentials into chat or screenshots.
2. Fork/clone this repository, or use GitHub's **Code → Download ZIP**. Extract the ZIP and open a terminal in the extracted project folder. A ZIP can be run locally, but contributors and `check:public` need an initialized Git checkout.
3. Run `pnpm install --frozen-lockfile`. The project includes the pinned Wrangler CLI, so a separate Wrangler installation is unnecessary.
4. Sign into Intervals.icu Settings locally and obtain your own personal API key. Athlete ID `0` selects its owner, or use your explicit athlete ID. Confirm your athlete's timezone and that activities have synchronized into Intervals.
5. Sign into your own Cloudflare account:

```bash
pnpm wrangler login
pnpm wrangler kv namespace create OAUTH_KV --update-config=false
```

The namespace command creates a real cloud resource and can incur usage charges. Run it only when ready to provision your instance. Save the returned namespace ID; do not reuse another owner's namespace. `--update-config=false` keeps the shared repository configuration unchanged.

6. In Cloudflare's Workers dashboard find your account's workers.dev subdomain. Choose a Worker name (default `intervals-icu-mcp`) and determine the intended origin. Alternatively use your own Workers custom domain. The eventual URL must match this origin exactly. The wizard accepts a URL you supply; it never invents one.
7. In GitHub **Settings → Developer settings → OAuth Apps → New OAuth App**, create a production OAuth app you control. Use your intended public origin for its homepage and `<origin>/callback` for its authorization callback. Generate its secret locally. This app verifies your identity and does not read training data or repositories.
8. Get your immutable numeric GitHub user ID. If GitHub CLI is already authenticated, `gh api user --jq .id` shows it; otherwise view `https://api.github.com/users/<your-username>` and find `id`. This ID is not your username or Intervals athlete ID.
9. Prepare your deployment locally:

```bash
pnpm setup:deploy
```

Enter the Worker name, HTTPS public origin, namespace ID, public GitHub client ID, numeric GitHub user ID and athlete IANA timezone. Optional prompts configure exact browser origins and DCR for older clients. The wizard shows no secrets and makes no network requests. It writes **`wrangler.instance.jsonc`**, ignored by Git, with mode 0600. This file contains public instance settings only. The base `wrangler.jsonc` stays reusable.

10. Set credentials using secure Wrangler prompts:

```bash
pnpm wrangler secret put INTERVALS_API_KEY --config wrangler.instance.jsonc
pnpm wrangler secret put INTERVALS_ATHLETE_ID --config wrangler.instance.jsonc
pnpm wrangler secret put GITHUB_CLIENT_SECRET --config wrangler.instance.jsonc
pnpm build:instance
```

Wrangler may create an inaccessible stub for a new Worker when the first secret is set. This is a cloud mutation; the offline wizard itself never does this. The build is a local dry run and does not deploy.

11. When you approve the configuration and are ready to expose the OAuth-protected server:

```bash
pnpm deploy:instance
```

Copy the **actual URL returned by Wrangler**. Verify its origin equals your `PUBLIC_ORIGIN` and the GitHub app callback's origin. Correct those settings before connecting a client if they differ.

The GitHub app must belong to this owner/deployment, not to repository maintainers. Client ID and instance origin are public configuration; the upstream key/athlete ID and GitHub secret are Workers Secrets. Never put secrets into `vars`, example files, CI settings or commit history.

## Local development

Create a **separate development GitHub OAuth app** with homepage `http://localhost:8787` and callback `http://localhost:8787/callback`. Then:

```bash
pnpm setup:local
pnpm dev
```

The wizard writes an ignored `.dev.vars` file with hidden input and mode 0600, and refuses to overwrite an existing file. Alternatively copy `.dev.vars.example` to `.dev.vars` or `.env.example` to `.env`, set restrictive file permissions and edit it privately. Choose one file to avoid conflicting configuration.

The same OAuth enforcement applies on localhost. `http://localhost:8787` and `http://127.0.0.1:8787` are different origins. Do not disable authentication or expose a development tunnel to work around setup issues. Hosted ChatGPT needs the deployed HTTPS URL; it cannot reach your localhost.

## Verify your deployment

Check each stage separately:

1. **Configuration:** request `<origin>/health`. A configured server returns 200; missing/invalid configuration returns a safe 503.
2. **Access control:** a request to `<origin>/mcp` without a token returns 401 and a `WWW-Authenticate` challenge. OAuth metadata/preflight requests contain no athlete data.
3. **Discovery:** inspect `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server`. Resource, issuer and endpoint URLs must match your origin; S256 and CIMD must be advertised. Registration is advertised only when enabled.
4. **Owner authorization:** use ChatGPT or a compatible MCP client. Review the client/domain/redirect host on the consent page and sign in with your configured GitHub account. Another identity must be denied.
5. **Protocol:** discover exactly seven read-only tools; invoke `get_athlete_profile` and compare the ID/timezone with your source account.
6. **Live data:** retrieve a recent run and compare ID, date, meters and duration with Intervals. Verify fitness CTL/ATL against the source. Missing metrics remain missing.
7. **Smoke:** a legitimately authorized short-lived OAuth token can be supplied locally to `pnpm smoke` through `MCP_TOKEN_FILE` or `MCP_ACCESS_TOKEN`. Set `MCP_URL` to the actual endpoint. Avoid command arguments/history and never send the token to maintainers. The script prints check results without athlete payloads.

ChatGPT-specific steps and other-client limitations are in [clients.md](clients.md). Local Inspector success does not prove real credentials, deployment or a ChatGPT connection work.

## Update and operate

Keep `wrangler.instance.jsonc` and the same OAuth KV namespace for this instance. Pull a reviewed release, run `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm types:portable` and `pnpm verify:runtime`, then run `pnpm build:instance`. Deploy explicitly with `pnpm deploy:instance` when ready. No CI workflow deploys on your behalf.

Edit instance settings only in your ignored configuration; the code remains unchanged. Rotate credentials with the same `wrangler secret put ... --config wrangler.instance.jsonc` prompts. Public-origin changes require corresponding OAuth callback changes and client reconnection. Back up your non-secret settings privately; manage Worker/KV access through your own Cloudflare account.

OAuth client registrations remain stable while clients reuse their IDs. Access tokens expire after 15 minutes, refresh grants after 30 days. Revoke through the client's authorization controls or the provider's advertised revocation endpoint. KV is eventually consistent. See [SECURITY.md](../SECURITY.md) for emergency response and residual risks.

## Configuration reference

| Binding                  | Required | Storage                 | Meaning                                                                   |
| ------------------------ | -------- | ----------------------- | ------------------------------------------------------------------------- |
| `INTERVALS_API_KEY`      | Yes      | Workers Secret          | This owner's personal upstream key                                        |
| `INTERVALS_ATHLETE_ID`   | Yes      | Workers Secret          | This owner's athlete ID, or `0`                                           |
| `GITHUB_CLIENT_SECRET`   | Yes      | Workers Secret          | This deployment's GitHub OAuth secret                                     |
| `GITHUB_CLIENT_ID`       | Yes      | Private instance config | Public ID of its OAuth app                                                |
| `ALLOWED_GITHUB_USER_ID` | Yes      | Private instance config | Immutable numeric ID of its one owner                                     |
| `PUBLIC_ORIGIN`          | Yes      | Private instance config | Exact HTTPS origin, no trailing slash; loopback HTTP only for development |
| `ATHLETE_TIMEZONE`       | Yes      | Private instance config | IANA timezone used for default ranges and week boundaries                 |
| `OAUTH_KV`               | Yes      | Unique KV binding       | Instance-specific OAuth state/grants; never athlete records               |
| `MCP_ALLOWED_ORIGINS`    | Optional | Instance config         | Comma-separated exact additional browser origins; empty by default        |
| `OAUTH_ENABLE_DCR`       | Optional | Instance config         | Literal `true`/`false`; defaults false; legacy client compatibility       |
| `UPSTREAM_TIMEOUT_MS`    | Optional | Instance config         | 100–20000 ms per attempt, default 10000; total tool budget 25 seconds     |

The versioned base config marks required settings as secret bindings so direct Wrangler setups also fail closed. The generated instance config puts public values in `vars` and requires only the three true credential bindings through Secrets. Both routes use identical runtime validation.
