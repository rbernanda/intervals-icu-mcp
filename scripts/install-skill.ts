import { parseArgs } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { installSkill } from './lib/skill-install';
import { VERSION } from '../src/version';

try {
  const { values } = parseArgs({
    options: {
      agent: { type: 'string' },
      project: { type: 'string' },
      update: { type: 'boolean', default: false },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'pnpm skill:install --agent codex|claude-code|cursor --project <existing-project> [--update]',
    );
  } else {
    const agent = z.enum(['codex', 'claude-code', 'cursor']).parse(values.agent);
    const project = z.string().min(1).parse(values.project);
    const outcome = await installSkill({
      repository: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
      project,
      agent,
      update: values.update,
    });
    console.log(
      `PASS: skill ${outcome}; repository version ${VERSION}. MCP connection and client activation are separate checks.`,
    );
  }
} catch (error) {
  console.error(
    error instanceof Error && !(error instanceof z.ZodError)
      ? error.message
      : 'Specify --agent codex|claude-code|cursor and --project <existing-project>.',
  );
  process.exitCode = 1;
}
