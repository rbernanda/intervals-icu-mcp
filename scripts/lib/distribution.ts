import { execFileSync } from 'node:child_process';
import { cp, lstat, mkdir, readFile, realpath, readlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { z } from 'zod';
import { VERSION } from '../../src/version';
import { parseConfig } from '../../src/config/env';
import { INSTANCE_SECRETS } from './deployment';
import { publicationProblems, publicationSymlinkProblems } from './publication';
import { SKILL_NAME, validateSkillPackage, parseSkillMetadata } from './skill-package';

/** Include new source files while excluding ignored instance files, build products and credentials. */
export function sourceFiles(repository: string): string[] {
  return [
    ...new Set(
      execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
        cwd: repository,
        encoding: 'utf8',
        maxBuffer: 10_000_000,
      })
        .split('\0')
        .filter(Boolean),
    ),
  ].sort();
}

/** Static deployment readiness only: a KV ID and production secrets must still be supplied by the owner. */
export function validateDeploymentTemplate(input: unknown): void {
  const config = z
    .object({
      main: z.literal('src/index.ts'),
      compatibility_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      kv_namespaces: z.array(z.object({ binding: z.literal('OAUTH_KV') })).length(1),
      vars: z.record(z.string(), z.unknown()),
      secrets: z.object({ required: z.array(z.string()) }),
    })
    .parse(input);
  const required = [
    ...INSTANCE_SECRETS,
    'PUBLIC_ORIGIN',
    'GITHUB_CLIENT_ID',
    'ALLOWED_GITHUB_USER_ID',
    'ATHLETE_TIMEZONE',
  ];
  if (
    required.some((name) => !config.secrets.required.includes(name)) ||
    INSTANCE_SECRETS.some((name) => name in config.vars) ||
    config.vars.OAUTH_ENABLE_DCR !== 'false' ||
    config.vars.MCP_ALLOWED_ORIGINS !== ''
  ) {
    throw new Error(
      'Deployment template must require configuration, keep credentials out of vars and disable DCR by default.',
    );
  }
  let rejected = false;
  try {
    parseConfig(config.vars);
  } catch {
    rejected = true;
  }
  if (!rejected) {
    throw new Error('Unconfigured deployment must fail closed.');
  }
}

/** Validate local Markdown destinations and headings without network-dependent external link checks. */
export async function documentationProblems(root: string, files: string[]): Promise<string[]> {
  root = await realpath(root);
  const problems: string[] = [];
  for (const file of files.filter((name) => name.endsWith('.md'))) {
    const text = await readFile(resolve(root, file), 'utf8');
    for (const link of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = link[1]!;
      if (/^(?:https?:|mailto:)/.test(target)) {
        continue;
      }
      const [path, fragment] = target.split('#');
      const destination = path
        ? resolve(dirname(resolve(root, file)), decodeURIComponent(path))
        : resolve(root, file);
      try {
        const resolved = await realpath(destination);
        const within = relative(root, resolved);
        if (within.startsWith('..') || isAbsolute(within)) {
          throw new Error('External local path');
        }
        if (fragment && destination.endsWith('.md')) {
          const contents = await readFile(destination, 'utf8');
          const anchors = [...contents.matchAll(/^#+\s+(.+)$/gm)].map((heading) =>
            heading[1]!
              .toLowerCase()
              .replace(/[^\p{L}\p{N}_\-\s]/gu, '')
              .replace(/\s/g, '-'),
          );
          if (!anchors.includes(fragment)) {
            throw new Error('Unknown heading');
          }
        }
      } catch {
        problems.push(`${file}: broken or escaping documentation link ${target}`);
      }
    }
  }
  return problems;
}

export async function validateDistribution(root: string): Promise<number> {
  const files = sourceFiles(root);
  for (const file of [
    'LICENSE',
    'CHANGELOG.md',
    'README.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'docs/releases.md',
    'docs/compatibility.md',
    '.env.example',
    '.dev.vars.example',
    '.github/workflows/ci.yml',
  ]) {
    if (!files.includes(file)) {
      throw new Error(`Missing distribution file: ${file}`);
    }
  }
  const pkg = z
    .object({ version: z.literal(VERSION), license: z.literal('MIT'), private: z.literal(true) })
    .parse(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as unknown);
  const skillFiles = await validateSkillPackage(root);
  const skill = await readFile(join(root, 'skills', SKILL_NAME, 'SKILL.md'), 'utf8');
  const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8');
  if (
    parseSkillMetadata(skill).metadata?.version !== pkg.version ||
    !changelog.includes(`## [${VERSION}]`)
  ) {
    throw new Error(
      'Package, server, skill metadata and changelog must use one repository version.',
    );
  }
  if (
    (await readFile(join(root, 'LICENSE'), 'utf8')) !==
    (await readFile(join(root, 'skills', SKILL_NAME, 'LICENSE'), 'utf8'))
  ) {
    throw new Error('Portable skill must retain the repository MIT license.');
  }
  const parsed = ts.parseConfigFileTextToJson(
    'wrangler.jsonc',
    await readFile(join(root, 'wrangler.jsonc'), 'utf8'),
  );
  if (parsed.error) {
    throw new Error('Invalid Wrangler configuration.');
  }
  validateDeploymentTemplate(parsed.config as unknown);
  const problems = await documentationProblems(root, files);
  for (const file of files) {
    const path = resolve(root, file);
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      problems.push(...publicationSymlinkProblems(file, await readlink(path)));
    } else {
      problems.push(...publicationProblems(file, await readFile(path, 'utf8')));
    }
  }
  if (problems.length) {
    throw new Error(problems.join('\n'));
  }
  return skillFiles.length;
}

/** Copy only publishable source. Hidden local state must never be required by a fresh install. */
export async function copySourceSnapshot(repository: string, destination: string): Promise<void> {
  for (const file of sourceFiles(repository)) {
    const target = resolve(destination, file);
    await mkdir(dirname(target), { recursive: true });
    await cp(resolve(repository, file), target, { verbatimSymlinks: true });
  }
  await writeFile(
    join(destination, '.fresh-install'),
    'Synthetic validation workspace; no owner configuration copied.\n',
  );
}
