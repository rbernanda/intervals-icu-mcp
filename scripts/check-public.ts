import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { publicationProblems } from './lib/publication';

const requiredFiles = [
  'LICENSE',
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  '.env.example',
  '.dev.vars.example',
  '.github/workflows/ci.yml',
];
for (const path of requiredFiles) await stat(path);
const listed = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8', maxBuffer: 10_000_000 },
);
const paths = [...new Set(listed.split('\0').filter(Boolean))];
if (paths.length === 0) throw new Error('No publishable repository files found.');
const problems: string[] = [];
for (const path of paths) {
  const info = await stat(path);
  if (info.size > 5_000_000) {
    problems.push(`${path}: unexpectedly large publication file`);
    continue;
  }
  problems.push(...publicationProblems(path, await readFile(path, 'utf8')));
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `PASS: ${paths.length} publication files checked; required community files present; no detected private state, home paths or credential patterns. Review fixtures and diff before publishing.`,
  );
}
