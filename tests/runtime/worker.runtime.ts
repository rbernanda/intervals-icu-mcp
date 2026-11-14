import { it, expect } from 'vitest';
import {
  Miniflare,
  convertV4MiniflareOptions,
  Response as MiniflareResponse,
  type V4MiniflareOptions,
} from 'miniflare';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtureFetch } from '../fixtures/data';
import { issueToken, memoryKv, testEnv } from '../helpers';
import { pkceChallenge } from '../../src/auth/github';

it('runs the production bundle in workerd and passes MCP Inspector discovery and invocation in both protocol eras', async () => {
  const memory = memoryKv();
  const env = testEnv(memory.kv);
  const { OAUTH_KV: _kv, ...bindings } = env;
  void _kv;
  const upstreamFetch = fixtureFetch();
  const nativeClientId = 'https://native.example.net/client.json';

  const options = (origin: string, port: number, enableDcr = false) =>
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: 'dist/index.js',
      compatibilityDate: '2026-11-13',
      compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
      host: '127.0.0.1',
      port,
      kvNamespaces: ['OAUTH_KV'],
      bindings: { ...bindings, PUBLIC_ORIGIN: origin, OAUTH_ENABLE_DCR: String(enableDcr) },
      outboundService: async (req) => {
        if (req.url === nativeClientId) {
          return new MiniflareResponse(
            JSON.stringify({
              client_id: nativeClientId,
              client_name: 'Synthetic Native Client',
              application_type: 'native',
              redirect_uris: ['http://127.0.0.1/callback'],
              token_endpoint_auth_method: 'none',
              grant_types: ['authorization_code', 'refresh_token'],
              response_types: ['code'],
            }),
            { headers: { 'content-type': 'application/json' } },
          );
        }

        if (!req.url.startsWith('https://intervals.icu/')) {
          throw new Error('Unexpected outbound request');
        }
        const response = await upstreamFetch(req.url);
        return new MiniflareResponse(await response.text(), {
          status: response.status,
          headers: { 'content-type': 'application/json' },
        });
      },
    } satisfies V4MiniflareOptions);

  const mf = new Miniflare(options(env.PUBLIC_ORIGIN, 0));
  const directory = await mkdtemp(join(tmpdir(), 'intervals-inspector-'));
  try {
    const origin = (await mf.ready).origin;
    env.PUBLIC_ORIGIN = origin;
    // setOptions requires a complete config; retain the mock outbound boundary.
    await mf.setOptions(options(origin, Number(new URL(origin).port)));
    const { access_token } = await issueToken(env);
    const kv = await mf.getKVNamespace('OAUTH_KV');
    for (const [key, row] of memory.rows) {
      await kv.put(key, row.value, { metadata: row.metadata });
    }
    const unauthorized = await fetch(`${origin}/mcp`, { method: 'POST' });
    expect(unauthorized.status).toBe(401);
    const metadata = await fetch(`${origin}/.well-known/oauth-authorization-server`);
    expect(await metadata.json()).toMatchObject({
      client_id_metadata_document_supported: true,
      code_challenge_methods_supported: ['S256'],
    });

    const authorizationUrl = new URL('/authorize', origin);
    authorizationUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: nativeClientId,
      state: 'synthetic-native-state',
      code_challenge: await pkceChallenge('v'.repeat(64)),
      code_challenge_method: 'S256',
      redirect_uri: 'http://127.0.0.1:54321/callback',
      scope: 'intervals:read offline_access',
      resource: `${origin}/mcp`,
    }).toString();

    for (const browserOrigin of ['https://desktop.example.net', 'null']) {
      const consent = await fetch(authorizationUrl, { headers: { Origin: browserOrigin } });
      expect(consent.status).toBe(200);
      expect(await consent.text()).toContain('Synthetic Native Client');
      expect(consent.headers.get('access-control-allow-origin')).toBeNull();

      const forgedConsent = await fetch(`${origin}/authorize`, {
        method: 'POST',
        headers: { Origin: browserOrigin },
        body: new URLSearchParams({ handle: 'forged', decision: 'approve' }),
        redirect: 'manual',
      });
      expect(forgedConsent.status).toBe(403);

      const forbiddenMcp = await fetch(`${origin}/mcp`, {
        method: 'POST',
        headers: { Origin: browserOrigin, Authorization: `Bearer ${access_token}` },
      });
      expect(forbiddenMcp.status).toBe(403);
    }

    const configFile = join(directory, 'config.json');
    await writeFile(
      configFile,
      JSON.stringify({
        mcpServers: {
          local: {
            url: `${origin}/mcp`,
            type: 'http',
            headers: { Authorization: `Bearer ${access_token}` },
          },
        },
      }),
      { mode: 0o600 },
    );
    const cli = join(
      process.cwd(),
      'node_modules/@modelcontextprotocol/inspector/clients/launcher/build/index.js',
    );
    for (const era of ['legacy', 'modern']) {
      const args = [
        cli,
        '--cli',
        '--config',
        configFile,
        '--server',
        'local',
        '--protocol-era',
        era,
        '--format',
        'json',
      ];
      const listed = await promisify(execFile)(
        process.execPath,
        [...args, '--method', 'tools/list', '--strict'],
        {
          timeout: 15000,
          env: {
            ...process.env,
            MCP_INSPECTOR_OAUTH_STATE_PATH: join(directory, 'oauth.json'),
            MCP_CLIENT_CONFIG_PATH: join(directory, 'client.json'),
          },
        },
      );
      expect(listed.stdout).toContain('get_training_summary');
      const called = await promisify(execFile)(
        process.execPath,
        [
          ...args,
          '--method',
          'tools/call',
          '--tool-name',
          'get_athlete_profile',
          '--tool-args-json',
          '{}',
        ],
        {
          timeout: 15000,
          env: {
            ...process.env,
            MCP_INSPECTOR_OAUTH_STATE_PATH: join(directory, 'oauth.json'),
            MCP_CLIENT_CONFIG_PATH: join(directory, 'client.json'),
          },
        },
      );
      expect(called.stdout).toContain('Test Runner');
      expect(called.stdout).not.toContain('MUST-NOT-LEAK');
    }

    // Exercise the opt-in compatibility endpoint in the real runtime too.
    const registrationRequest = () => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Synthetic Inspector Client',
        redirect_uris: ['http://127.0.0.1:6276/oauth/callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    });

    expect((await fetch(`${origin}/oauth/register`, registrationRequest())).status).toBe(404);
    await mf.setOptions(options(origin, Number(new URL(origin).port), true));
    const registered = await fetch(`${origin}/oauth/register`, registrationRequest());
    expect(registered.status).toBe(201);
    expect(await registered.json()).toHaveProperty('client_id');
    expect((await fetch(`${origin}/mcp`, { method: 'POST' })).status).toBe(401);
    const smoke = await promisify(execFile)(
      process.execPath,
      [join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'), 'scripts/smoke-test.ts'],
      {
        timeout: 15000,
        env: { ...process.env, MCP_URL: `${origin}/mcp`, MCP_ACCESS_TOKEN: access_token },
      },
    );
    expect(smoke.stdout).toContain('PASS: unauthorized rejection');
    console.log(
      'Verified: workerd OAuth rejection, CIMD/S256 metadata, MCP Inspector legacy + modern discovery and authenticated tool calls (mock Intervals data).',
    );
  } finally {
    await mf.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
