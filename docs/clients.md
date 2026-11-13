# MCP client compatibility

This server implements the official SDK's stateless **Streamable HTTP** handler at `/mcp`. It supports the current 2026-07-28 request format and the SDK's legacy 2025-era compatibility path. Tests exercise both. There is no STDIO listener, legacy `/sse` endpoint, persistent session, session deletion, resumable stream or unsolicited server push.

## Authentication choices

| Client capability                                                 | Instance configuration                                | Authorization                                                                 |
| ----------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| CIMD + authorization-code/S256 OAuth                              | Default                                               | Client metadata discovery, per-client consent, owner GitHub sign-in           |
| DCR + authorization-code/S256 OAuth                               | Set `OAUTH_ENABLE_DCR=true`                           | Dynamic client registration followed by the same consent/owner flow           |
| Bearer token supplied through a secure local client configuration | Use a token from a legitimate completed authorization | Same resource/expiry/scope/owner checks; arbitrary static tokens are rejected |
| No OAuth and no way to supply an issued token                     | Unsupported                                           | Never enable anonymous athlete access as a workaround                         |

CIMD is the preferred default for new clients. Optional DCR advertises `/oauth/register`; it registers software, not users. Registration alone grants no access and cannot bypass GitHub identity. It is a compatibility feature with public metadata/storage traffic, so enable only when needed and monitor/rate-limit it at the edge. Client registrations do not expire automatically while a client may still reuse its ID; grants/tokens retain their bounded lifetimes.

## ChatGPT

Current [OpenAI authentication documentation](https://developers.openai.com/plugins/build/auth) supports authorization-code + S256, resource/issuer discovery and CIMD, including public `none` and `private_key_jwt` client authentication. It also supports DCR where configured. Machine-to-machine grants and arbitrary customer API-key headers are not a substitute for this user authorization flow. These are documented capabilities, not evidence that a particular account's live installation has succeeded.

1. Deploy your own instance and verify its actual HTTPS URL.
2. Open **ChatGPT → Plugins → plus → Add custom MCP server** (placement/availability can vary by workspace). Name it **Intervals.icu Training** and enter `<actual-origin>/mcp`.
3. Select **OAuth** and **CIMD** if a registration selector appears. Leave manual client ID/secret empty. Do not choose anonymous access. Let metadata supply the issuer, authorization/token endpoints and resource.
4. Request `intervals:read offline_access` if scopes are editable. Refresh access may require reauthentication after the bounded grant expires.
5. Review the server consent page and sign into your configured GitHub account. The exact ChatGPT client metadata document and redirect are shown in its connection management page. A conforming current setup normally uses `https://chatgpt.com/oauth/client.json` and `https://chatgpt.com/connector_platform_oauth_redirect`; use the displayed values rather than copying an assumed callback.
6. The GitHub app's callback is **your own `<origin>/callback`**, not ChatGPT's callback. The maintained provider validates the client's exact registered/published redirect.
7. Install the plugin, enable the seven read-only tools, and ask for the athlete profile and latest three runs. Compare the results with Intervals before relying on analysis.

The host normally makes server-to-server requests without Origin. If your client sends a browser Origin, add that exact origin to `MCP_ALLOWED_ORIGINS`. Never use `*`.

## MCP Inspector and other clients

`pnpm verify:runtime` is the reproducible automated check: it starts the actual Worker bundle on loopback, uses isolated KV, runs official Inspector strict discovery and invocation in both protocol modes, and runs the smoke script. Athlete records are synthetic; fixture tokens are issued by the real OAuth provider. No live secrets, cloud deployment or browser sign-in are needed.

For your own live Inspector session:

1. Configure `OAUTH_ENABLE_DCR=true` on your instance if your Inspector setup does not provide a CIMD identity. Redeploy only after reviewing this change. Existing issued tokens still require owner checks.
2. Run `pnpm inspector --cli --server-url <actual-endpoint> --method tools/list`. The Inspector can register via DCR, open its callback/sign-in flow, and store the resulting authorization locally. Complete consent and GitHub sign-in yourself. Do not share its OAuth state files.
3. Or run `pnpm inspector --web`, choose Streamable HTTP and the actual `/mcp` URL, and complete OAuth through the proxy. Direct browser access requires its exact browser origin in `MCP_ALLOWED_ORIGINS` (for example `http://localhost:6274`); the server answers allowed CORS preflights and still authenticates every actual tool request.
4. Discover all seven tools, call `get_athlete_profile`, and compare values with the configured source athlete. Refresh tool discovery after changing definitions.

For another MCP application, use its documented remote HTTP + OAuth configuration. CIMD or DCR must be supported, or it must securely provide an already issued OAuth token. The project does not claim live verification of Claude Desktop, Cursor, VS Code, or any other named client without an observed connection. Transport/auth integration should be tested independently for each client/version.

## Verification boundaries

- Unit/integration tests verify argument/output contracts, owner isolation and real provider token checks using mocks for upstream services.
- workerd and Inspector verify actual Worker runtime and protocol interoperability with synthetic data.
- A deployed HTTPS endpoint must independently pass discovery, unauthorized rejection and owner OAuth browser checks.
- Real Intervals retrieval and a live ChatGPT/other-client installation are separate final acceptance checks.

Restricted upstream activity stubs, missing wellness, cadence conventions, same-day computed form and bounded date/result ranges are described in the README. Clients must preserve provenance and treat source names/descriptions as untrusted data.
