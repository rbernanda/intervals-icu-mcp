import { parseConfig } from '../src/config/env';
import { createHiddenTerminal } from './lib/terminal';
import { assertNewFile, dotenvContents, writePrivateFile } from './lib/files';

await assertNewFile('.dev.vars');
const terminal = createHiddenTerminal();
try {
  console.log(
    'Configure this instance for its owner. Values are hidden while typing. No cloud resources are created.',
  );
  const values = {
    INTERVALS_API_KEY: await terminal.ask('Your Intervals.icu API key'),
    INTERVALS_ATHLETE_ID: await terminal.ask('Your athlete ID (0 selects the API key owner)', '0'),
    PUBLIC_ORIGIN: await terminal.ask('Local server origin', 'http://localhost:8787'),
    GITHUB_CLIENT_ID: await terminal.ask('Your development GitHub OAuth app client ID'),
    GITHUB_CLIENT_SECRET: await terminal.ask('Your development GitHub OAuth app client secret'),
    ALLOWED_GITHUB_USER_ID: await terminal.ask('Your numeric GitHub user ID'),
    ATHLETE_TIMEZONE: await terminal.ask(
      'Athlete IANA timezone',
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
    MCP_ALLOWED_ORIGINS: await terminal.ask(
      'Additional browser origins, comma-separated (optional)',
    ),
    OAUTH_ENABLE_DCR: await terminal.ask(
      'Enable legacy client registration? true or false',
      'false',
    ),
  };
  parseConfig(values);
  await writePrivateFile('.dev.vars', dotenvContents(values));
  console.log(
    'Created .dev.vars (0600, ignored by Git). Run pnpm dev. Production uses Workers Secrets.',
  );
} finally {
  terminal.close();
}
