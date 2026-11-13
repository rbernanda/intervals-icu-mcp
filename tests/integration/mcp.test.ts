import { describe, expect, it, vi } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createWorker } from '../../src/index';
import { fixtureFetch } from '../fixtures/data';
import { context, issueToken, mcpRequest, testEnv } from '../helpers';

describe('authenticated MCP Streamable HTTP', () => {
  it('initializes using official client, discovers exactly seven read-only tools and invokes structured output', async () => {
    const env = testEnv();
    const { access_token } = await issueToken(env);
    const worker = createWorker(fixtureFetch(), () => {});
    const client = new Client({ name: 'integration-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${env.PUBLIC_ORIGIN}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${access_token}` } },
      fetch: async (input, init) => worker.fetch(new Request(input, init), env, context()),
    });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(7);
      for (const tool of tools.tools) {
        expect(tool.annotations?.readOnlyHint).toBe(true);
        expect(tool.outputSchema).toBeDefined();
      }
      const result = await client.callTool({ name: 'get_athlete_profile', arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        source: 'Intervals.icu',
        athlete: { id: 'i123' },
      });
    } finally {
      await client.close();
    }
  });
  it('accepts legacy initialization, discovery and calls over stateless HTTP', async () => {
    const env = testEnv();
    const { access_token } = await issueToken(env);
    const worker = createWorker(fixtureFetch(), () => {});
    const init = await worker.fetch(
      mcpRequest(env, access_token, 'initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'legacy', version: '1' },
      }),
      env,
      context(),
    );
    expect(init.status).toBe(200);
    const response = await worker.fetch(
      mcpRequest(env, access_token, 'tools/list'),
      env,
      context(),
    );
    expect(await response.text()).toContain('get_training_summary');
    expect(response.headers.get('mcp-session-id')).toBeNull();
  });
  it('lets the SDK reject invalid JSON-RPC and tool arguments', async () => {
    const env = testEnv();
    const { access_token } = await issueToken(env);
    const worker = createWorker(fixtureFetch(), () => {});
    const malformed = await worker.fetch(
      new Request(`${env.PUBLIC_ORIGIN}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${access_token}`,
          'content-type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: '{bad',
      }),
      env,
      context(),
    );
    expect(malformed.status).toBe(400);
    const badArgs = await worker.fetch(
      mcpRequest(env, access_token, 'tools/call', {
        name: 'get_recent_activities',
        arguments: { limit: 101 },
      }),
      env,
      context(),
    );
    expect(await badArgs.text()).toMatch(/isError|error/);
  });
  it('returns safe, actionable upstream tool errors', async () => {
    const env = testEnv();
    const { access_token } = await issueToken(env);
    const worker = createWorker(
      async () => new Response('PRIVATE-UPSTREAM-KEY', { status: 401 }),
      () => {},
    );
    const response = await worker.fetch(
      mcpRequest(env, access_token, 'tools/call', { name: 'get_athlete_profile', arguments: {} }),
      env,
      context(),
    );
    const text = await response.text();
    expect(text).toContain('upstream_unauthorized');
    expect(text).toContain('isError');
    expect(text).not.toContain('PRIVATE-UPSTREAM-KEY');
  });
  it('enforces bounded bodies and unregistered/write tools', async () => {
    const env = testEnv();
    const { access_token } = await issueToken(env);
    const upstream = vi.fn<typeof fetch>(fixtureFetch());
    const worker = createWorker(upstream, () => {});
    const large = await worker.fetch(
      new Request(`${env.PUBLIC_ORIGIN}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${access_token}`,
          'content-type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ data: 'x'.repeat(32769) }),
      }),
      env,
      context(),
    );
    expect(large.status).toBe(413);
    const unknown = await worker.fetch(
      mcpRequest(env, access_token, 'tools/call', {
        name: 'delete_activity',
        arguments: { activity_id: 'a2' },
      }),
      env,
      context(),
    );
    expect(await unknown.text()).toMatch(/error|isError/);
    expect(upstream).not.toHaveBeenCalled();
  });
});
