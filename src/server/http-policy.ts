import type { Config } from '../config/env';

export const MAX_REQUEST_BYTES = 32_768;

/** CORS is granted only to configured origins, even when cross-site OAuth navigation is allowed. */
export function allowedCorsOrigin(request: Request, config: Config): string | undefined {
  const origin = request.headers.get('origin');

  return origin !== null && [config.PUBLIC_ORIGIN, ...config.MCP_ALLOWED_ORIGINS].includes(origin)
    ? origin
    : undefined;
}

/**
 * OAuth GET navigation can originate outside this site; consent POST and callback state protect the flow.
 * Every request still targets the canonical host. MCP and other routes require an allowed or absent Origin.
 */
export function isAllowedRequestOrigin(request: Request, config: Config): boolean {
  const url = new URL(request.url);
  const host = request.headers.get('host');
  const origin = request.headers.get('origin');
  const oauthNavigation =
    request.method === 'GET' && ['/authorize', '/callback'].includes(url.pathname);

  return (
    url.origin === config.PUBLIC_ORIGIN &&
    (host === null || host === new URL(config.PUBLIC_ORIGIN).host) &&
    (oauthNavigation || origin === null || allowedCorsOrigin(request, config) !== undefined)
  );
}

/** Called only after origin validation. Preflight exposes no athlete data. */
export function preflightResponse(request: Request, enableDcr: boolean): Response | undefined {
  const paths = [
    '/mcp',
    '/oauth/token',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-protected-resource/mcp',
    ...(enableDcr ? ['/oauth/register'] : []),
  ];
  if (
    request.method !== 'OPTIONS' ||
    !request.headers.has('origin') ||
    !paths.includes(new URL(request.url).pathname)
  ) {
    return undefined;
  }
  const method = request.headers.get('Access-Control-Request-Method');
  if (!method || !['GET', 'POST'].includes(method)) {
    return new Response('Method not allowed', { status: 405 });
  }
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
    },
  });
}

/**
 * Disables caching of OAuth codes/tokens. Consent may opt into same-origin referrers so form POSTs retain Origin.
 * Other responses default to no-referrer.
 */
export function withPrivacyHeaders(response: Response, allowedOrigin?: string): Response {
  const secured = new Response(response.body, response);
  secured.headers.set('Cache-Control', 'no-store');
  secured.headers.set('X-Content-Type-Options', 'nosniff');
  if (!secured.headers.has('Referrer-Policy')) {
    secured.headers.set('Referrer-Policy', 'no-referrer');
  }
  secured.headers.set('X-Frame-Options', 'DENY');
  if (allowedOrigin) {
    secured.headers.set('Access-Control-Allow-Origin', allowedOrigin);
    secured.headers.set('Access-Control-Expose-Headers', 'WWW-Authenticate, MCP-Protocol-Version');
    secured.headers.append('Vary', 'Origin');
  }
  return secured;
}
