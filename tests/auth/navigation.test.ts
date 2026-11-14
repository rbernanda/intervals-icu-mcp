import { describe, expect, it, vi } from 'vitest';
import { createWorker } from '../../src/index';
import { pkceChallenge } from '../../src/auth/github';
import { context, mcpRequest, testEnv } from '../helpers';

async function nativeAuthorizationUrl(origin: string): Promise<URL> {
  const url = new URL('/authorize', origin);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: 'https://native.example.com/client.json',
    state: 'synthetic-client-state',
    code_challenge: await pkceChallenge('v'.repeat(64)),
    code_challenge_method: 'S256',
    redirect_uri: 'http://127.0.0.1:54321/callback',
    scope: 'intervals:read offline_access',
    resource: `${origin}/mcp`,
  }).toString();

  return url;
}

/** Synthetic native CIMD client: loopback ports vary per sign-in, as required by RFC 8252. */
async function withNativeClient(run: () => Promise<void>): Promise<void> {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () =>
      Response.json({
        client_id: 'https://native.example.com/client.json',
        client_name: 'Synthetic Native Client',
        application_type: 'native',
        redirect_uris: ['http://127.0.0.1/callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    ),
  );

  try {
    await run();
  } finally {
    vi.unstubAllGlobals();
    vi.stubGlobal('Cloudflare', { compatibilityFlags: { global_fetch_strictly_public: true } });
  }
}

describe('cross-site OAuth navigation', () => {
  it.each(['https://desktop.example.net', 'null'])(
    'renders native-client consent for Origin %s without granting CORS or invoking upstream data',
    async (origin) =>
      withNativeClient(async () => {
        const env = testEnv();
        const upstream = vi.fn<typeof fetch>();
        const worker = createWorker(upstream, () => {});
        const url = await nativeAuthorizationUrl(env.PUBLIC_ORIGIN);
        const consent = await worker.fetch(
          new Request(url, { headers: { Origin: origin } }),
          env,
          context(),
        );

        expect(consent.status).toBe(200);
        expect(await consent.text()).toContain('Synthetic Native Client');
        expect(consent.headers.get('access-control-allow-origin')).toBeNull();
        expect(consent.headers.get('cache-control')).toBe('no-store');
        expect(consent.headers.get('referrer-policy')).toBe('same-origin');
        expect(consent.headers.get('content-security-policy')).toContain(
          "form-action 'self' https://github.com http://127.0.0.1:54321;",
        );
        expect(upstream).not.toHaveBeenCalled();
      }),
  );

  it.each(['https://desktop.example.net', 'null'])(
    'still rejects cross-site consent submission, callback forgery and MCP access for Origin %s',
    async (origin) =>
      withNativeClient(async () => {
        const env = testEnv();
        const upstream = vi.fn<typeof fetch>();
        const worker = createWorker(upstream, () => {});
        const consent = await worker.fetch(
          new Request(await nativeAuthorizationUrl(env.PUBLIC_ORIGIN)),
          env,
          context(),
        );
        const handle = /name="handle" value="([^"]+)"/.exec(await consent.text())![1]!;
        const submission = await worker.fetch(
          new Request(`${env.PUBLIC_ORIGIN}/authorize`, {
            method: 'POST',
            headers: { Origin: origin, Cookie: consent.headers.getSetCookie()[0]!.split(';')[0]! },
            body: new URLSearchParams({ handle, decision: 'approve', scope: 'intervals:read' }),
          }),
          env,
          context(),
        );

        expect(submission.status).toBe(403);
        expect(submission.headers.get('referrer-policy')).toBe('no-referrer');
        expect(submission.headers.get('location')).toBeNull();

        const callback = await worker.fetch(
          new Request(`${env.PUBLIC_ORIGIN}/callback?code=synthetic&state=forged`, {
            headers: { Origin: origin },
          }),
          env,
          context(),
        );

        expect(callback.status).toBe(400);
        expect(callback.headers.get('referrer-policy')).toBe('no-referrer');
        expect(callback.headers.get('location')).toBeNull();
        expect(callback.headers.get('access-control-allow-origin')).toBeNull();

        const mcp = mcpRequest(env);
        mcp.headers.set('Origin', origin);
        expect((await worker.fetch(mcp, env, context())).status).toBe(403);
        expect(upstream).not.toHaveBeenCalled();
      }),
  );

  it('keeps the canonical origin and Host checks on OAuth navigation', async () => {
    const env = testEnv();
    const worker = createWorker(vi.fn(), () => {});
    const authorization = await nativeAuthorizationUrl(env.PUBLIC_ORIGIN);
    const otherOrigin = new URL(authorization);
    otherOrigin.host = 'other.example.net';

    for (const request of [
      new Request(authorization, { headers: { Host: 'other.example.net' } }),
      new Request(otherOrigin),
    ]) {
      expect((await worker.fetch(request, env, context())).status).toBe(403);
    }
  });
});
