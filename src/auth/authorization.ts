import {
  AuthorizationError,
  CimdFetchError,
  authorizationErrorRedirect,
  type OAuthHelpers,
} from '@cloudflare/workers-oauth-provider';
import { z } from 'zod';
import type { Config } from '../config/env';
import { AppError } from '../utils/errors';
import { githubAuthorizeUrl, verifyGithubUser } from './github';
import { renderConsentPage } from './consent';
import { READ_SCOPE, type AuthProps } from './provider';

const upstreamDataSchema = z.object({ verifier: z.string().min(43).max(128) });
export async function handleAuthorization(
  request: Request,
  config: Config,
  oauth: OAuthHelpers,
  requestFetch: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (url.pathname === '/authorize' && request.method === 'GET') {
      const auth = await oauth.parseAuthRequest(request);
      // Enforce PKCE for confidential as well as public clients; do not accept unspecified scopes.
      if (
        !auth.codeChallenge ||
        auth.codeChallengeMethod !== 'S256' ||
        !auth.scope.includes(READ_SCOPE) ||
        auth.scope.some((scope) => ![READ_SCOPE, 'offline_access'].includes(scope))
      ) {
        return Response.redirect(
          authorizationErrorRedirect(
            auth,
            'invalid_request',
            'S256 PKCE and intervals:read scope are required.',
          ),
          302,
        );
      }
      const details = await oauth.describeConsent(auth);
      const consent = await oauth.beginConsent(auth);
      consent.headers.set('Content-Type', 'text/html; charset=utf-8');
      consent.headers.set(
        'Content-Security-Policy',
        "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      );
      return new Response(renderConsentPage(details, consent.handle), { headers: consent.headers });
    }
    if (url.pathname === '/authorize' && request.method === 'POST') {
      if (request.headers.get('origin') !== config.PUBLIC_ORIGIN)
        return new Response('Forbidden', { status: 403 });
      const form = await request.formData();
      const handle = z.string().min(1).max(512).parse(form.get('handle'));
      if (form.get('decision') !== 'approve') {
        const denied = await oauth.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const approved = await oauth.approveConsent(request, handle, {
        scope: form.getAll('scope').map(String),
      });
      if (!approved.request.scope.includes(READ_SCOPE))
        throw new AppError('invalid_input', 'Read scope is required.');
      const verifier = crypto.randomUUID() + crypto.randomUUID();
      const upstream = await oauth.beginUpstream(approved.request, {
        data: { verifier },
        headers: approved.headers,
      });
      upstream.headers.set('Location', await githubAuthorizeUrl(config, upstream.state, verifier));
      return new Response(null, { status: 302, headers: upstream.headers });
    }
    if (url.pathname === '/callback' && request.method === 'GET') {
      const resumed = await oauth.finishUpstream<unknown>(request);
      if (url.searchParams.has('error')) {
        resumed.headers.set(
          'Location',
          authorizationErrorRedirect(resumed.request, 'access_denied'),
        );
        return new Response(null, { status: 302, headers: resumed.headers });
      }
      const { verifier } = upstreamDataSchema.parse(resumed.data);
      const code = z.string().min(1).max(512).parse(url.searchParams.get('code'));
      const userId = await verifyGithubUser(config, code, verifier, requestFetch);
      const completed = await oauth.completeAuthorization({
        request: resumed.request,
        userId,
        metadata: {},
        scope: resumed.request.scope,
        props: { userId } satisfies AuthProps,
      });
      resumed.headers.set('Location', completed.redirectTo);
      return new Response(null, { status: 302, headers: resumed.headers });
    }
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: url.pathname === '/callback' ? 'GET' : 'GET, POST' },
    });
  } catch (error) {
    // Redirects only from the library-validated initial request, never reconstructed form/callback data.
    if (
      request.method === 'GET' &&
      url.pathname === '/authorize' &&
      error instanceof AuthorizationError &&
      error.redirectTo
    )
      return Response.redirect(error.redirectTo, 302);
    if (
      error instanceof AuthorizationError ||
      error instanceof CimdFetchError ||
      error instanceof z.ZodError
    )
      return new Response(
        'Invalid or expired authorization request. Restart sign-in from your MCP client.',
        { status: 400 },
      );
    if (error instanceof AppError)
      return new Response(error.message, {
        status: error.category === 'upstream_forbidden' ? 403 : 502,
      });
    throw error;
  }
}
