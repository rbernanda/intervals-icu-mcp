import { createHash } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { VERSION } from '../../src/version';
import { SKILL_NAME, validateSkillDirectory } from './skill-package';

export const AGENT_DIRECTORIES = {
  codex: '.agents/skills',
  'claude-code': '.claude/skills',
  cursor: '.cursor/skills',
} as const;

export type SkillAgent = keyof typeof AGENT_DIRECTORIES;

const receiptSchema = z
  .object({
    name: z.literal(SKILL_NAME),
    version: z.string(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/** Hash sorted relative paths and file bytes, independent of mtimes and checkout location. */
export async function skillDigest(directory: string): Promise<string> {
  const files = await validateSkillDirectory(directory);
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.replaceAll('\\', '/')).update('\0');
    hash.update(await readFile(join(directory, file))).update('\0');
  }
  return hash.digest('hex');
}

/** Only explicit project paths are supported. Refuse symlinked agent directories and arbitrary replacement. */
export async function installSkill(options: {
  repository: string;
  project: string;
  agent: SkillAgent;
  update?: boolean;
}): Promise<'installed' | 'updated' | 'unchanged' | 'canonical'> {
  const project = await realpath(options.project);
  if (!(await lstat(project)).isDirectory()) {
    throw new Error('The target project must be an existing directory.');
  }
  const canonical = resolve(options.repository, 'skills', SKILL_NAME);
  const digest = await skillDigest(canonical);
  const directory = AGENT_DIRECTORIES[options.agent];
  let parent = project;
  for (const segment of directory.split('/')) {
    parent = join(parent, segment);
    if (await exists(parent)) {
      const info = await lstat(parent);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new Error('Agent directories must be real directories inside the target project.');
      }
    } else {
      await mkdir(parent);
    }
  }
  const destination = join(parent, SKILL_NAME);
  const receiptPath = join(parent, `${SKILL_NAME}.install.json`);
  const installed = await exists(destination);
  if (installed && (await realpath(destination)) === (await realpath(canonical))) {
    return 'canonical';
  }
  const lockPath = join(parent, '.intervals-install.lock');
  const lock = await open(lockPath, 'wx', 0o600).catch(() => {
    throw new Error(
      'Installation is locked or not writable. Finish the other install; remove a stale .intervals-install.lock only after checking no installer is running.',
    );
  });
  try {
    if (installed) {
      if ((await lstat(destination)).isSymbolicLink() || !(await exists(receiptPath))) {
        throw new Error('An unmanaged skill already exists; move it yourself before installing.');
      }
      if ((await lstat(receiptPath)).isSymbolicLink()) {
        throw new Error('The installation receipt must not be a symlink.');
      }
      const receipt = receiptSchema.parse(
        JSON.parse(await readFile(receiptPath, 'utf8')) as unknown,
      );
      const installedDigest = await skillDigest(destination);
      if (receipt.sha256 !== installedDigest) {
        throw new Error('Installed files were edited. Back up your edits before reinstalling.');
      }
      if (installedDigest === digest && receipt.version === VERSION) {
        return 'unchanged';
      }
      if (!options.update) {
        throw new Error('A different managed version exists. Rerun with --update to replace it.');
      }
    } else if (await exists(receiptPath)) {
      throw new Error(
        'An orphan installation receipt exists; review and remove it before installing.',
      );
    }

    const stage = await mkdtemp(join(parent, '.intervals-install-'));
    const backup = join(stage, 'previous');
    try {
      const prepared = join(stage, 'skill');
      await cp(canonical, prepared, { recursive: true, errorOnExist: true });
      if ((await skillDigest(prepared)) !== digest) {
        throw new Error('Skill changed during installation. Retry from a stable checkout.');
      }
      const preparedReceipt = join(stage, 'receipt.json');
      await writeFile(
        preparedReceipt,
        JSON.stringify({ name: SKILL_NAME, version: VERSION, sha256: digest }, null, 2) + '\n',
        { mode: 0o600, flag: 'wx' },
      );
      if (installed) {
        await rename(destination, backup);
      }
      let activated = false;
      try {
        await rename(prepared, destination);
        activated = true;
        await rename(preparedReceipt, receiptPath);
      } catch (error) {
        if (activated) {
          await rm(destination, { recursive: true, force: true });
        }
        if (installed) {
          await rename(backup, destination);
        }
        throw error;
      }
      return installed ? 'updated' : 'installed';
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  } finally {
    await lock.close();
    await rm(lockPath);
  }
}
