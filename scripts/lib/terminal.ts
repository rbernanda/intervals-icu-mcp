import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

/** Prompt values never pass through the terminal output stream or process arguments. */
export function createHiddenTerminal() {
  if (!process.stdin.isTTY) throw new Error('Run setup in an interactive terminal.');
  const muted = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const terminal = createInterface({ input: process.stdin, output: muted, terminal: true });
  return {
    async ask(label: string, fallback = ''): Promise<string> {
      process.stdout.write(`${label}${fallback ? ` [${fallback}]` : ''}: `);
      const answer = await terminal.question('');
      process.stdout.write('\n');
      return answer.trim() || fallback;
    },

    close() {
      terminal.close();
    },
  };
}
