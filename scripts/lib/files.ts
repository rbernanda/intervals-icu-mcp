import { access, writeFile } from 'node:fs/promises';
export async function assertNewFile(path: string): Promise<void> {
  try {
    await access(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(
    `${path} already exists. Edit your local configuration; setup will not overwrite it.`,
  );
}
export async function writePrivateFile(path: string, contents: string): Promise<void> {
  await writeFile(path, contents, { mode: 0o600, flag: 'wx' });
}
export function dotenvContents(values: Record<string, string>): string {
  if (Object.values(values).some((value) => /[\r\n\0]/.test(value)))
    throw new Error('Configuration values must fit on one line.');
  return (
    Object.entries(values)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join('\n') + '\n'
  );
}
