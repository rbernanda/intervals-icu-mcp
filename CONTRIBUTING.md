# Contributing

`intervals-icu-mcp` is MIT-licensed, community-maintained software. Each owner operates an independent instance with their own credentials and OAuth state. Development must preserve that model.

## Development

Use a supported Node.js LTS release (22.14+ or 24.x) and pnpm 10.34.9, as declared in `package.json`. `.node-version` pins a reproducible development version. Clone your fork and run:

```bash
pnpm install --frozen-lockfile
pnpm types:check
pnpm check
pnpm types:portable
pnpm verify:runtime
```

No Intervals, GitHub or Cloudflare credentials are needed for these checks. `verify:runtime` builds the Worker locally and invokes the official MCP Inspector and smoke script using isolated, synthetic data. It starts loopback listeners and does not deploy.

For live development use `pnpm setup:local` and `pnpm dev`. Keep real credentials in ignored local files, and all production upstream credentials in your own Cloudflare Workers Secrets. Use a separate development GitHub OAuth app. Never supply real credentials to CI.

## Architecture

- `src/domain`: platform-independent models and aggregation. No Cloudflare, MCP, identity-provider or upstream HTTP dependencies. Lint rules and `types:portable` enforce the boundary.
- `src/intervals`: native-fetch upstream client, external schemas and Intervals field normalization. Source metrics must keep their actual semantics.
- `src/tools`: tool contracts, use cases, input/output validation and data sufficiency rules.
- `src/server`: official MCP SDK registration and stateless transport.
- `src/auth`: separate provider configuration, consent rendering and browser authorization handlers, using the maintained Cloudflare OAuth provider. Changes must preserve PKCE, browser-bound consent/state, token audience/expiry, scope and subject checks.
- `src/config`: per-instance bindings. User identities, origins and credentials never belong in source defaults.
- `scripts`: local onboarding, isolated deployment configuration and publication checks. Cloud mutations must be explicit user actions.

Do not add multi-user tenancy, centralized credential collection, a hosted SaaS service, write tools, background synchronization, or coaching logic under this architecture. Discuss changes to the deployment/authentication model before implementing them.

## Pull requests

1. Describe the concrete problem and resulting behavior, including any changed source-data semantics.
2. Make focused changes; reuse native APIs and keep runtime dependencies small.
3. Add meaningful tests for changed behavior and security boundaries. Include empty, null, malformed and unauthorized cases where relevant.
4. Use **synthetic** fixtures only. Invent athlete IDs, names, timestamps and metrics; do not anonymize and commit a real activity export. Do not attach real wellness payloads, logs, OAuth callback URLs containing codes, or screenshots containing credentials.
5. Run the commands above. Run `pnpm format` if formatting fails.
6. If changing Wrangler configuration, run `pnpm types` and commit the generated declarations. Update examples, authentication/client documentation and limits with the code.
7. Update the lockfile when dependencies change. Consult primary documentation before SDK/API changes; keep Inspector checks working in both supported protocol eras.

CI runs on pushes and pull requests with a read-only GitHub token and no application secrets. It never deploys. Fork contributions must use the `pull_request` event, never execute untrusted code through `pull_request_target`.

## Security and releases

Report vulnerabilities according to [SECURITY.md](SECURITY.md), rather than including exploit details or private data in a public issue.

Before a release or making the repository public:

- Run `pnpm check`, `pnpm types:portable`, `pnpm types:check`, `pnpm verify:runtime` and `pnpm audit --prod`.
- Review `git status`, the proposed commit and any existing history for secrets or real athlete data. `check:public` is a heuristic, not proof that every possible secret has been found.
- Enable GitHub private vulnerability reporting and repository secret scanning where available; set branch protection to require CI.
- Publish source files and the lockfile. Exclude `.dev.vars`, `.env`, `wrangler.instance.jsonc`, local KV/state, logs, build output and dependency caches.
- Record actual deployment/live-client results separately from synthetic tests. Never claim a live ChatGPT connection or API verification based on Inspector alone.

Publishing a repository/release or deploying production infrastructure requires the repository owner's explicit authorization. Deployment helpers prepare local configuration only; `pnpm deploy:instance` is a separate external action.
