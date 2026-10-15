import { spawn } from 'node:child_process';
import readline from 'node:readline';
import type { Hub } from './hub.ts';
import type { Workspace } from './workspace.ts';

const MAX_MATCHES = 2000;
const MAX_FILES = 50000;
const MAX_LINE = 300;

const stripDot = (p: string) => (p.startsWith('./') ? p.slice(2) : p);

/** Runs ripgrep and feeds stdout lines to `onLine` until it returns false. */
function rg(cwd: string, args: string[], onLine: (line: string) => boolean | void) {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn('rg', [...args, '.'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('error', reject);
    const lines = readline.createInterface({ input: proc.stdout });
    lines.on('line', (line) => {
      if (onLine(line) === false) proc.kill();
    });
    proc.on('close', (code, signal) => {
      // rg exits 1 when nothing matched.
      if (code === 0 || code === 1 || signal) resolve();
      else reject(new Error(stderr.trim() || `rg exited with ${code}`));
    });
  });
}

export function registerSearch(hub: Hub, ws: Workspace) {
  hub.on('search.files', async () => {
    const files: string[] = [];
    await rg(ws.root, ['--files', '--hidden', '-g', '!.git'], (line) => {
      files.push(stripDot(line));
      return files.length < MAX_FILES;
    });
    return files;
  });

  hub.on(
    'search.text',
    async ({ query, regex = false, caseSensitive = false }: { query: string; regex?: boolean; caseSensitive?: boolean }) => {
      if (!query) return { matches: [], truncated: false };
      const args = ['--json', '--hidden', '-g', '!.git', caseSensitive ? '-s' : '--smart-case'];
      if (!regex) args.push('-F');
      args.push('-e', query);

      const matches: { path: string; line: number; column: number; text: string }[] = [];
      let truncated = false;
      await rg(ws.root, args, (raw) => {
        const msg = JSON.parse(raw);
        if (msg.type !== 'match') return;
        const { path, lines, line_number, submatches } = msg.data;
        if (!path.text || !lines.text) return;
        const text: string = lines.text.replace(/\r?\n$/, '');
        matches.push({
          path: stripDot(path.text),
          line: line_number,
          column: (submatches[0]?.start ?? 0) + 1,
          text: text.length > MAX_LINE ? text.slice(0, MAX_LINE) + '…' : text,
        });
        if (matches.length >= MAX_MATCHES) {
          truncated = true;
          return false;
        }
      });
      return { matches, truncated };
    },
  );
}
