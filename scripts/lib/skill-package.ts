import { readFile, readdir, realpath, lstat } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { publicationProblems } from './publication';

export const SKILL_NAME = 'intervals-training-analyst';

export const skillMetadataSchema = z
  .object({
    name: z.literal(SKILL_NAME),
    description: z.string().trim().min(1).max(1024),
    license: z.literal('MIT'),
  })
  .strict();

/** YAML parsing is shared by CI and package tests; errors must not be silently coerced. */
export function parseSkillMetadata(markdown: string): z.infer<typeof skillMetadataSchema> {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown)?.[1];
  if (!frontmatter) {
    throw new Error('Missing SKILL.md YAML frontmatter.');
  }

  const document = parseDocument(frontmatter, { uniqueKeys: true });
  if (document.errors.length) {
    throw new Error('Invalid or duplicate SKILL.md YAML fields.');
  }

  return skillMetadataSchema.parse(document.toJS() as unknown);
}

/** Walk the canonical package only; do not follow arbitrary nested symlinks into private files. */
async function packageFiles(root: string, directory = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error('Canonical skill resources must not be symlinks.');
    }

    if (entry.isDirectory()) {
      files.push(...(await packageFiles(root, path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }

  return files;
}

/** Validates relocatable resources and discovery without requiring a client, network or credentials. */
export async function validateSkillPackage(repositoryRoot: string): Promise<string[]> {
  const canonical = resolve(repositoryRoot, 'skills', SKILL_NAME);
  if ((await lstat(canonical)).isSymbolicLink()) {
    throw new Error('The canonical skill folder must not be a symlink.');
  }

  const root = await realpath(canonical);
  const files = await packageFiles(root);
  const markdown = await readFile(resolve(root, 'SKILL.md'), 'utf8');
  parseSkillMetadata(markdown);

  const required = [
    'SKILL.md',
    'agents/openai.yaml',
    ...[
      'metric-definitions',
      'analysis-methods',
      'mcp-tool-mapping',
      'interpretation-guardrails',
    ].map((name) => `references/${name}.md`),
    ...['workout-review', 'weekly-review', 'performance-trend', 'race-readiness'].map(
      (name) => `assets/templates/${name}.md`,
    ),
  ];
  for (const path of required) {
    if (!files.includes(resolve(root, path))) {
      throw new Error(`Missing skill resource: ${path}`);
    }
  }

  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const problems = publicationProblems(relative(repositoryRoot, file), content);
    if (problems.length) {
      throw new Error(problems.join('\n'));
    }

    if (!file.endsWith('.md')) {
      continue;
    }

    for (const link of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = link[1]!;
      if (target.startsWith('https://')) {
        continue;
      }

      const [path, fragment] = target.split('#');
      const destination = resolve(dirname(file), path || '.');
      const resource = path ? destination : file;
      const resolved = await realpath(resource);
      const within = relative(root, resolved);
      if (within.startsWith('..') || isAbsolute(within)) {
        throw new Error(`Skill link escapes its distributable package: ${target}`);
      }

      if (fragment) {
        const contents = await readFile(resource, 'utf8');
        const anchors = [...contents.matchAll(/^#+\s+(.+)$/gm)].map((heading) =>
          heading[1]!
            .toLowerCase()
            .replace(/[^\p{L}\p{N}_\-\s]/gu, '')
            .replace(/\s/g, '-'),
        );
        if (!anchors.includes(fragment)) {
          throw new Error(`Broken skill heading link: ${target}`);
        }
      }
    }
  }

  const discovery = resolve(repositoryRoot, '.agents/skills', SKILL_NAME);
  if ((await realpath(discovery)) !== (await realpath(root))) {
    throw new Error('Codex discovery must resolve to the canonical skill.');
  }

  const metadata = parseDocument(await readFile(resolve(root, 'agents/openai.yaml'), 'utf8'));
  if (metadata.errors.length) {
    throw new Error('Invalid Codex UI metadata.');
  }

  z.object({
    interface: z.object({
      display_name: z.string().min(1),
      short_description: z.string().min(25).max(64),
      default_prompt: z.string().includes(`$${SKILL_NAME}`),
    }),
    policy: z.object({ allow_implicit_invocation: z.literal(true) }),
  }).parse(metadata.toJS() as unknown);

  return files.map((file) => relative(root, file)).sort();
}
