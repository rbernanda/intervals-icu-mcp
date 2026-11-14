import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { outputs } from '../src/tools/contracts';
const url = new URL(process.env.MCP_URL ?? 'http://localhost:8787/mcp');
if (
  url.pathname !== '/mcp' ||
  url.username ||
  url.password ||
  (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname))
) {
  throw new Error('Use an HTTPS /mcp endpoint, or loopback HTTP for development.');
}
const token = (
  process.env.MCP_TOKEN_FILE
    ? await readFile(process.env.MCP_TOKEN_FILE, 'utf8')
    : process.env.MCP_ACCESS_TOKEN
)?.trim();
if (!token) {
  throw new Error(
    'Provide an OAuth access token through MCP_TOKEN_FILE (mode 0600) or MCP_ACCESS_TOKEN in your local terminal. Never put credentials in chat or CLI arguments. See README.',
  );
}
const unauthorized = await fetch(url, {
  method: 'POST',
  signal: AbortSignal.timeout(15000),
  redirect: 'error',
});
if (unauthorized.status !== 401) {
  throw new Error(`Unauthenticated endpoint returned ${unauthorized.status}; expected 401.`);
}
const client = new Client({ name: 'intervals-smoke-test', version: '1.0.0' });
try {
  await client.connect(
    new StreamableHTTPClientTransport(url, {
      requestInit: {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30000),
      },
    }),
  );
  const tools = await client.listTools();
  const names = [
    'get_athlete_profile',
    'get_recent_activities',
    'get_activity_details',
    'get_fitness_trend',
    'get_wellness',
    'get_training_calendar',
    'get_training_summary',
    'compare_training_periods',
    'analyze_aerobic_efficiency',
    'compare_running_workouts',
  ];
  if (
    tools.tools.length !== names.length ||
    names.some(
      (name) => !tools.tools.some((tool) => tool.name === name && tool.annotations?.readOnlyHint),
    )
  ) {
    throw new Error('Expected ten read-only tools.');
  }
  const profile = await client.callTool({ name: 'get_athlete_profile', arguments: {} });
  if (profile.isError) {
    throw new Error(
      'Profile retrieval failed; inspect server error category without printing private data.',
    );
  }
  outputs.profile.parse(profile.structuredContent);
  const recent = await client.callTool({ name: 'get_recent_activities', arguments: { limit: 1 } });
  if (recent.isError) {
    throw new Error('Activity retrieval failed.');
  }
  outputs.recent.parse(recent.structuredContent);
  z.object({ source: z.literal('Intervals.icu') }).parse(profile.structuredContent);
  console.log(
    'PASS: unauthorized rejection, MCP connection, ten-tool discovery, profile and activity retrieval, validated structured outputs. No athlete data printed.',
  );
} finally {
  await client.close();
}
