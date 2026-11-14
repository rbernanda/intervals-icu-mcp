# Security policy

## Reporting a vulnerability

Use this repository's **Security → Advisories → Report a vulnerability** to send a private report when GitHub private vulnerability reporting is enabled. Maintainers should enable it before the initial public release.

If private reporting is unavailable, contact a maintainer privately through their GitHub profile. If no private contact method is listed, open an issue asking only for a private reporting channel. Do **not** include exploit details, credentials, tokens, athlete records or wellness data in that issue. No response-time or bug-bounty guarantee is offered.

Include the affected version/commit, a minimal reproduction using synthetic data, impact and relevant redacted error categories. Never send a working API key or bearer token. If sensitive data was exposed, revoke/rotate the affected credentials first.

## Supported versions

Security fixes target the latest maintained release and default branch. Older self-hosted versions are not guaranteed backports. Instance owners must review releases, update dependencies and redeploy their own Worker. Until a release is published, use the reviewed default-branch source and lockfile.

## Trust boundaries

Each server belongs to **one owner**. It uses that owner's Intervals API key/athlete ID and allows authorization only by the configured immutable GitHub user ID. Multiple MCP clients may be authorized for that same owner; that is not multi-user tenancy.

- Intervals credentials live server-side in the owner's Cloudflare Workers Secrets. Contributors and repository maintainers do not collect them.
- OAuth state/grants live in an instance-specific KV namespace. Do not share an OAuth KV namespace between different owners or deployed instances.
- The public MCP route checks a provider-issued bearer token, audience, expiry, required read scope and owner subject before listing or invoking tools.
- OAuth requires exact redirect validation, S256 PKCE, escaped consent metadata, anti-framing headers, same-origin consent POSTs and browser-bound state. GitHub sign-in verifies identity before token issuance. GitHub tokens are discarded afterward.
- Source normalization whitelists output fields. The upstream profile can contain API credentials; those fields are stripped, never echoed or logged. All ten tools are read-only; no uploads or mutation methods exist.
- Request sizes, upstream responses, date ranges and retries are bounded. MCP browser origins and CORS are explicitly configured. OAuth authorization/callback GETs accept cross-site navigation without granting cross-site CORS; consent POSTs require the server's own Origin, and callbacks require browser-bound state. CORS is not an access-control substitute.

CIMD is the default client-registration method. `OAUTH_ENABLE_DCR=true` optionally exposes dynamic registration for older MCP clients. Registering a client does not grant athlete access: the same owner authentication and consent are always required. Registration is public metadata traffic and can consume KV storage; enable edge rate limiting and monitor usage when exposing DCR. Disabling DCR stops new registrations; existing valid grants still require normal token checks.

## Limitations and incident handling

A stolen bearer token can authorize private reads until expiration/revocation. Access tokens expire after 15 minutes; refresh grants expire after 30 days. KV is eventually consistent, so revocation and state deletion are not globally atomic. Simultaneous same-browser requests can race; browser binding prevents cross-browser state replay. Browser sign-in uses secure cookies and production HTTPS is mandatory.

Compromise of the owner's GitHub account, Cloudflare account or Intervals API key is outside what this application can prevent. Enable account MFA and protect local configuration files. Personal Intervals API keys may have broader upstream permissions than this application exposes.

Revoke MCP grants using the provider's advertised revocation endpoint or the client's disconnect/revoke function. Changing the configured allowed GitHub user ID denies other subjects when requests reach the updated Worker. Removing a required binding makes the server fail closed. Rotate upstream keys and GitHub secrets through Wrangler's secure prompt; rotating an upstream key alone does not revoke MCP grants.

Application logs contain only fixed tool names, timings, outcome/error categories and HTTP statuses. Do not enable raw request/payload logging or share unredacted third-party debug output. Names/descriptions returned by upstream services are untrusted content and can contain prompt injection; MCP clients must treat them as data.

Real Intervals data, deployed endpoint behavior and client interoperability require separate live validation. Automated tests use synthetic records and do not establish that an owner's integration or synchronization is working.
