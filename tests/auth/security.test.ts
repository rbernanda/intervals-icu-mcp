import { describe, expect, it, vi } from 'vitest';
import { createWorker } from '../../src/index';
import { createAuthorizationServer } from '../../src/auth/provider';
import { escapeHtml } from '../../src/auth/consent';
import { verifyGithubUser } from '../../src/auth/github';
import { parseConfig } from '../../src/config/env';
import { context, issueToken, mcpRequest, memoryKv, testEnv } from '../helpers';
import { fixtureFetch } from '../fixtures/data';

describe('OAuth access control', () => {
  it.each([undefined, 'not-a-token', 'Bearer bad'])(
    'rejects missing/invalid bearer %s before any upstream request',
    async (token) => {
      const upstream = vi.fn<typeof fetch>(fixtureFetch());
      const worker = createWorker(upstream, () => {});
      const env = testEnv();
      const response = await worker.fetch(mcpRequest(env, token), env, context());
      expect(response.status).toBe(401);
      expect(response.headers.get('WWW-Authenticate')).toContain('oauth-protected-resource/mcp');
      expect(upstream).not.toHaveBeenCalled();
    },
  );
  it('fails closed on missing configuration without revealing values', async () => {
    const env = testEnv();
    env.INTERVALS_API_KEY = '';
    const response = await createWorker(vi.fn(), () => {}).fetch(mcpRequest(env), env, context());
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"error":"Server is not configured."}');
  });
  it('verifies actual provider token expiry, with no signature/decryption bypass', async () => {
    const env = testEnv();
    const { access_token } = await issueToken(env);
    const worker = createWorker(fixtureFetch(), () => {});
    expect((await worker.fetch(mcpRequest(env, access_token), env, context())).status).toBe(200);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 901000);
    try {
      expect((await worker.fetch(mcpRequest(env, access_token), env, context())).status).toBe(401);
    } finally {
      vi.useRealTimers();
    }
  });
  it('rejects an altered token', async () => {
    const env = testEnv();
    const { access_token } = await issueToken(env);
    expect(
      (
        await createWorker(fixtureFetch(), () => {}).fetch(
          mcpRequest(env, `${access_token}x`),
          env,
          context(),
        )
      ).status,
    ).toBe(401);
  });
  it('rejects wrong subject and insufficient scopes', async () => {
    const env = testEnv();
    const worker = createWorker(fixtureFetch(), () => {});
    const other = await issueToken(env, { userId: '99999' });
    expect((await worker.fetch(mcpRequest(env, other.access_token), env, context())).status).toBe(
      403,
    );
    const noScope = await issueToken(env, { scopes: ['offline_access'] });
    const response = await worker.fetch(mcpRequest(env, noScope.access_token), env, context());
    expect(response.status).toBe(403);
    expect(response.headers.get('www-authenticate')).toContain('insufficient_scope');
  });
  it('rejects wrong audience at the real authorization server', async () => {
    const env = testEnv();
    const { access_token } = await issueToken(env);
    const other = new (
      await import('@cloudflare/workers-oauth-provider')
    ).OAuthAuthorizationServer<Env>({
      issuer: env.PUBLIC_ORIGIN,
      resources: [`${env.PUBLIC_ORIGIN}/other`],
    });
    expect(await other.validateToken(`${env.PUBLIC_ORIGIN}/other`, access_token, env)).toBeNull();
  });
  it('publishes RFC metadata with S256, resource, scopes and CIMD', async () => {
    const env = testEnv();
    const worker = createWorker(fixtureFetch(), () => {});
    const resource = await worker.fetch(
      new Request(`${env.PUBLIC_ORIGIN}/.well-known/oauth-protected-resource/mcp`),
      env,
      context(),
    );
    expect(await resource.json()).toMatchObject({
      resource: `${env.PUBLIC_ORIGIN}/mcp`,
      authorization_servers: [env.PUBLIC_ORIGIN],
      scopes_supported: ['intervals:read'],
    });
    const discovery = await worker.fetch(
      new Request(`${env.PUBLIC_ORIGIN}/.well-known/oauth-authorization-server`),
      env,
      context(),
    );
    expect(await discovery.json()).toMatchObject({
      issuer: env.PUBLIC_ORIGIN,
      code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true,
    });
  });
  it('guards browser Origin, Host, canonical origin and mutation methods', async () => {
    const env = testEnv();
    const worker = createWorker(fixtureFetch(), () => {});
    for (const headers of [
      new Headers({ Origin: 'https://evil.example' }),
      new Headers({ Origin: 'null' }),
      new Headers({ Host: 'evil.example' }),
    ]) {
      const response = await worker.fetch(
        new Request(`${env.PUBLIC_ORIGIN}/mcp`, { headers }),
        env,
        context(),
      );
      expect(response.status).toBe(403);
    }
    expect(
      (await worker.fetch(new Request('https://evil.example/mcp'), env, context())).status,
    ).toBe(403);
    const { access_token } = await issueToken(env);
    expect(
      (
        await worker.fetch(
          new Request(`${env.PUBLIC_ORIGIN}/mcp`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${access_token}` },
          }),
          env,
          context(),
        )
      ).status,
    ).toBe(405);
  });
  it('never echoes tokens, upstream keys or private profile fields in logs or output', async () => {
    const env = testEnv();
    const { access_token } = await issueToken(env);
    const logger = vi.fn();
    const worker = createWorker(fixtureFetch(), logger);
    const response = await worker.fetch(
      mcpRequest(env, access_token, 'tools/call', { name: 'get_athlete_profile', arguments: {} }),
      env,
      context(),
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    const logs = JSON.stringify(logger.mock.calls);
    for (const secret of [
      env.INTERVALS_API_KEY,
      env.GITHUB_CLIENT_SECRET,
      access_token,
      'MUST-NOT-LEAK',
      'private@example.com',
    ]) {
      expect(text).not.toContain(secret);
      expect(logs).not.toContain(secret);
    }
    expect(logs).toContain('get_athlete_profile');
    expect(logs).toContain('duration_ms');
  });
  it('does not trust callback parameters without browser-bound state', async () => {
    const env = testEnv();
    const upstream = vi.fn();
    const worker = createWorker(upstream, () => {});
    const response = await worker.fetch(
      new Request(`${env.PUBLIC_ORIGIN}/callback?code=stolen&state=made-up`),
      env,
      context(),
    );
    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('requires consent cookie and same-origin POST; rejects replay', async () => {
    const env = testEnv();
    const { authUrl } = await issueToken(env);
    const worker = createWorker(fixtureFetch(), () => {});
    const response = await worker.fetch(new Request(authUrl), env, context());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    const html = await response.text();
    const handle = /name="handle" value="([^"]+)"/.exec(html)![1]!;
    const body = new URLSearchParams({ handle, decision: 'approve', scope: 'intervals:read' });
    const forged = await worker.fetch(
      new Request(`${env.PUBLIC_ORIGIN}/authorize`, {
        method: 'POST',
        headers: { Origin: env.PUBLIC_ORIGIN },
        body,
      }),
      env,
      context(),
    );
    expect(forged.status).toBe(400);
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
    const approved = await worker.fetch(
      new Request(`${env.PUBLIC_ORIGIN}/authorize`, {
        method: 'POST',
        headers: { Origin: env.PUBLIC_ORIGIN, Cookie: cookie },
        body,
      }),
      env,
      context(),
    );
    expect(approved.status).toBe(302);
    const location = new URL(approved.headers.get('location')!);
    expect(location.origin).toBe('https://github.com');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    const replay = await worker.fetch(
      new Request(`${env.PUBLIC_ORIGIN}/authorize`, {
        method: 'POST',
        headers: { Origin: env.PUBLIC_ORIGIN, Cookie: cookie },
        body,
      }),
      env,
      context(),
    );
    expect(replay.status).toBe(400);
  });
  it('does not redirect to an unregistered URI and escapes client metadata', async () => {
    expect(escapeHtml('<script>"&')).toBe('&#60;script&#62;&#34;&#38;');
    const env = testEnv();
    const { authUrl } = await issueToken(env);
    authUrl.searchParams.set('redirect_uri', 'https://evil.example');
    const response = await createWorker(vi.fn(), () => {}).fetch(
      new Request(authUrl),
      env,
      context(),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
  });
  it('rejects PKCE-less authorization even for a known client', async () => {
    const env = testEnv();
    const { authUrl } = await issueToken(env);
    authUrl.searchParams.delete('code_challenge');
    authUrl.searchParams.delete('code_challenge_method');
    const response = await createWorker(vi.fn(), () => {}).fetch(
      new Request(authUrl),
      env,
      context(),
    );
    expect(response.status).not.toBe(200);
  });
  it('allows token refresh and rejects revoked credentials', async () => {
    const env = testEnv();
    const issued = await issueToken(env);
    const worker = createWorker(fixtureFetch(), () => {});
    const refreshed = await worker.fetch(
      new Request(`${env.PUBLIC_ORIGIN}/oauth/token`, {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: issued.refresh_token,
          client_id: issued.clientId,
          resource: `${env.PUBLIC_ORIGIN}/mcp`,
        }),
      }),
      env,
      context(),
    );
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as { access_token: string };
    expect((await worker.fetch(mcpRequest(env, next.access_token), env, context())).status).toBe(
      200,
    );
    const oauth = createAuthorizationServer(parseConfig(env), () => {}).getOAuthApi(env);
    const grants = await oauth.listUserGrants(env.ALLOWED_GITHUB_USER_ID);
    for (const grant of grants.items) await oauth.revokeGrant(grant.id, env.ALLOWED_GITHUB_USER_ID);
    expect((await worker.fetch(mcpRequest(env, next.access_token), env, context())).status).toBe(
      401,
    );
  });
  it.each([12345, 99999])(
    'completes browser-bound GitHub authorization only for allowed identity %s',
    async (githubId) => {
      const env = testEnv();
      const issued = await issueToken(env);
      const upstream = vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        if (url === 'https://github.com/login/oauth/access_token')
          return Response.json({ access_token: 'DISCARD-GITHUB-TOKEN', token_type: 'bearer' });
        if (url === 'https://api.github.com/user') return Response.json({ id: githubId });
        throw new Error('Unexpected test request');
      });
      const worker = createWorker(upstream, () => {});
      const consent = await worker.fetch(new Request(issued.authUrl), env, context());
      const handle = /name="handle" value="([^"]+)"/.exec(await consent.text())![1]!;
      const approved = await worker.fetch(
        new Request(`${env.PUBLIC_ORIGIN}/authorize`, {
          method: 'POST',
          headers: {
            Origin: env.PUBLIC_ORIGIN,
            Cookie: consent.headers.getSetCookie()[0]!.split(';')[0]!,
          },
          body: new URLSearchParams({ handle, decision: 'approve', scope: 'intervals:read' }),
        }),
        env,
        context(),
      );
      const state = new URL(approved.headers.get('location')!).searchParams.get('state')!;
      const cookie = approved.headers
        .getSetCookie()
        .find((value) => value.startsWith('__Host-oauth-upstream-'))!
        .split(';')[0]!;
      const callback = await worker.fetch(
        new Request(
          `${env.PUBLIC_ORIGIN}/callback?${new URLSearchParams({ state, code: 'valid-github-code' })}`,
          { headers: { Cookie: cookie } },
        ),
        env,
        context(),
      );
      if (githubId !== Number(env.ALLOWED_GITHUB_USER_ID)) {
        expect(callback.status).toBe(403);
        expect(callback.headers.get('location')).toBeNull();
        return;
      }
      expect(callback.status).toBe(302);
      const redirect = new URL(callback.headers.get('location')!);
      expect(redirect.origin).toBe('https://client.example.com');
      expect(redirect.searchParams.get('iss')).toBe(env.PUBLIC_ORIGIN);
      const exchanged = await worker.fetch(
        new Request(`${env.PUBLIC_ORIGIN}/oauth/token`, {
          method: 'POST',
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: issued.clientId,
            code: redirect.searchParams.get('code')!,
            redirect_uri: 'https://client.example.com/callback',
            code_verifier: 'a'.repeat(64),
            resource: `${env.PUBLIC_ORIGIN}/mcp`,
          }),
        }),
        env,
        context(),
      );
      expect(exchanged.status).toBe(200);
      const token = (await exchanged.json()) as { access_token: string };
      expect((await worker.fetch(mcpRequest(env, token.access_token), env, context())).status).toBe(
        200,
      );
    },
  );
  it('validates a CIMD public client and issues an audience-bound PKCE token', async () => {
    const env = testEnv();
    const clientId = 'https://metadata.example.com/client.json';
    const fetchDocument = vi.fn<typeof fetch>(async () =>
      Response.json(
        {
          client_id: clientId,
          client_name: 'CIMD Test',
          redirect_uris: ['https://client.example.com/callback'],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        },
        { headers: { 'Cache-Control': 'no-store' } },
      ),
    );
    vi.stubGlobal('fetch', fetchDocument);
    try {
      const server = createAuthorizationServer(parseConfig(env), () => {});
      const oauth = server.getOAuthApi(env);
      const challenge = await (await import('../../src/auth/github')).pkceChallenge('v'.repeat(64));
      const request = await oauth.parseAuthRequest(
        new Request(
          `${env.PUBLIC_ORIGIN}/authorize?${new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: 'https://client.example.com/callback', scope: 'intervals:read', resource: `${env.PUBLIC_ORIGIN}/mcp`, code_challenge: challenge, code_challenge_method: 'S256' })}`,
        ),
      );
      const { redirectTo } = await oauth.completeAuthorization({
        request,
        userId: env.ALLOWED_GITHUB_USER_ID,
        scope: request.scope,
        props: { userId: env.ALLOWED_GITHUB_USER_ID },
        metadata: {},
      });
      const result = await server.fetch(
        new Request(`${env.PUBLIC_ORIGIN}/oauth/token`, {
          method: 'POST',
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: clientId,
            redirect_uri: 'https://client.example.com/callback',
            code: new URL(redirectTo).searchParams.get('code')!,
            code_verifier: 'v'.repeat(64),
            resource: `${env.PUBLIC_ORIGIN}/mcp`,
          }),
        }),
        env,
        context(),
      );
      expect(result.status).toBe(200);
      const token = (await result.json()) as { access_token: string };
      expect(
        await server.validateToken(`${env.PUBLIC_ORIGIN}/mcp`, token.access_token, env),
      ).toMatchObject({ audience: `${env.PUBLIC_ORIGIN}/mcp`, scope: ['intervals:read'] });
      expect(fetchDocument).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.stubGlobal('Cloudflare', { compatibilityFlags: { global_fetch_strictly_public: true } });
    }
  });
  it('memory KV honors expiry without accepting stale values', async () => {
    const { kv } = memoryKv();
    await kv.put('test', 'x', { expiration: 1 });
    expect(await kv.get('test')).toBeNull();
  });
});

describe('single-user GitHub identity', () => {
  it('exchanges code with PKCE and authenticates the configured numeric ID', async () => {
    const env = testEnv();
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ access_token: 'github-private-token', token_type: 'bearer' }),
      )
      .mockResolvedValueOnce(Response.json({ id: 12345, login: 'test' }));
    expect(await verifyGithubUser(parseConfig(env), 'code', 'v'.repeat(64), requestFetch)).toBe(
      '12345',
    );
    expect(String(requestFetch.mock.calls[0]?.[1]?.body)).toContain('code_verifier=');
    expect(requestFetch.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer github-private-token',
    });
  });
  it('rejects other users and failed identity exchange', async () => {
    const config = parseConfig(testEnv());
    await expect(
      verifyGithubUser(
        config,
        'code',
        'v'.repeat(64),
        vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(Response.json({ access_token: 'token', token_type: 'bearer' }))
          .mockResolvedValueOnce(Response.json({ id: 999 })),
      ),
    ).rejects.toThrow('not authorized');
    await expect(
      verifyGithubUser(config, 'bad', 'v'.repeat(64), async () =>
        Response.json({ error: 'bad_verification_code' }),
      ),
    ).rejects.toThrow('not authorized');
  });
});
