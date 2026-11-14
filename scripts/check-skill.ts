import { validateSkillPackage } from './lib/skill-package';

const files = await validateSkillPackage(process.cwd());
console.log(
  `PASS: ${files.length} skill files; valid metadata, resources, links and Codex discovery.`,
);
