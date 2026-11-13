import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { IntervalsClient, retryAfterMs } from '../../src/intervals/client';
import { readBoundedJson } from '../../src/utils/http';
const range = { start_date: '2026-11-01', end_date: '2026-11-13' };
function setup(requestFetch: typeof fetch, timeoutMs = 1000) {
  const logger = vi.fn();
  const sleep = vi.fn(async () => {});
  return {
    client: new IntervalsClient({
      apiKey: 'secret-api',
      athleteId: '0',
      fetch: requestFetch,
      timeoutMs,
      sleep,
      logger,
    }),
    logger,
    sleep,
  };
}
describe('Intervals client', () => {
  it('uses documented Basic auth, paths, fields, inclusive timestamps and GET only', async () => {
    const requestFetch = vi.fn<typeof fetch>(async () => Response.json([]));
    const { client } = setup(requestFetch);
    await client.activities(range);
    const [input, options] = requestFetch.mock.calls[0]!;
    const url = new URL(String(input));
    expect(url.origin).toBe('https://intervals.icu');
    expect(url.pathname).toBe('/api/v1/athlete/0/activities');
    expect(url.searchParams.get('oldest')).toBe('2026-11-01T00:00:00');
    expect(url.searchParams.get('newest')).toBe('2026-11-13T23:59:59');
    expect(url.searchParams.get('limit')).toBe('1001');
    expect(options?.headers).toMatchObject({
      Authorization: `Basic ${btoa('API_KEY:secret-api')}`,
    });
    expect(options?.method).toBe('GET');
    expect(options?.redirect).toBe('manual');
  });
  it.each([
    [401, 'upstream_unauthorized'],
    [403, 'upstream_forbidden'],
    [404, 'not_found'],
  ])('maps %s without retry or leaking the upstream body', async (status, category) => {
    const requestFetch = vi.fn<typeof fetch>(
      async () => new Response('secret-api', { status: Number(status) }),
    );
    const { client, logger, sleep } = setup(requestFetch);
    await expect(client.profile()).rejects.toMatchObject({ category, upstreamStatus: status });
    expect(requestFetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.mock.calls)).not.toContain('secret-api');
  });
  it('retries transient HTTP failures at most twice', async () => {
    const requestFetch = vi.fn<typeof fetch>(async () => new Response(null, { status: 503 }));
    const { client, sleep } = setup(requestFetch);
    await expect(client.profile()).rejects.toMatchObject({ category: 'upstream_unavailable' });
    expect(requestFetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toHaveLength(2);
  });
  it('honors short Retry-After then succeeds', async () => {
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '1' } }))
      .mockResolvedValueOnce(Response.json({ id: 'i123' }));
    const { client, sleep } = setup(requestFetch);
    expect(await client.profile()).toEqual({ id: 'i123' });
    expect(sleep).toHaveBeenCalledWith(1000);
  });
  it('returns long rate-limit delay without waiting early or retrying', async () => {
    const requestFetch = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 429, headers: { 'retry-after': '370' } }),
    );
    const { client, sleep } = setup(requestFetch);
    await expect(client.profile()).rejects.toMatchObject({
      category: 'rate_limited',
      retryAfterSeconds: 370,
    });
    expect(sleep).not.toHaveBeenCalled();
    expect(requestFetch).toHaveBeenCalledTimes(1);
  });
  it('parses Retry-After seconds and HTTP dates', () => {
    expect(retryAfterMs('2', 0)).toBe(2000);
    expect(retryAfterMs('Thu, 01 Jan 1970 00:00:03 GMT', 1000)).toBe(2000);
    expect(retryAfterMs('invalid', 0)).toBeUndefined();
  });
  it('times out and bounds retries', async () => {
    const requestFetch = vi.fn<typeof fetch>(
      (_input, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const { client } = setup(requestFetch, 5);
    await expect(client.profile()).rejects.toMatchObject({ category: 'timeout' });
    expect(requestFetch).toHaveBeenCalledTimes(3);
  });
  it('keeps the deadline active while reading the body', async () => {
    const requestFetch = vi.fn<typeof fetch>(
      async (_input, options) =>
        new Response(
          new ReadableStream({
            start(controller) {
              options?.signal?.addEventListener('abort', () =>
                controller.error(new DOMException('Aborted', 'AbortError')),
              );
            },
          }),
        ),
    );
    const { client } = setup(requestFetch, 5);
    await expect(client.profile()).rejects.toMatchObject({ category: 'timeout' });
  });
  it.each([{}, { id: 1 }, { id: 'i123', weight: '60' }, { id: 'i123', weight: -1 }])(
    'rejects invalid schemas',
    async (payload) => {
      const { client } = setup(async () => Response.json(payload));
      await expect(client.profile()).rejects.toMatchObject({ category: 'invalid_response' });
    },
  );
  it('strips all undeclared fields including credentials from profile', async () => {
    const { client } = setup(async () =>
      Response.json({ id: 'i123', icu_api_key: 'SECRET', unexpected: true }),
    );
    expect(await client.profile()).toEqual({ id: 'i123' });
  });
  it('rejects invalid JSON without returning it', async () => {
    const { client } = setup(async () => new Response('secret-api'));
    await expect(client.profile()).rejects.toMatchObject({ category: 'invalid_response' });
  });
  it('does not permit path injection or external hosts', async () => {
    const { client } = setup(vi.fn());
    expect(() => client.activity('../other')).toThrow();
    await expect(client.get('https://evil.example', z.unknown())).rejects.toMatchObject({
      category: 'invalid_input',
    });
  });
  it('bounds date ranges and arrays', async () => {
    const { client } = setup(async () =>
      Response.json(Array.from({ length: 1002 }, () => ({ id: 'a' }))),
    );
    await expect(client.activities(range)).rejects.toMatchObject({ category: 'invalid_response' });
    expect(() => client.wellness({ start_date: '2025-01-01', end_date: '2026-01-01' })).toThrow(
      '90',
    );
  });
  it.each([302, 400])(
    'rejects unexpected HTTP %s without following redirects or retrying',
    async (status) => {
      const requestFetch = vi.fn<typeof fetch>(
        async () =>
          new Response(null, { status, headers: { Location: 'https://evil.example.com/' } }),
      );
      const { client } = setup(requestFetch);
      await expect(client.profile()).rejects.toMatchObject({
        category: 'invalid_response',
        upstreamStatus: status,
      });
      expect(requestFetch).toHaveBeenCalledTimes(1);
    },
  );
  it('bounds total time across sequential requests', async () => {
    let time = 0;
    const client = new IntervalsClient({
      apiKey: 'key',
      athleteId: '0',
      deadlineAtMs: 25000,
      now: () => time,
      logger: () => {},
      fetch: async () => Response.json({ id: 'i123' }),
    });
    await client.profile();
    time = 25001;
    await expect(client.profile()).rejects.toMatchObject({ category: 'timeout' });
  });
  it('bounds body bytes even without Content-Length', async () => {
    await expect(readBoundedJson(new Response('123456'), 5)).rejects.toMatchObject({
      category: 'response_too_large',
    });
  });
});
