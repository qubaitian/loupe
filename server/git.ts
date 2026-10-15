import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Hub } from './hub.ts';
import type { Workspace } from './workspace.ts';

export type Change = { path: string; x: string; y: string };

export function registerGit(hub: Hub, ws: Workspace) {
  // GIT_OPTIONAL_LOCKS=0 stops `git status` from rewriting .git/index, which would
  // trigger the file watcher and cause an endless refresh loop.
  const git = (args: string[]) =>
    new Promise<string>((resolve, reject) => {
      execFile(
        'git',
        args,
        { cwd: ws.root, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
        (err, stdout, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout)),
      );
    });

  hub.on('git.status', async () => {
    let top: string;
    try {
      top = fs.realpathSync((await git(['rev-parse', '--show-toplevel'])).trim());
    } catch {
      return { repo: false };
    }
    // Porcelain paths are relative to the repo root, which may sit above the workspace.
    const prefix = path.relative(top, ws.root).split(path.sep).join('/');
    const strip = (p: string) => (prefix ? (p.startsWith(prefix + '/') ? p.slice(prefix.length + 1) : null) : p);

    const [branch, out] = await Promise.all([
      git(['branch', '--show-current']).then((b) => b.trim() || git(['rev-parse', '--short', 'HEAD']).then((s) => s.trim())),
      git(['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    ]);

    const files: Change[] = [];
    const parts = out.split('\0');
    for (let i = 0; i < parts.length; i++) {
      const entry = parts[i];
      if (!entry) continue;
      const x = entry[0];
      const y = entry[1];
      if (x === 'R' || x === 'C') i++;
      const p = strip(entry.slice(3));
      if (p) files.push({ path: p, x, y });
    }
    return { repo: true, branch, files };
  });

  hub.on('git.head', async ({ path: rel }: { path: string }) => {
    ws.resolve(rel);
    return git(['show', `HEAD:./${rel}`]).catch(() => '');
  });
}
