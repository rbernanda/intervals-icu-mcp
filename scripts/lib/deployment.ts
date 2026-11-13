import { z } from 'zod';
import { publicOriginSchema, timezoneSchema } from '../../src/config/env';

/** Never copy these values into instance vars; they must remain Cloudflare Workers Secrets. */
export const INSTANCE_SECRETS = [
  'INTERVALS_API_KEY',
  'INTERVALS_ATHLETE_ID',
  'GITHUB_CLIENT_SECRET',
] as const;

const deploymentSchema = z
  .object({
    worker_name: z
      .string()
      .min(1)
      .max(63)
      .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
    public_origin: publicOriginSchema.refine((value) => value.startsWith('https://')),
    oauth_namespace_id: z.string().regex(/^[a-f0-9]{32}$/),
    github_client_id: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9_.-]+$/),
    owner_github_id: z.string().regex(/^[1-9]\d*$/),
    timezone: timezoneSchema,
    allowed_origins: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
      )
      .pipe(z.array(publicOriginSchema).max(20)),
    enable_dcr: z.boolean().default(false),
  })
  .strict();

/** Pure, offline preparation: the generated file contains only non-secret instance settings. */
export function prepareDeployment(
  input: unknown,
  template: Record<string, unknown>,
): Record<string, unknown> {
  const result = deploymentSchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      'Invalid instance settings. Check HTTPS origin, namespace ID, numeric owner ID, worker name and IANA timezone.',
    );
  }
  const settings = result.data;
  const templateVars = z.record(z.string(), z.unknown()).parse(template.vars ?? {});
  const safeVars = Object.fromEntries(
    Object.entries(templateVars).filter(
      ([key]) => !INSTANCE_SECRETS.some((secret) => secret === key),
    ),
  );
  return {
    ...template,
    name: settings.worker_name,
    kv_namespaces: [{ binding: 'OAUTH_KV', id: settings.oauth_namespace_id }],
    vars: {
      ...safeVars,
      PUBLIC_ORIGIN: settings.public_origin,
      GITHUB_CLIENT_ID: settings.github_client_id,
      ALLOWED_GITHUB_USER_ID: settings.owner_github_id,
      ATHLETE_TIMEZONE: settings.timezone,
      MCP_ALLOWED_ORIGINS: settings.allowed_origins.join(','),
      OAUTH_ENABLE_DCR: String(settings.enable_dcr),
    },
    secrets: { required: [...INSTANCE_SECRETS] },
  };
}
