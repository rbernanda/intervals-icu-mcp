import { vi } from 'vitest';
import { createAuthorizationServer, READ_SCOPE } from '../src/auth/provider';
import { parseConfig } from '../src/config/env';
import { pkceChallenge } from '../src/auth/github';

export function memoryKv() {
  const rows = new Map<string, { value: string; expiration?: number; metadata?: unknown }>();
  const kv = {
    get: vi.fn(async (key: string | string[], options?: { type?: string } | string) => {
      if (Array.isArray(key)) return new Map(key.map((k) => [k, rows.get(k)?.value ?? null]));
      const row = rows.get(key);
      if (!row || (row.expiration !== undefined && row.expiration <= Date.now() / 1000))
        return null;
      return (typeof options === 'string' ? options : options?.type) === 'json'
        ? (JSON.parse(row.value) as unknown)
        : row.value;
    }),
    getWithMetadata: vi.fn(async (key: string | string[]) =>
      Array.isArray(key) ? new Map() : { value: null, metadata: null, cacheStatus: null },
    ),
    put: vi.fn(
      async (
        key: string,
        value: string,
        options?: { expirationTtl?: number; expiration?: number; metadata?: unknown },
      ) => {
        rows.set(key, {
          value,
          expiration:
            options?.expiration ??
            (options?.expirationTtl ? Date.now() / 1000 + options.expirationTtl : undefined),
          metadata: options?.metadata,
        });
      },
    ),
    delete: vi.fn(async (key: string) => {
      rows.delete(key);
    }),
    list: vi.fn(async (options?: { prefix?: string }) => ({
      keys: [...rows]
        .filter(([key]) => key.startsWith(options?.prefix ?? ''))
        .map(([name, row]) => ({ name, metadata: row.metadata })),
      list_complete: true,
      cacheStatus: null,
    })),
  };
  // Test-only subset of the platform KV API used by the unmodified provider.
  return { kv: kv as KVNamespace, rows };
}

export function testEnv(kv = memoryKv().kv): Env {
  return {
    OAUTH_KV: kv,
    INTERVALS_API_KEY: 'PRIVATE-UPSTREAM-KEY',
    INTERVALS_ATHLETE_ID: '0',
    PUBLIC_ORIGIN: 'https://mcp.example.com',
    GITHUB_CLIENT_ID: 'github-client',
    GITHUB_CLIENT_SECRET: 'PRIVATE-GITHUB-SECRET',
    ALLOWED_GITHUB_USER_ID: '12345',
    ATHLETE_TIMEZONE: 'Asia/Jakarta',
    UPSTREAM_TIMEOUT_MS: '10000',
    MCP_ALLOWED_ORIGINS: '',
    OAUTH_ENABLE_DCR: 'false',
  };
}

export function context(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
    exports: {} as Cloudflare.Exports,
    tracing: {} as Tracing,
    mapVirtualHost: vi.fn(),
    abort: vi.fn(),
  } as ExecutionContext;
}

export async function issueToken(env: Env, options: { scopes?: string[]; userId?: string } = {}) {
  const as = createAuthorizationServer(parseConfig(env), () => {});
  const oauth = as.getOAuthApi(env);
  const client = await oauth.createClient({
    clientName: 'Test Client',
    redirectUris: ['https://client.example.com/callback'],
    tokenEndpointAuthMethod: 'none',
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
  });
  const verifier = 'a'.repeat(64);
  const authUrl = new URL('/authorize', env.PUBLIC_ORIGIN);
  authUrl.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: 'https://client.example.com/callback',
    response_type: 'code',
    scope: (options.scopes ?? [READ_SCOPE, 'offline_access']).join(' '),
    resource: `${env.PUBLIC_ORIGIN}/mcp`,
    state: 'test-state',
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: 'S256',
  }).toString();
  const auth = await oauth.parseAuthRequest(new Request(authUrl));
  const userId = options.userId ?? env.ALLOWED_GITHUB_USER_ID;
  const { redirectTo } = await oauth.completeAuthorization({
    request: auth,
    userId,
    metadata: {},
    scope: auth.scope,
    props: { userId },
  });
  const response = await as.fetch(
    new Request(`${env.PUBLIC_ORIGIN}/oauth/token`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: client.clientId,
        code: new URL(redirectTo).searchParams.get('code')!,
        redirect_uri: 'https://client.example.com/callback',
        code_verifier: verifier,
        resource: `${env.PUBLIC_ORIGIN}/mcp`,
      }),
    }),
    env,
    context(),
  );
  const result = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    error?: string;
  };
  if (response.status !== 200 || !result.access_token)
    throw new Error(`Fixture token exchange failed: ${result.error ?? response.status}`);
  return { ...result, authorizationServer: as, clientId: client.clientId, authUrl };
}

export function mcpRequest(
  env: Env,
  token?: string,
  method = 'tools/list',
  args?: Record<string, unknown>,
  modern = false,
): Request {
  return new Request(`${env.PUBLIC_ORIGIN}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(modern ? {} : { 'MCP-Protocol-Version': '2025-11-25' }),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: {
        ...args,
        ...(modern
          ? {
              _meta: {
                'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
                'io.modelcontextprotocol/clientCapabilities': {},
              },
            }
          : {}),
      },
    }),
  });
}
