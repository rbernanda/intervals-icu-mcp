import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { parseConfig } from '../../src/config/env';
import { outputs } from '../../src/tools/contracts';
import { analyticsOutputs } from '../../src/tools/analytics/contracts';
import { shiftDate, todayInTimezone } from '../../src/utils/dates';
import { readBoundedBytes } from '../../src/utils/http';
import { VERSION } from '../../src/version';

export type DiagnosticStatus = 'PASS' | 'WARN' | 'FAIL' | 'NOT_TESTED';

export interface Diagnostic {
  check: string;
  status: DiagnosticStatus;
  message: string;
}

export const TOOL_NAMES = [
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
] as const;

export function configurationDiagnostics(values: Record<string, string>): Diagnostic[] {
  const required = [
    'INTERVALS_API_KEY',
    'INTERVALS_ATHLETE_ID',
    'PUBLIC_ORIGIN',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'ALLOWED_GITHUB_USER_ID',
    'ATHLETE_TIMEZONE',
  ];
  const missing = required.filter((name) => !values[name] || values[name].startsWith('replace-'));
  if (missing.length) {
    return [
      {
        check: 'local_configuration',
        status: 'FAIL',
        message: `Set ${missing.join(', ')} locally with pnpm setup:local.`,
      },
    ];
  }
  try {
    parseConfig(values);
    return [
      {
        check: 'local_configuration',
        status: 'PASS',
        message:
          'Required names and value formats are valid. Credentials and account ownership have not been verified.',
      },
    ];
  } catch {
    return [
      {
        check: 'local_configuration',
        status: 'FAIL',
        message:
          'Invalid configuration. Check athlete ID, exact origin, numeric GitHub owner ID, IANA timezone and optional settings. No values printed.',
      },
    ];
  }
}

export function endpointUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.pathname !== '/mcp' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    !(
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    )
  ) {
    throw new Error(
      'Use HTTPS /mcp without credentials, query or fragment; loopback HTTP is allowed for local tests.',
    );
  }
  return url;
}

