import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { describe, expect, it, vi } from 'vitest';
import { createWorker } from '../../src/index';
import { analyticsOutputs } from '../../src/tools/analytics/contracts';
import { fixtureFetch } from '../fixtures/data';
import { context, issueToken, mcpRequest, testEnv } from '../helpers';

const range = { start_date: '2026-11-08', end_date: '2026-11-14' };
const calls = [
  {
    name: 'compare_training_periods',
    arguments: {
      current: range,
      baseline: { start_date: '2026-11-01', end_date: '2026-11-07' },
      sport_type: 'running',
    },
    output: analyticsOutputs.compare,
  },
  { name: 'analyze_aerobic_efficiency', arguments: range, output: analyticsOutputs.efficiency },
  {
    name: 'compare_running_workouts',
    arguments: { ...range, activity_ids: ['a2'] },
    output: analyticsOutputs.workouts,
  },
] as const;

describe('analytics through the original protected MCP transport', () => {
  it('invokes all three tools through the official client with validated structured content and privacy-safe logs', async () => {
    const env = testEnv();
    const { access_token } = await issueToken(env);
    const logger = vi.fn();
    const worker = createWorker(fixtureFetch(), logger);
    const client = new Client({ name: 'analytics-integration', version: '1' });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${env.PUBLIC_ORIGIN}/mcp`), {
          requestInit: { headers: { Authorization: `Bearer ${access_token}` } },
          fetch: async (input, init) => worker.fetch(new Request(input, init), env, context()),
        }),
      );
      for (const call of calls) {
        const result = await client.callTool({ name: call.name, arguments: call.arguments });
        expect(result.isError, JSON.stringify({ tool: call.name, result })).not.toBe(true);
        expect(call.output.safeParse(result.structuredContent).success).toBe(true);
        expect(JSON.stringify(result)).not.toMatch(
          /PRIVATE-UPSTREAM-KEY|PRIVATE-GITHUB-SECRET|MUST-NOT-LEAK/,
        );
      }
      const logs = JSON.stringify(logger.mock.calls);
      expect(logs).toContain('compare_training_periods');
      expect(logs).not.toContain(access_token);
      expect(logs).not.toMatch(/PRIVATE-UPSTREAM-KEY|Long Run|average_heart_rate_bpm|distance_m/);
    } finally {
      await client.close();
    }
  });

  it('rejects missing, invalid, wrong-owner and wrong-scope authorization before fetching private data', async () => {
    const env = testEnv();
    const upstream = vi.fn<typeof fetch>(fixtureFetch());
    const worker = createWorker(upstream, () => {});
    const wrongOwner = await issueToken(env, { userId: '99999' });
    const wrongScope = await issueToken(env, { scopes: ['offline_access'] });
    for (const token of [undefined, 'invalid', wrongOwner.access_token, wrongScope.access_token]) {
      for (const call of calls) {
        const response = await worker.fetch(
          mcpRequest(env, token, 'tools/call', { name: call.name, arguments: call.arguments }),
          env,
          context(),
        );
        expect([401, 403]).toContain(response.status);
      }
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rejects an expired OAuth token on the analytics endpoint', async () => {
    const env = testEnv();
    const upstream = vi.fn<typeof fetch>(fixtureFetch());
    const worker = createWorker(upstream, () => {});
    const { access_token } = await issueToken(env);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 16 * 60 * 1000);
      const response = await worker.fetch(
        mcpRequest(env, access_token, 'tools/call', {
          name: calls[0].name,
          arguments: calls[0].arguments,
        }),
        env,
        context(),
      );
      expect(response.status).toBe(401);
      expect(upstream).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns safe upstream errors and SDK validation errors rather than numerical success', async () => {
    const env = testEnv();
    const { access_token } = await issueToken(env);
    const worker = createWorker(
      async () => new Response('PRIVATE-UPSTREAM-KEY', { status: 401 }),
      () => {},
    );
    for (const args of [range, { ...range, limit: 100 }]) {
      const response = await worker.fetch(
        mcpRequest(env, access_token, 'tools/call', {
          name: 'compare_running_workouts',
          arguments: args,
        }),
        env,
        context(),
      );
      const body = await response.text();
      expect(body).toMatch(/isError|error/);
      expect(body).not.toContain('PRIVATE-UPSTREAM-KEY');
    }
  });
});
