import { describe, expect, it, vi } from 'vitest';
import {
  configurationDiagnostics,
  endpointDiagnostics,
  endpointUrl,
} from '../../scripts/lib/doctor';
import { createWorker } from '../../src/index';
import { context, issueToken, testEnv } from '../helpers';
import { activities, fixtureFetch } from '../fixtures/data';

describe('privacy-conscious setup diagnostics', () => {
  it('validates names and formats without disclosing configuration or credential values', () => {
    expect(configurationDiagnostics({})[0]?.status).toBe('FAIL');
    const env = testEnv();
    const values = Object.fromEntries(
      Object.entries(env).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
    expect(configurationDiagnostics(values)[0]?.status).toBe('PASS');
    values.ATHLETE_TIMEZONE = 'INVALID-PRIVATE-VALUE';
    const result = configurationDiagnostics(values);
    expect(result[0]?.status).toBe('FAIL');
    expect(JSON.stringify(result)).not.toMatch(
      /PRIVATE-UPSTREAM-KEY|PRIVATE-GITHUB-SECRET|INVALID-PRIVATE-VALUE/,
    );
  });

  it.each([
    'https://user:password@example.net/mcp',
    'https://example.net/mcp?key=secret',
    'https://example.net/mcp#token',
    'http://example.net/mcp',
    'https://example.net/other',
    'ftp://localhost/mcp',
  ])('rejects unsafe endpoint configuration: %s', (url) => {
    expect(() => endpointUrl(url)).toThrow();
  });

  it('distinguishes authenticated success, identity checks and real empty data; all upstream operations remain GET', async () => {
    const env = testEnv();
    const { access_token } = await issueToken(env);
    const upstream = vi.fn(fixtureFetch());
    const worker = createWorker(upstream, () => {});
    const result = await endpointDiagnostics({
      url: `${env.PUBLIC_ORIGIN}/mcp`,
      token: access_token,
      athleteId: 'i123',
      now: new Date('2026-11-14T12:00:00Z'),
      requestFetch: async (input, init) => worker.fetch(new Request(input, init), env, context()),
    });
    expect(result.filter((row) => row.status === 'FAIL')).toEqual([]);
    expect(result.find((row) => row.check === 'tool_discovery')?.status).toBe('PASS');
    expect(result.find((row) => row.check === 'athlete_identity')?.status).toBe('PASS');
    expect(result.find((row) => row.check === 'analytics')?.status).toBe('PASS');
    const printed = JSON.stringify(result);
    expect(printed).not.toContain(access_token);
    expect(printed).not.toMatch(/MUST-NOT-LEAK|Test Runner|Long Run|PRIVATE-UPSTREAM-KEY|i123/);
    expect(upstream.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(
      true,
    );

    const empty = await endpointDiagnostics({
      url: `${env.PUBLIC_ORIGIN}/mcp`,
      token: access_token,
      now: new Date('2020-01-14T12:00:00Z'),
      requestFetch: async (input, init) => worker.fetch(new Request(input, init), env, context()),
    });
    expect(empty.find((row) => row.check === 'activities')?.status).toBe('WARN');
    expect(empty.find((row) => row.check === 'athlete_identity')?.status).toBe('WARN');
  });

  it('does not issue tool calls when credentials are missing or rejected', async () => {
    const env = testEnv();
    const upstream = vi.fn(fixtureFetch());
    const worker = createWorker(upstream, () => {});

    const requestFetch: typeof fetch = async (input, init) =>
      worker.fetch(new Request(input, init), env, context());

    const absent = await endpointDiagnostics({ url: `${env.PUBLIC_ORIGIN}/mcp`, requestFetch });
    expect(absent.find((row) => row.check === 'authenticated_initialization')?.status).toBe(
      'NOT_TESTED',
    );
    const rejected = await endpointDiagnostics({
      url: `${env.PUBLIC_ORIGIN}/mcp`,
      token: 'INVALID-PRIVATE-TOKEN',
      requestFetch,
    });
    expect(rejected.find((row) => row.check === 'authenticated_initialization')?.status).toBe(
      'FAIL',
    );
    expect(JSON.stringify(rejected)).not.toContain('INVALID-PRIVATE-TOKEN');
    expect(upstream).not.toHaveBeenCalled();
  });

  it('stops on mismatched identity before activity analysis', async () => {
    const env = testEnv();
    const { access_token } = await issueToken(env);
    const worker = createWorker(fixtureFetch(), () => {});
    const result = await endpointDiagnostics({
      url: `${env.PUBLIC_ORIGIN}/mcp`,
      token: access_token,
      athleteId: 'i999',
      requestFetch: async (input, init) => worker.fetch(new Request(input, init), env, context()),
    });
    expect(result.find((row) => row.check === 'athlete_identity')?.status).toBe('FAIL');
    expect(result.some((row) => row.check === 'analytics')).toBe(false);
  });

  it('refuses to send a token to an unprotected endpoint or redirected origin', async () => {
    const open = vi.fn(async () => Response.json({ status: 'open' }));
    const result = await endpointDiagnostics({
      url: 'https://owner.example.net/mcp',
      token: 'SYNTHETIC-TOKEN',
      requestFetch: open,
    });
    expect(result.find((row) => row.check === 'authentication_required')?.status).toBe('FAIL');
    expect(open).toHaveBeenCalledTimes(1);
    const redirect = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: 'https://attacker.invalid' } }),
    );
    expect(
      (
        await endpointDiagnostics({
          url: 'https://owner.example.net/mcp',
          token: 'SYNTHETIC-TOKEN',
          requestFetch: redirect,
        })
      )[0]?.status,
    ).toBe('FAIL');
    expect(redirect.mock.calls).toHaveLength(1);
  });

  it('reports unavailable upstream as failure and does not mistake it for empty data', async () => {
    const env = testEnv();
    const { access_token } = await issueToken(env);
    const worker = createWorker(
      async () => new Response('SYNTHETIC-PRIVATE-ERROR', { status: 401 }),
      () => {},
    );
    const result = await endpointDiagnostics({
      url: `${env.PUBLIC_ORIGIN}/mcp`,
      token: access_token,
      requestFetch: async (input, init) => worker.fetch(new Request(input, init), env, context()),
    });
    expect(result.find((row) => row.check === 'athlete_profile')?.status).toBe('FAIL');
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC-PRIVATE-ERROR');
    expect(activities.length).toBeGreaterThan(0);
  });
});
