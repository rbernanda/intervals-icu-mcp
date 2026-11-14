import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copySourceSnapshot } from './lib/distribution';

const directory = await mkdtemp(join(tmpdir(), 'intervals-fresh-'));
try {
  await copySourceSnapshot(process.cwd(), directory);
  // Git metadata is deliberately regenerated. Dependency caches may be reused; local files may not.
  await promisify(execFile)('git', ['init', '--initial-branch=main'], { cwd: directory });

  const run = async (args: string[]): Promise<void> => {
    console.log(`Checking fresh pnpm ${args.join(' ')} ...`);
    const result = await promisify(execFile)('pnpm', args, {
      cwd: directory,
      timeout: 300000,
      maxBuffer: 5_000_000,
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: 'false',
        WRANGLER_LOG_PATH: join(directory, '.wrangler/logs'),
        CI: 'true',
      },
    });
    console.log(
      `PASS: fresh pnpm ${args.join(' ')} (${result.stdout.includes('passed') ? 'tests executed' : 'completed'}).`,
    );
  };

  await run(['install', '--frozen-lockfile']);
  await run(['check']);
  await run(['types:portable']);
  await run(['verify:runtime']);
  const project = join(directory, 'independent-project');
  await mkdir(project);
  await promisify(execFile)('git', ['init', '--initial-branch=main'], { cwd: project });
  for (const agent of ['codex', 'claude-code', 'cursor']) {
    await run(['skill:install', '--agent', agent, '--project', project]);
    await run(['run', 'doctor', '--agent', agent, '--project', project]);
  }
  console.log(
    'PASS: clean source installation, checks, build, synthetic protocol and three relocated skill installations. Live account/client behavior NOT_TESTED.',
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
