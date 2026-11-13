import type { Config } from '../config/env';

export const MAX_REQUEST_BYTES = 32_768;

export function isAllowedRequestOrigin(request: Request, config: Config): boolean {
  const url = new URL(request.url);
  const host = request.headers.get('host');
  const origin = request.headers.get('origin');
  return (
    url.origin === config.PUBLIC_ORIGIN &&
    (host === null || host === new URL(config.PUBLIC_ORIGIN).host) &&
    (origin === null || [config.PUBLIC_ORIGIN, ...config.MCP_ALLOWED_ORIGINS].includes(origin))
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
  )
    return undefined;
  const method = request.headers.get('Access-Control-Request-Method');
  if (!method || !['GET', 'POST'].includes(method))
    return new Response('Method not allowed', { status: 405 });
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
    },
  });
}

export function withPrivacyHeaders(response: Response, allowedOrigin?: string): Response {
  const secured = new Response(response.body, response);
  secured.headers.set('Cache-Control', 'no-store');
  secured.headers.set('X-Content-Type-Options', 'nosniff');
  secured.headers.set('Referrer-Policy', 'no-referrer');
  secured.headers.set('X-Frame-Options', 'DENY');
  if (allowedOrigin) {
    secured.headers.set('Access-Control-Allow-Origin', allowedOrigin);
    secured.headers.set('Access-Control-Expose-Headers', 'WWW-Authenticate, MCP-Protocol-Version');
    secured.headers.append('Vary', 'Origin');
  }
  return secured;
}
