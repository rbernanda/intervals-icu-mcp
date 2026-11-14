import { validateDistribution } from './lib/distribution';

const files = await validateDistribution(process.cwd());
console.log(
  `PASS: distribution configuration, version consistency, local documentation links, publication checks and ${files} canonical skill resources.`,
);
