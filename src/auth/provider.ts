import { OAuthAuthorizationServer } from '@cloudflare/workers-oauth-provider';
import type { Config } from '../config/env';
import { log, type Logger } from '../utils/errors';

/** Advertised by the provider and separately enforced by the resource handler on every private request. */
export const READ_SCOPE = 'intervals:read';

/** Owner identity encrypted into the grant; it must agree with the verified token subject. */
export interface AuthProps {
  userId: string;
}

export function createAuthorizationServer(
  config: Config,
  logger: Logger = log,
): OAuthAuthorizationServer<Env> {
  return new OAuthAuthorizationServer<Env>({
    issuer: config.PUBLIC_ORIGIN,
    resources: [`${config.PUBLIC_ORIGIN}/mcp`],
    scopesSupported: [READ_SCOPE, 'offline_access'],
    clientIdMetadataDocumentEnabled: true,
    // CIMD is the default; DCR is opt-in for clients without CIMD support.
    ...(config.OAUTH_ENABLE_DCR ? { clientRegistrationEndpoint: '/oauth/register' } : {}),
    // Client registrations must persist while clients reuse their IDs; they are not user grants.
    clientRegistrationTTL: undefined,
    clientRegistrationCallback: ({ clientMetadata }) => {
      const redirectUris = clientMetadata.redirect_uris;
      if (!Array.isArray(redirectUris) || redirectUris.length === 0 || redirectUris.length > 5) {
        return { description: 'Provide between one and five redirect URIs.' };
      }
      // The provider validates schemes and exact redirects. Registration never authorizes data access.
      if (
        typeof clientMetadata.client_name !== 'string' ||
        !clientMetadata.client_name.trim() ||
        clientMetadata.client_name.length > 200
      ) {
        return { description: 'Provide a client name of at most 200 characters.' };
      }
    },
    accessTokenTTL: 900,
    refreshTokenTTL: 2_592_000,
    onError: ({ code, status }) => {
      logger({
        event: 'oauth',
        outcome: 'error',
        duration_ms: 0,
        error_category: code,
        http_status: status,
      });
    },
  });
}
