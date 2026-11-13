import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareDeployment, INSTANCE_SECRETS } from '../../scripts/lib/deployment';
import { assertNewFile, dotenvContents, writePrivateFile } from '../../scripts/lib/files';
import { publicationProblems } from '../../scripts/lib/publication';

const settings = {
  worker_name: 'owner-example-mcp',
  public_origin: 'https://owner.example.net',
  oauth_namespace_id: 'a'.repeat(32),
  github_client_id: 'synthetic-client',
  owner_github_id: '54321',
  timezone: 'Etc/UTC',
  allowed_origins: 'https://client.example.net',
  enable_dcr: false,
};
const template = {
  main: 'src/index.ts',
  compatibility_date: '2026-11-13',
  vars: { UPSTREAM_TIMEOUT_MS: '10000' },
  secrets: { required: [] },
};
describe('reproducible instance setup', () => {
  it('prepares a separate deployment configuration without credentials or source changes', () => {
    const original = structuredClone(template);
    const config = prepareDeployment(settings, template);
    expect(config).toMatchObject({
      name: settings.worker_name,
      kv_namespaces: [{ binding: 'OAUTH_KV', id: settings.oauth_namespace_id }],
      vars: {
        PUBLIC_ORIGIN: settings.public_origin,
        ALLOWED_GITHUB_USER_ID: settings.owner_github_id,
        ATHLETE_TIMEZONE: 'Etc/UTC',
        OAUTH_ENABLE_DCR: 'false',
      },
      secrets: { required: [...INSTANCE_SECRETS] },
    });
    expect(template).toEqual(original);
    for (const key of INSTANCE_SECRETS) {
      expect(config.vars).not.toHaveProperty(key);
    }
  });
  it('refuses HTTP public deployment, invalid KV IDs, usernames and unsupported settings', () => {
    for (const invalid of [
      { public_origin: 'http://localhost:8787' },
      { public_origin: 'not-a-url' },
      { oauth_namespace_id: 'not-a-namespace' },
      { owner_github_id: 'a-username' },
      { timezone: 'Unknown/Zone' },
      { api_key: 'never-accept-credentials-here' },
    ]) {
      expect(() => prepareDeployment({ ...settings, ...invalid }, template)).toThrow(
        'Invalid instance',
      );
    }
  });
  it('does not copy upstream credentials accidentally placed in base vars', () => {
    const config = prepareDeployment(settings, {
      ...template,
      vars: {
        ...template.vars,
        INTERVALS_API_KEY: 'SYNTHETIC-DO-NOT-COPY',
        INTERVALS_ATHLETE_ID: 'i456',
        GITHUB_CLIENT_SECRET: 'SYNTHETIC-GH-SECRET',
      },
    });
    expect(JSON.stringify(config)).not.toMatch(/SYNTHETIC-DO-NOT-COPY|SYNTHETIC-GH-SECRET/);
  });
  it('quotes local values and refuses multiline settings', () => {
    expect(dotenvContents({ VALUE: 'synthetic#"\\value' })).toBe(
      'VALUE="synthetic#\\"\\\\value"\n',
    );
    expect(() => dotenvContents({ VALUE: 'one\ntwo' })).toThrow('one line');
  });
  it('writes private files once and refuses overwriting existing credentials', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcp-setup-test-'));
    const path = join(directory, '.dev.vars');
    try {
      await assertNewFile(path);
      await writePrivateFile(path, 'SYNTHETIC=true\n');
      if (process.platform !== 'win32') {
        expect((await stat(path)).mode & 0o777).toBe(0o600);
      }
      await expect(assertNewFile(path)).rejects.toThrow('already exists');
      await expect(writePrivateFile(path, 'overwritten')).rejects.toThrow();
      expect(await readFile(path, 'utf8')).toBe('SYNTHETIC=true\n');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
describe('publication safeguards', () => {
  it('rejects private configuration and runtime state, but permits example templates', () => {
    for (const path of [
      '.env',
      '.env.production',
      '.dev.vars',
      'wrangler.instance.jsonc',
      '.wrangler/state/db',
    ]) {
      expect(publicationProblems(path, 'synthetic')).not.toEqual([]);
    }
    expect(publicationProblems('.env.example', 'INTERVALS_API_KEY=replace-locally')).toEqual([]);
  });
  it('detects representative credential leakage without exposing the matched value', () => {
    const token = 'ghp_' + 'x'.repeat(36);
    const problems = publicationProblems('accidental.txt', token);
    expect(problems).toHaveLength(1);
    expect(problems[0]).not.toContain(token);
  });
});
