import { afterEach, describe, expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ts from 'typescript';
import { installSkill, AGENT_DIRECTORIES, skillDigest } from '../../scripts/lib/skill-install';
import { SKILL_NAME, validateSkillDirectory } from '../../scripts/lib/skill-package';
import { documentationProblems, validateDeploymentTemplate } from '../../scripts/lib/distribution';
import { VERSION } from '../../src/version';

const temporary: string[] = [];

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'portable-skills-'));
  temporary.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('project-scoped portable installation', () => {
  it.each(['codex', 'claude-code', 'cursor'] as const)(
    'installs and validates a relocatable %s package with a version receipt and safe reruns',
    async (agent) => {
      const root = await project();
      const options = { repository: process.cwd(), project: root, agent };
      expect(await installSkill(options)).toBe('installed');
      expect(await installSkill(options)).toBe('unchanged');
      const path = join(root, AGENT_DIRECTORIES[agent], SKILL_NAME);
      expect(await validateSkillDirectory(path)).toHaveLength(11);
      const receipt = JSON.parse(await readFile(`${path}.install.json`, 'utf8')) as unknown;
      expect(receipt).toEqual({
        name: SKILL_NAME,
        version: VERSION,
        sha256: await skillDigest(path),
      });
      expect(await readFile(join(path, 'references/analysis-methods.md'), 'utf8')).toContain(
        'compare_training_periods',
      );
    },
  );

  it('requires --update for a changed managed version and refuses to erase local edits', async () => {
    const root = await project();
    const source = await project();
    await mkdir(join(source, 'skills'));
    await cp(join(process.cwd(), 'skills', SKILL_NAME), join(source, 'skills', SKILL_NAME), {
      recursive: true,
    });
    const options = { repository: source, project: root, agent: 'codex' as const };
    await installSkill(options);
    const sourceFile = join(source, 'skills', SKILL_NAME, 'references/analysis-methods.md');
    await writeFile(
      sourceFile,
      (await readFile(sourceFile, 'utf8')) + '\nSynthetic distribution change.\n',
    );
    await expect(installSkill(options)).rejects.toThrow('--update');
    expect(await installSkill({ ...options, update: true })).toBe('updated');
    const installedFile = join(
      root,
      '.agents/skills',
      SKILL_NAME,
      'references/analysis-methods.md',
    );
    await writeFile(installedFile, (await readFile(installedFile, 'utf8')) + '\nLocal edits.\n');
    await expect(installSkill({ ...options, update: true })).rejects.toThrow('edited');
    expect(await readFile(installedFile, 'utf8')).toContain('Local edits.');
  });

  it('preserves unmanaged files, rejects parent symlinks and leaves canonical discovery unchanged', async () => {
    const root = await project();
    const path = join(root, '.agents/skills', SKILL_NAME);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'private.txt'), 'LOCAL-EDIT');
    await expect(
      installSkill({ repository: process.cwd(), project: root, agent: 'codex', update: true }),
    ).rejects.toThrow('unmanaged');
    expect(await readFile(join(path, 'private.txt'), 'utf8')).toBe('LOCAL-EDIT');
    const linked = await project();
    await symlink(root, join(linked, '.agents'));
    await expect(
      installSkill({ repository: process.cwd(), project: linked, agent: 'codex' }),
    ).rejects.toThrow('real directories');
    expect(
      await installSkill({ repository: process.cwd(), project: process.cwd(), agent: 'codex' }),
    ).toBe('canonical');
  });

  it('installed resources remain usable after their source repository disappears', async () => {
    const root = await project();
    const source = await project();
    await mkdir(join(source, 'skills'));
    await cp(join(process.cwd(), 'skills', SKILL_NAME), join(source, 'skills', SKILL_NAME), {
      recursive: true,
    });
    await installSkill({ repository: source, project: root, agent: 'cursor' });
    await rm(source, { recursive: true });
    expect(await validateSkillDirectory(join(root, '.cursor/skills', SKILL_NAME))).toHaveLength(11);
  });
});

describe('release distribution contracts', () => {
  it('requires fail-closed deployment defaults and rejects credential vars', async () => {
    const parsed = ts.parseConfigFileTextToJson(
      'wrangler.jsonc',
      await readFile('wrangler.jsonc', 'utf8'),
    );
    const config = parsed.config as Record<string, unknown>;
    expect(() => validateDeploymentTemplate(config)).not.toThrow();
    expect(() => validateDeploymentTemplate({ ...config, secrets: { required: [] } })).toThrow();
    expect(() =>
      validateDeploymentTemplate({
        ...config,
        vars: { INTERVALS_API_KEY: 'SYNTHETIC', OAUTH_ENABLE_DCR: 'false' },
      }),
    ).toThrow();
  });

  it('detects missing documentation targets and anchors', async () => {
    const root = await project();
    await writeFile(
      join(root, 'README.md'),
      '[valid](guide.md#setup) [bad](guide.md#absent) [missing](missing.md)',
    );
    await writeFile(join(root, 'guide.md'), '# Setup\n');
    const problems = await documentationProblems(root, ['README.md']);
    expect(problems).toHaveLength(2);
    expect(problems.join(' ')).toContain('missing.md');
  });
});
