import { MAX_REQUEST_BYTES } from './http-policy';
import { createMcpHandler } from '@modelcontextprotocol/server';
import {
  OAuthResourceServer,
  insufficientScope,
  type OAuthAuthorizationServer,
} from '@cloudflare/workers-oauth-provider';
import type { Config } from '../config/env';
import { READ_SCOPE, type AuthProps } from '../auth/provider';
import { IntervalsClient, UPSTREAM_BUDGET_MS } from '../intervals/client';
import { TrainingService } from '../tools/service';
import { createMcpServer } from './create-mcp-server';
import { log, type Logger } from '../utils/errors';

export function createProtectedMcp(
  config: Config,
  authorizationServer: OAuthAuthorizationServer<Env>,
  requestFetch: typeof fetch = fetch,
  logger: Logger = log,
) {
  return new OAuthResourceServer<Env, AuthProps>({
    resourceMetadata: {
      resource: `${config.PUBLIC_ORIGIN}/mcp`,
      authorization_servers: [config.PUBLIC_ORIGIN],
    },
    requiredScopes: [READ_SCOPE],
    validateToken: (env) => (resource, token) =>
      authorizationServer.validateToken<AuthProps>(resource, token, env),
    handler: {
      async fetch(request, _env, ctx) {
        if (!ctx.auth.scope.includes(READ_SCOPE)) return insufficientScope(ctx.auth, [READ_SCOPE]);
        if (
          ctx.auth.userId !== config.ALLOWED_GITHUB_USER_ID ||
          ctx.props.userId !== config.ALLOWED_GITHUB_USER_ID
        )
          return new Response('Forbidden', { status: 403 });
        const service = new TrainingService(
          new IntervalsClient({
            apiKey: config.INTERVALS_API_KEY,
            athleteId: config.INTERVALS_ATHLETE_ID,
            timeoutMs: config.UPSTREAM_TIMEOUT_MS,
            deadlineAtMs: Date.now() + UPSTREAM_BUDGET_MS,
            fetch: requestFetch,
            logger,
          }),
          { timezone: config.ATHLETE_TIMEZONE },
        );
        const handler = createMcpHandler(() => createMcpServer(service, logger), {
          legacy: 'stateless',
          responseMode: 'auto',
          maxRequestBodySize: MAX_REQUEST_BYTES,
        });
        return handler.fetch(request, {
          authInfo: {
            token: ctx.auth.token,
            clientId: ctx.auth.clientId ?? '',
            scopes: ctx.auth.scope,
            expiresAt: ctx.auth.expiresAt,
          },
        });
      },
    },
  });
}
