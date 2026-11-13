import { z } from 'zod';
import { AppError } from '../utils/errors';

export const timezoneSchema = z
  .string()
  .min(1)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  });

export const publicOriginSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        !value.includes('*') &&
        url.origin === value &&
        !url.username &&
        !url.password &&
        (url.protocol === 'https:' ||
          (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      );
    } catch {
      return false;
    }
  });

const allowedOriginsSchema = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
  .pipe(z.array(publicOriginSchema).max(20));
const schema = z.object({
  INTERVALS_API_KEY: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[\x21-\x7e]+$/),
  INTERVALS_ATHLETE_ID: z.string().regex(/^(0|i?[1-9]\d*)$/),
  PUBLIC_ORIGIN: publicOriginSchema,
  MCP_ALLOWED_ORIGINS: allowedOriginsSchema,
  OAUTH_ENABLE_DCR: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  ALLOWED_GITHUB_USER_ID: z.string().regex(/^[1-9]\d*$/),
  ATHLETE_TIMEZONE: timezoneSchema,
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(100).max(20000).default(10000),
});

export type Config = z.infer<typeof schema>;

export function parseConfig(env: unknown): Config {
  const result = schema.safeParse(env);
  if (
    !result.success ||
    Object.values(result.data).some((v) => typeof v === 'string' && v.startsWith('replace-'))
  ) {
    throw new AppError('configuration', 'Required server configuration is missing or invalid.');
  }
  return result.data;
}
