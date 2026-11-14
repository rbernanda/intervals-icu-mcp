/** Heuristic release checks complement code review; arbitrary secret formats cannot all be detected. */
export function publicationProblems(path: string, contents: string): string[] {
  const problems: string[] = [];
  const normalized = path.replaceAll('\\', '/');
  if (
    (/(^|\/)(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?)$/.test(normalized) &&
      !normalized.endsWith('.example')) ||
    /(^|\/)wrangler\.instance\.jsonc$/.test(normalized) ||
    /(^|\/)(?:\.wrangler|node_modules|\.pnpm-store|dist|coverage)\//.test(normalized)
  ) {
    problems.push('private configuration or generated state included');
  }
  if (/\/(?:Users|home)\/[A-Za-z0-9_.-]+\//.test(contents)) {
    problems.push('machine-specific home path included');
  }
  if (/gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/.test(contents)) {
    problems.push('possible GitHub credential included');
  }
  if (/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(contents)) {
    problems.push('private key included');
  }
  return problems.map((problem) => `${path}: ${problem}`);
}

/** Only reviewed discovery links may bypass reading a regular publication file. */
export function publicationSymlinkProblems(path: string, target: string): string[] {
  return [
    '.agents/skills/intervals-training-analyst',
    '.claude/skills/intervals-training-analyst',
  ].includes(path) && target === '../../skills/intervals-training-analyst'
    ? []
    : [`${path}: unsupported publication symlink; do not alias private or generated state`];
}
