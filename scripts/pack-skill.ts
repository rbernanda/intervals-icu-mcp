import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { VERSION } from '../src/version';
import { SKILL_NAME, validateSkillDirectory } from './lib/skill-package';
import { exists, skillDigest } from './lib/skill-install';
import { validateDistribution } from './lib/distribution';

await validateDistribution(process.cwd());
const output = resolve('.release', `${SKILL_NAME}-${VERSION}.tar.gz`);
if (await exists(output)) {
  throw new Error('Artifact already exists. Review/remove it before rebuilding.');
}
const directory = await mkdtemp(join(tmpdir(), 'intervals-skill-package-'));
try {
  const skill = join(directory, SKILL_NAME);
  await cp(resolve('skills', SKILL_NAME), skill, { recursive: true });
  await cp('LICENSE', join(skill, 'LICENSE'));
  const payloadDigest = await skillDigest(skill);
  const manifest =
    JSON.stringify({ name: SKILL_NAME, version: VERSION, content_sha256: payloadDigest }, null, 2) +
    '\n';
  await writeFile(join(skill, 'distribution.json'), manifest);
  await validateSkillDirectory(skill);
  await mkdir('.release', { recursive: true });
  execFileSync('tar', ['-czf', output, '-C', directory, SKILL_NAME], { stdio: 'pipe' });
  const checksum = createHash('sha256')
    .update(await readFile(output))
    .digest('hex');
  await writeFile(`${output}.sha256`, `${checksum}  ${SKILL_NAME}-${VERSION}.tar.gz\n`);
  const extracted = join(directory, 'extracted');
  await mkdir(extracted);
  execFileSync('tar', ['-xzf', output, '-C', extracted], { stdio: 'pipe' });
  const extractedSkill = join(extracted, SKILL_NAME);
  await validateSkillDirectory(extractedSkill);
  if ((await readFile(join(extractedSkill, 'distribution.json'), 'utf8')) !== manifest) {
    throw new Error('Extracted version manifest differs from the prepared manifest.');
  }
  // The manifest describes the skill payload, excluding itself. Remove only the temporary extracted copy.
  await rm(join(extractedSkill, 'distribution.json'));
  if ((await skillDigest(extractedSkill)) !== payloadDigest) {
    throw new Error('Extracted skill checksum does not match the payload manifest.');
  }
  console.log(
    `PASS: .release/${SKILL_NAME}-${VERSION}.tar.gz and SHA-256 checksum; extracted resources validate. No publication performed.`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
