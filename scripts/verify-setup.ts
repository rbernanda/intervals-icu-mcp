import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { AGENT_DIRECTORIES, exists } from './lib/skill-install';
import { SKILL_NAME, validateSkillDirectory, validateSkillPackage } from './lib/skill-package';
import { configurationDiagnostics, endpointDiagnostics, type Diagnostic } from './lib/doctor';
import { z } from 'zod';

const results: Diagnostic[] = [];
try {
  const { values } = parseArgs({
    options: {
      config: { type: 'string' },
      url: { type: 'string' },
      'token-file': { type: 'string' },
      project: { type: 'string' },
      agent: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'pnpm run doctor [--config <local-dotenv>] [--url <https://origin/mcp> [--token-file <private-file>]] [--agent codex|claude-code|cursor --project <project>]',
    );
  } else {
    const root = process.cwd();
    try {
      await validateSkillPackage(root);
      results.push({
        check: 'canonical_skill',
        status: 'PASS',
        message: 'Metadata, references, templates and canonical discovery are valid.',
      });
    } catch {
      results.push({
        check: 'canonical_skill',
        status: 'FAIL',
        message: 'Run pnpm check:skill to locate missing resources or broken discovery.',
      });
    }
    let config: Record<string, string> = {};
    const path = values.config ?? '.dev.vars';
    if (await exists(path)) {
      if ((await lstat(path)).size > 64000) {
        throw new Error('Local configuration file is too large.');
      }
      config = z.record(z.string(), z.string()).parse(parseEnv(await readFile(path, 'utf8')));
      results.push(...configurationDiagnostics(config));
      if (process.platform !== 'win32' && ((await lstat(path)).mode & 0o077) !== 0) {
        results.push({
          check: 'configuration_permissions',
          status: 'WARN',
          message: 'Make your local configuration readable only by its owner (chmod 600).',
        });
      }
    } else {
      results.push({
        check: 'local_configuration',
        status: values.config ? 'FAIL' : 'NOT_TESTED',
        message:
          'Local configuration absent. Use pnpm setup:local if running locally; deployed instances do not require a local credential copy.',
      });
    }
    if (values.agent || values.project) {
      const agent = z.enum(['codex', 'claude-code', 'cursor']).parse(values.agent);
      const project = z.string().min(1).parse(values.project);
      try {
        await validateSkillDirectory(resolve(project, AGENT_DIRECTORIES[agent], SKILL_NAME));
        results.push({
          check: 'installed_skill',
          status: 'PASS',
          message:
            'Installed skill resources validate. Verify discovery and invocation in the client separately.',
        });
      } catch {
        results.push({
          check: 'installed_skill',
          status: 'FAIL',
          message:
            'Skill missing, incomplete or not a copy. Run the installer in the selected project; canonical checkout links are checked separately.',
        });
      }
    }
    if (values.url) {
      let token: string | undefined;
      if (values['token-file']) {
        const info = await lstat(values['token-file']);
        if (
          !info.isFile() ||
          info.size > 16000 ||
          (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
        ) {
          throw new Error(
            'Token must be a regular private file (chmod 600), no larger than 16 KB.',
          );
        }
        token = (await readFile(values['token-file'], 'utf8')).trim();
        if (!token) {
          throw new Error('Token file is empty.');
        }
      }
      results.push(
        ...(await endpointDiagnostics({
          url: values.url,
          token,
          athleteId: config.INTERVALS_ATHLETE_ID,
        })),
      );
    } else {
      if (values['token-file']) {
        throw new Error('Specify --url when supplying a token file.');
      }
      results.push({
        check: 'remote_connection',
        status: 'NOT_TESTED',
        message: 'Offline mode. Supply --url to check an endpoint; no requests were sent.',
      });
    }
  }
} catch {
  results.push({
    check: 'diagnostic_arguments_or_files',
    status: 'FAIL',
    message:
      'Check arguments, file permissions and formats. Run pnpm run doctor --help. Sensitive values and raw errors are suppressed.',
  });
}
for (const row of results) {
  console.log(`${row.status}: ${row.check}: ${row.message}`);
}
if (results.some((row) => row.status === 'FAIL')) {
  process.exitCode = 1;
}
