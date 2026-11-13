import {
  isAllowedRequestOrigin,
  preflightResponse,
  withPrivacyHeaders,
  MAX_REQUEST_BYTES,
} from './server/http-policy';
import { parseConfig } from './config/env';
import { createAuthorizationServer } from './auth/provider';
import { handleAuthorization } from './auth/authorization';
import { createProtectedMcp } from './server/transport';
import { log, safeError, type Logger } from './utils/errors';
import { readBoundedBytes } from './utils/http';

/** No bearer bypass, even on localhost. All private operations pass through the OAuth resource server. */
export function createWorker(requestFetch: typeof fetch = fetch, logger: Logger = log) {
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const started = performance.now();
      let corsOrigin: string | undefined;

      const finish = (response: Response): Response => {
        logger({
          event: 'request',
          outcome: response.status < 400 ? 'ok' : 'error',
          duration_ms: Math.round(performance.now() - started),
          http_status: response.status,
        });
        return withPrivacyHeaders(response, corsOrigin);
      };

      let response: Response;
      try {
        const config = parseConfig(env);
        const url = new URL(request.url);
        if (!isAllowedRequestOrigin(request, config)) {
          return finish(new Response('Forbidden', { status: 403 }));
        }
        corsOrigin = request.headers.get('origin') ?? undefined;
        const preflight = preflightResponse(request, config.OAUTH_ENABLE_DCR);
        if (preflight) {
          return finish(preflight);
        }
        if (
          request.method === 'POST' &&
          Number(request.headers.get('content-length')) > MAX_REQUEST_BYTES
        ) {
          return finish(new Response('Request too large', { status: 413 }));
        }
        if (
          request.method === 'POST' &&
          ['/authorize', '/oauth/token', '/oauth/register'].includes(url.pathname) &&
          request.body
        ) {
          const body = await readBoundedBytes(request, MAX_REQUEST_BYTES);
          request = new Request(request, { body });
        }
        const authorizationServer = createAuthorizationServer(config, logger);
        if (['/mcp', '/.well-known/oauth-protected-resource/mcp'].includes(url.pathname)) {
          response = await createProtectedMcp(
            config,
            authorizationServer,
            requestFetch,
            logger,
          ).fetch(request, env, ctx);
        } else if (['/authorize', '/callback'].includes(url.pathname)) {
          response = await handleAuthorization(
            request,
            config,
            authorizationServer.getOAuthApi(env),
            requestFetch,
          );
        } else if (
          [
            '/.well-known/oauth-authorization-server',
            '/.well-known/openid-configuration',
            '/oauth/token',
            ...(config.OAUTH_ENABLE_DCR ? ['/oauth/register'] : []),
          ].includes(url.pathname)
        ) {
          response = await authorizationServer.fetch(request, env, ctx);
        } else if (url.pathname === '/health' && request.method === 'GET') {
          response = Response.json({ status: 'ok', service: 'intervals-icu-mcp' });
        } else {
          response = new Response('Not found', { status: 404 });
        }
      } catch (error) {
        const safe = safeError(error);
        logger({
          event: 'request',
          outcome: 'error',
          duration_ms: Math.round(performance.now() - started),
          error_category: safe.category,
        });
        response = Response.json(
          {
            error:
              safe.category === 'configuration'
                ? 'Server is not configured.'
                : 'Request could not be completed.',
          },
          { status: safe.category === 'response_too_large' ? 413 : 503 },
        );
      }
      return finish(response);
    },
  };
}

export default createWorker() satisfies ExportedHandler<Env>;