/** No implicit login, redirects, credential-store reads or payload logging. At most three tool calls. */
export async function endpointDiagnostics(options: {
  url: string;
  token?: string;
  athleteId?: string;
  requestFetch?: typeof fetch;
  now?: Date;
}): Promise<Diagnostic[]> {
  const url = endpointUrl(options.url);
  const rows: Diagnostic[] = [];

  const record = (check: string, status: DiagnosticStatus, message: string): void => {
    rows.push({ check, status, message });
  };

  const requestFetch = options.requestFetch ?? fetch;

  // Bound body size and total diagnostic time; a hostile redirect must never receive a bearer token.
  const deadline = AbortSignal.timeout(60000);

  const boundedFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).origin !== url.origin) {
      throw new Error('Diagnostic requests must stay on the configured origin.');
    }
    const response = await requestFetch(request, {
      redirect: 'error',
      signal: AbortSignal.any([deadline, request.signal, AbortSignal.timeout(15000)]),
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error('Endpoint redirected.');
    }
    if (!response.body || response.status === 204) {
      return response;
    }
    const bytes = await readBoundedBytes(response, 1_000_000);
    return new Response(bytes, { status: response.status, headers: response.headers });
  };

  try {
    const response = await boundedFetch(url, { method: 'POST' });
    record('endpoint_reachable', 'PASS', 'The endpoint responded.');
    if (response.status !== 401) {
      record(
        'authentication_required',
        'FAIL',
        'Expected HTTP 401 without authorization. Check configuration and access controls before sending credentials.',
      );
      return rows;
    }
    record(
      'authentication_required',
      'PASS',
      'Unauthenticated requests are rejected with HTTP 401.',
    );
  } catch {
    record(
      'endpoint_reachable',
      'FAIL',
      'No safe bounded response. Check URL, network, HTTPS certificate and redirects.',
    );
    return rows;
  }

  if (!options.token) {
    for (const check of [
      'authenticated_initialization',
      'tool_discovery',
      'athlete_profile',
      'athlete_identity',
      'activities',
      'analytics',
    ]) {
      record(
        check,
        'NOT_TESTED',
        'Supply a legitimately issued OAuth token using --token-file. Doctor does not obtain or extract client tokens.',
      );
    }
    return rows;
  }
  if (!/^[\x21-\x7e]+$/.test(options.token) || options.token.length > 16000) {
    record(
      'authenticated_initialization',
      'FAIL',
      'Invalid token file format. Reauthorize in your client.',
    );
    return rows;
  }
  const client = new Client({ name: 'intervals-setup-doctor', version: VERSION });
  let stage = 'authenticated_initialization';
  try {
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: `Bearer ${options.token}` } },
        fetch: boundedFetch,
      }),
    );
    record(stage, 'PASS', 'Authenticated MCP initialization succeeded.');
    stage = 'tool_discovery';
    const listed = (await client.listTools()).tools;
    if (
      listed.length !== TOOL_NAMES.length ||
      TOOL_NAMES.some(
        (name) =>
          !listed.some((tool) => tool.name === name && tool.annotations?.readOnlyHint === true),
      )
    ) {
      record(
        stage,
        'FAIL',
        'Expected ten read-only tools. Update the deployed Worker and refresh client discovery.',
      );
      return rows;
    }
    record(stage, 'PASS', 'All ten read-only tools are discoverable.');
    stage = 'athlete_profile';
    const profileCall = await client.callTool({ name: 'get_athlete_profile', arguments: {} });
    if (profileCall.isError) {
      throw new Error('Profile tool rejected.');
    }
    const { athlete } = outputs.profile.parse(profileCall.structuredContent);
    record(stage, 'PASS', 'Profile retrieved and validated; no private fields printed.');
    if (!options.athleteId || options.athleteId === '0') {
      record(
        'athlete_identity',
        'WARN',
        'Profile is available, but no explicit expected athlete ID was supplied (0 selects the API key owner). Verify identity in your authorized client.',
      );
    } else if (options.athleteId.replace(/^i/, '') !== athlete.id.replace(/^i/, '')) {
      record(
        'athlete_identity',
        'FAIL',
        'Returned identity differs from the configured athlete. Correct the instance secret before analysis.',
      );
      return rows;
    } else {
      record(
        'athlete_identity',
        'PASS',
        'Profile matches the configured athlete; identifier redacted.',
      );
    }
    if (!athlete.timezone) {
      record(
        'activities',
        'NOT_TESTED',
        'Athlete timezone unavailable; resolve it before deriving calendar ranges.',
      );
      record('analytics', 'NOT_TESTED', 'No timezone for safe completed-day ranges.');
      return rows;
    }
    const end = shiftDate(todayInTimezone(options.now ?? new Date(), athlete.timezone), -1);
    const current = { start_date: shiftDate(end, -6), end_date: end };
    const baseline = { start_date: shiftDate(end, -13), end_date: shiftDate(end, -7) };
    stage = 'activities';
    const recentCall = await client.callTool({
      name: 'get_recent_activities',
      arguments: { ...current, limit: 1, sport_type: 'running' },
    });
    if (recentCall.isError) {
      throw new Error('Activity tool rejected.');
    }
    const recent = outputs.recent.parse(recentCall.structuredContent);
    record(
      stage,
      recent.returned_count ? 'PASS' : 'WARN',
      recent.returned_count
        ? 'Activity response validated; payload withheld.'
        : 'Retrieval succeeded with no running activities returned. Empty data does not prove synchronization is complete.',
    );
    stage = 'analytics';
    const compared = await client.callTool({
      name: 'compare_training_periods',
      arguments: { current, baseline, sport_type: 'running' },
    });
    if (compared.isError) {
      throw new Error('Analytics tool rejected.');
    }
    analyticsOutputs.compare.parse(compared.structuredContent);
    record(
      stage,
      'PASS',
      'Deterministic comparison returned validated structured output. Read its quality metadata before interpretation; payload withheld.',
    );
  } catch {
    record(
      stage,
      'FAIL',
      stage === 'authenticated_initialization'
        ? 'Authorization or initialization failed. Reauthorize in your client; check token expiry, audience, scope and owner.'
        : 'The check failed or returned an invalid response. Inspect safe server error categories, credentials and deployed version.',
    );
  } finally {
    try {
      await client.close();
    } catch {
      record('connection_cleanup', 'WARN', 'Connection cleanup failed after diagnostics.');
    }
  }
  return rows;
}
