# Releases, upgrades and rollback

## Version policy

One repository release identifies server, scripts and canonical skill. `package.json`, `src/version.ts`, skill frontmatter `metadata.version` and the changelog must agree; `pnpm check:distribution` enforces this. Installed skill receipts record that version plus a deterministic content hash. Analytics' method identifier has a separate calculation-contract purpose and is not the application release version.

**Existing public tags v1.0.0 and v1.1.0 must remain unchanged.** The requested “v1.0 portable-distribution” roadmap milestone is prepared as **1.2.0-rc.1**, the next additive release candidate. It is not a new first-ever v1.0.0 tag. Final version/tag publication requires owner approval; change all version identities together before a final release. This task does not publish or tag anything.

Follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html): additive compatible functionality is minor, fixes are patch, incompatible public tool/configuration contracts require a major release and migration notes. Older skills can use stable data tools; newer skills disclose an analytics fallback for older seven-tool servers. Copies and running Workers update independently.

## Release candidate checklist

1. Review the diff and synthetic fixtures. Confirm no instance files, secrets, logs or private records enter the source/archive. `check:public` is heuristic and does not replace review or GitHub secret scanning.
2. Run:

   ```bash
   pnpm install --frozen-lockfile
   pnpm check
   pnpm types:portable
   pnpm types:check
   pnpm verify:runtime
   pnpm test:fresh
   pnpm pack:skill
   pnpm audit --audit-level=high
   pnpm licenses list --prod
   ```

3. Inspect `.release/intervals-training-analyst-<version>.tar.gz` and its `.sha256`. `pack:skill` validates an extracted copy and includes MIT licensing, a version manifest and all skill resources. It requires `tar` (macOS/Linux or Windows with tar installed). It refuses to replace an existing artifact. Content/version checks are deterministic; gzip bytes/mtimes are not promised identical between builds. GitHub source archives remain sufficient for the CLI workflow; npm publication is unnecessary.
4. Review [compatibility](compatibility.md), [distribution validation](distribution-validation.md), and remaining manual/live checks. A release may honestly document unverified client combinations; do not promote them to verified from file tests.
5. Confirm GitHub branch protection, private vulnerability reporting, dependency alerts and secret scanning/push protection where available. Repository settings are owner-managed and are not silently changed by this task. CI uses pinned actions and a read-only token, receives no deployment credentials, and never publishes.
6. Prepare notes using the template below and request owner approval for the exact reviewed commit, tag and assets. Only after approval create a new tag/release targeting that commit. Never retarget existing tags. No release workflow automatically publishes packages or deploys infrastructure.

## Release notes template

```text
Version / exact commit:
Changes: portable install, diagnostics and distribution validation
Compatibility: unchanged ten read-only tool contracts; required owner OAuth preserved
Upgrade: install locked dependencies, run checks, explicitly redeploy; update skill copies separately
Verification: executed commands, synthetic vs live results, client versions and dates
Limitations: untested client/account combinations; unknown synchronization coverage; no hosted skill auto-install
Assets: source, optional skill archive and SHA-256 checksum
Rollback: previous reviewed source/config and explicit Wrangler rollback; credential rotation is separate
```

## Upgrade an instance

Back up ignored non-secret instance settings privately; keep the same owner-specific OAuth KV and existing secrets. Check release notes, then:

```bash
git fetch --tags origin
git switch --detach <reviewed-new-tag>
pnpm install --frozen-lockfile
pnpm check
pnpm verify:runtime
pnpm build:instance
```

Review generated settings against the new template. Only when ready, run `pnpm deploy:instance`. This changes production and requires the instance owner's authorization. Verify actual URL, unauthenticated 401, owner OAuth, ten tools, profile identity, a recent run and one comparison. Update skill copies explicitly with `pnpm skill:install --agent <target> --project <project> --update`; edited/unmanaged copies are never overwritten. Refresh client tool discovery. A skill update alone cannot upgrade the Worker.

## Rollback

Use Cloudflare's deployment history or `pnpm wrangler rollback --config wrangler.instance.jsonc` to explicitly restore a reviewed previous deployment. Read [Cloudflare rollback limits](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/): code rollback does not undo KV changes, credentials, or all external state. This change introduces no KV schema migration. Restore the previous reviewed source/lockfile and reinstall that skill version separately if necessary. Back up generated installation receipts and edited copies before replacing them. A rollback does not revoke compromised grants; rotate secrets/revoke access according to [SECURITY.md](../SECURITY.md).

## Post-release smoke checklist

Confirm the tag's exact SHA and CI, download/check archive checksum, repeat a clean source install and skill resource validation, then perform deployment and owner authorization only with approval. Record separately: synthetic protocol validation, production endpoint behavior, real Intervals retrieval, explicit skill invocation, implicit activation and the final weekly review. Do not publish private responses as release evidence.
