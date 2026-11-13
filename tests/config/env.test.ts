import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/config/env';
import { testEnv } from '../helpers';

describe('self-hosted owner configuration', () => {
  it('has safe defaults for optional client compatibility features', () => {
    const { OAUTH_ENABLE_DCR: _dcr, MCP_ALLOWED_ORIGINS: _origins, ...env } = testEnv();
    void _dcr;
    void _origins;
    const config = parseConfig(env);
    expect(config.OAUTH_ENABLE_DCR).toBe(false);
    expect(config.MCP_ALLOWED_ORIGINS).toEqual([]);
  });
  it('accepts different owner identities, athlete IDs, domains and timezones without code changes', () => {
    const config = parseConfig({
      ...testEnv(),
      INTERVALS_API_KEY: 'synthetic-other-key',
      INTERVALS_ATHLETE_ID: 'i456',
      PUBLIC_ORIGIN: 'https://owner-b.example.net',
      ALLOWED_GITHUB_USER_ID: '54321',
      ATHLETE_TIMEZONE: 'America/New_York',
      OAUTH_ENABLE_DCR: 'true',
      MCP_ALLOWED_ORIGINS: 'https://client.example.net, http://localhost:6274',
    });
    expect(config).toMatchObject({
      INTERVALS_ATHLETE_ID: 'i456',
      PUBLIC_ORIGIN: 'https://owner-b.example.net',
      ALLOWED_GITHUB_USER_ID: '54321',
      ATHLETE_TIMEZONE: 'America/New_York',
      OAUTH_ENABLE_DCR: true,
      MCP_ALLOWED_ORIGINS: ['https://client.example.net', 'http://localhost:6274'],
    });
  });
  it.each([
    '*',
    'https://*.example.net',
    'null',
    'https://user:pass@example.net',
    'https://client.example.net/path',
    'http://remote.example.net',
  ])('rejects unsafe origin configuration %s', (origin) => {
    expect(() => parseConfig({ ...testEnv(), MCP_ALLOWED_ORIGINS: origin })).toThrow(
      'configuration',
    );
  });
  it.each(['yes', 'FALSE', '', '1'])('rejects ambiguous DCR flag %s', (flag) => {
    expect(() => parseConfig({ ...testEnv(), OAUTH_ENABLE_DCR: flag })).toThrow('configuration');
  });
});
