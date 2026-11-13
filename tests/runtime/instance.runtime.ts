import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ts from 'typescript';
import { z } from 'zod';
import { prepareDeployment } from '../../scripts/lib/deployment';

it('builds the generated owner-specific configuration using Wrangler without production access', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-instance-build-'));
  try {
    const parsed = ts.parseConfigFileTextToJson(
      'wrangler.jsonc',
      await readFile('wrangler.jsonc', 'utf8'),
    );
    const template = z.record(z.string(), z.unknown()).parse(parsed.config as unknown);
    const config = prepareDeployment(
      {
        worker_name: 'synthetic-owner-mcp',
        public_origin: 'https://owner.example.net',
        oauth_namespace_id: 'b'.repeat(32),
        github_client_id: 'synthetic-client',
        owner_github_id: '54321',
        timezone: 'Etc/UTC',
      },
      template,
    );
    config.main = resolve('src/index.ts'); // The test file lives in tmp; the real wizard writes at the project root.
    const path = join(directory, 'wrangler.jsonc');
    await writeFile(path, JSON.stringify(config), { mode: 0o600 });
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        'node_modules/wrangler/bin/wrangler.js',
        'deploy',
        '--config',
        path,
        '--dry-run',
        '--outdir',
        join(directory, 'dist'),
      ],
      { timeout: 25000, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
    );
    expect(stdout).toContain('--dry-run: exiting now');
    expect(stdout).toContain('OAUTH_KV');
    expect(stdout).not.toContain('PRIVATE-UPSTREAM-KEY');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
