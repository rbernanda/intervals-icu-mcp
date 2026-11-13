import { describe, expect, it, vi } from 'vitest';
import { createWorker } from '../../src/index';
import { context, issueToken, mcpRequest, testEnv } from '../helpers';
import { fixtureFetch } from '../fixtures/data';
import { pkceChallenge } from '../../src/auth/github';

const clientMetadata = {
  client_name: 'Synthetic Desktop Client',
  redirect_uris: ['http://127.0.0.1:6276/oauth/callback'],
  token_endpoint_auth_method: 'none',
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
};

describe('MCP clients beyond ChatGPT', () => {
  it('does not expose dynamic registration by default', async () => {
    const env = testEnv();
    const worker = createWorker(fixtureFetch(), () => {});
    const registered = await worker.fetch(
      new Request(`${env.PUBLIC_ORIGIN}/oauth/register`, {
        method: 'POST',
        body: JSON.stringify(clientMetadata),
      }),
      env,
      context(),
    );
    expect(registered.status).toBe(404);
    const discovery = await worker.fetch(
      new Request(`${env.PUBLIC_ORIGIN}/.well-known/oauth-authorization-server`),
      env,
      context(),
    );
    expect(await discovery.json()).not.toHaveProperty('registration_endpoint');
  });
  it('allows optional DCR without granting anonymous data access', async () => {
    const env = { ...testEnv(), OAUTH_ENABLE_DCR: 'true' };
    const upstream = vi.fn<typeof fetch>(fixtureFetch());
    const worker = createWorker(upstream, () => {});
    const response = await worker.fetch(
      new Request(`${env.PUBLIC_ORIGIN}/oauth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(clientMetadata),
      }),
      env,
      context(),
    );
    expect(response.status).toBe(201);
    const client = (await response.json()) as {
      client_id: string;
      token_endpoint_auth_method: string;
    };
    expect(client.client_id).toBeTruthy();
    expect(client.token_endpoint_auth_method).toBe('none');
    expect((await worker.fetch(mcpRequest(env), env, context())).status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
    const url = new URL('/authorize', env.PUBLIC_ORIGIN);
    url.search = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: clientMetadata.redirect_uris[0]!,
      response_type: 'code',
      scope: 'intervals:read',
      resource: `${env.PUBLIC_ORIGIN}/mcp`,
      code_challenge: await pkceChallenge('v'.repeat(64)),
      code_challenge_method: 'S256',
    }).toString();
    const consent = await worker.fetch(new Request(url), env, context());
    expect(consent.status).toBe(200);
    expect(await consent.text()).toContain('Synthetic Desktop Client');
    expect(upstream).not.toHaveBeenCalled();
  });
  it('advertises optional registration in discovery', async () => {
    const env = { ...testEnv(), OAUTH_ENABLE_DCR: 'true' };
    const response = await createWorker(fixtureFetch(), () => {}).fetch(
      new Request(`${env.PUBLIC_ORIGIN}/.well-known/oauth-authorization-server`),
      env,
      context(),
    );
    expect(await response.json()).toMatchObject({
      registration_endpoint: `${env.PUBLIC_ORIGIN}/oauth/register`,
    });
  });
  it('rejects excessive registration metadata and unsafe redirects', async () => {
    const env = { ...testEnv(), OAUTH_ENABLE_DCR: 'true' };
    const worker = createWorker(fixtureFetch(), () => {});
    for (const metadata of [
      {
        ...clientMetadata,
        redirect_uris: Array.from({ length: 6 }, () => clientMetadata.redirect_uris[0]),
      },
      { ...clientMetadata, redirect_uris: ['https://client.example/callback#unsafe'] },
    ]) {
      const response = await worker.fetch(
        new Request(`${env.PUBLIC_ORIGIN}/oauth/register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(metadata),
        }),
        env,
        context(),
      );
      expect(response.status).toBe(400);
    }
  });
  it('serves CORS preflight for configured browsers while preserving private endpoint authentication', async () => {
    const env = { ...testEnv(), MCP_ALLOWED_ORIGINS: 'https://browser.example.net' };
    const upstream = vi.fn<typeof fetch>(fixtureFetch());
    const worker = createWorker(upstream, () => {});
    const preflight = await worker.fetch(
      new Request(`${env.PUBLIC_ORIGIN}/mcp`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://browser.example.net',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization, content-type',
        },
      }),
      env,
      context(),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(
      'https://browser.example.net',
    );
    expect(preflight.headers.get('access-control-allow-headers')).toContain('Authorization');
    const unauthorized = mcpRequest(env);
    unauthorized.headers.set('Origin', 'https://browser.example.net');
    const denied = await worker.fetch(unauthorized, env, context());
    expect(denied.status).toBe(401);
    expect(denied.headers.get('access-control-expose-headers')).toContain('WWW-Authenticate');
    expect(upstream).not.toHaveBeenCalled();
  });
  it('allows a configured browser origin with authentication and rejects unconfigured origins', async () => {
    const env = { ...testEnv(), MCP_ALLOWED_ORIGINS: 'https://desktop.example.net' };
    const { access_token } = await issueToken(env);
    const worker = createWorker(fixtureFetch(), () => {});
    const request = mcpRequest(env, access_token);
    request.headers.set('Origin', 'https://desktop.example.net');
    expect((await worker.fetch(request, env, context())).status).toBe(200);
    const blocked = mcpRequest(env, access_token);
    blocked.headers.set('Origin', 'https://other.example.net');
    expect((await worker.fetch(blocked, env, context())).status).toBe(403);
  });
});

describe('independent owner instances', () => {
  it('never accepts another owner instance’s token or upstream credentials', async () => {
    const ownerA = testEnv();
    const tokenA = await issueToken(ownerA);
    const ownerB = {
      ...testEnv(),
      PUBLIC_ORIGIN: 'https://owner-b.example.net',
      INTERVALS_API_KEY: 'SYNTHETIC-KEY-B',
      ALLOWED_GITHUB_USER_ID: '54321',
    };
    const requests: string[] = [];
    const workerB = createWorker(
      async (_input, init) => {
        requests.push(new Headers(init?.headers).get('authorization') ?? '');
        return Response.json({ id: 'i456', name: 'Synthetic Owner B' });
      },
      () => {},
    );
    expect(
      (
        await workerB.fetch(
          mcpRequest(ownerB, tokenA.access_token, 'tools/call', {
            name: 'get_athlete_profile',
            arguments: {},
          }),
          ownerB,
          context(),
        )
      ).status,
    ).toBe(401);
    expect(requests).toEqual([]);
    const tokenB = await issueToken(ownerB);
    const response = await workerB.fetch(
      mcpRequest(ownerB, tokenB.access_token, 'tools/call', {
        name: 'get_athlete_profile',
        arguments: {},
      }),
      ownerB,
      context(),
    );
    expect(response.status).toBe(200);
    expect(requests).toEqual([`Basic ${btoa('API_KEY:SYNTHETIC-KEY-B')}`]);
    expect(await response.text()).not.toContain(ownerA.INTERVALS_API_KEY);
  });
});
