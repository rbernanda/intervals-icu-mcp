import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { z } from 'zod';
import { prepareDeployment } from './lib/deployment';
import { createHiddenTerminal } from './lib/terminal';
import { assertNewFile, writePrivateFile } from './lib/files';

await assertNewFile('wrangler.instance.jsonc');
const parsed = ts.parseConfigFileTextToJson(
  'wrangler.jsonc',
  await readFile('wrangler.jsonc', 'utf8'),
);
if (parsed.error) {
  throw new Error('Could not parse the base Wrangler configuration.');
}
const template = z.record(z.string(), z.unknown()).parse(parsed.config as unknown);
const terminal = createHiddenTerminal();
try {
  console.log(
    'Offline deployment preparation. Obtain a KV namespace ID in your own account first; this command does not create resources or deploy.',
  );
  const settings = {
    worker_name: await terminal.ask('Worker name', 'intervals-icu-mcp'),
    public_origin: await terminal.ask('Exact public HTTPS origin, without trailing slash'),
    oauth_namespace_id: await terminal.ask('Your OAUTH_KV namespace ID'),
    github_client_id: await terminal.ask('Your production GitHub OAuth app client ID'),
    owner_github_id: await terminal.ask('Your numeric GitHub user ID'),
    timezone: await terminal.ask(
      'Athlete IANA timezone',
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
    allowed_origins: await terminal.ask('Additional browser origins, comma-separated (optional)'),
    enable_dcr: await terminal.ask('Enable legacy client registration? true or false', 'false'),
  };
  if (!['true', 'false'].includes(settings.enable_dcr)) {
    throw new Error('Enter true or false for client registration.');
  }
  const config = prepareDeployment(
    { ...settings, enable_dcr: settings.enable_dcr === 'true' },
    template,
  );
  await writePrivateFile('wrangler.instance.jsonc', JSON.stringify(config, null, 2) + '\n');
  console.log('Prepared wrangler.instance.jsonc (ignored by Git). Source code is unchanged.');
  console.log(
    'Next, use hidden Wrangler secret prompts for INTERVALS_API_KEY, INTERVALS_ATHLETE_ID and GITHUB_CLIENT_SECRET with --config wrangler.instance.jsonc.',
  );
  console.log(
    'Review with pnpm build:instance. Deploy only when authorized, using pnpm deploy:instance.',
  );
} finally {
  terminal.close();
}
