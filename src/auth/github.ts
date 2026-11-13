import { z } from 'zod';
import type { Config } from '../config/env';
import { AppError } from '../utils/errors';
import { readBoundedJson } from '../utils/http';

/** Produces the RFC 7636 S256 challenge using unpadded base64url encoding. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const hash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  );
  return btoa(String.fromCharCode(...hash))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function githubAuthorizeUrl(
  config: Config,
  state: string,
  verifier: string,
): Promise<string> {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.search = new URLSearchParams({
    client_id: config.GITHUB_CLIENT_ID,
    redirect_uri: `${config.PUBLIC_ORIGIN}/callback`,
    state,
    scope: '',
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: 'S256',
    allow_signup: 'false',
  }).toString();
  return url.toString();
}

/**
 * Uses a temporary token to verify the immutable GitHub account ID, then discards that token.
 * It is never stored as an MCP credential or forwarded to Intervals.icu.
 */
export async function verifyGithubUser(
  config: Config,
  code: string,
  verifier: string,
  requestFetch: typeof fetch = fetch,
): Promise<string> {
  const tokenResponse = await requestFetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.GITHUB_CLIENT_ID,
      client_secret: config.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${config.PUBLIC_ORIGIN}/callback`,
      code_verifier: verifier,
    }),
  });
  if (!tokenResponse.ok) {
    await tokenResponse.body?.cancel();
    throw new AppError('upstream_unavailable', 'GitHub sign-in failed.');
  }
  const parsed = z
    .object({
      access_token: z.string().min(1),
      token_type: z.string().refine((s) => s.toLowerCase() === 'bearer'),
    })
    .safeParse(await readBoundedJson(tokenResponse, 16384));
  if (!parsed.success)
    throw new AppError('upstream_forbidden', 'GitHub sign-in was not authorized.');
  // GitHub token is used only for identity, then discarded; never persisted or returned to the MCP client.
  const userResponse = await requestFetch('https://api.github.com/user', {
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: `Bearer ${parsed.data.access_token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'intervals-icu-mcp',
    },
  });
  if (!userResponse.ok) {
    await userResponse.body?.cancel();
    throw new AppError('upstream_forbidden', 'GitHub identity could not be verified.');
  }
  const user = z
    .object({ id: z.number().int().positive().safe() })
    .safeParse(await readBoundedJson(userResponse, 65536));
  if (!user.success || String(user.data.id) !== config.ALLOWED_GITHUB_USER_ID)
    throw new AppError('upstream_forbidden', 'This GitHub account is not authorized.');
  return String(user.data.id);
}
