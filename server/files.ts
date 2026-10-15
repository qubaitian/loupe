import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Hub } from './hub.ts';
import type { Workspace } from './workspace.ts';

const HIDDEN = new Set(['.git', '.DS_Store']);
const MAX_READ = 10 * 1024 * 1024;
const MAX_BATCH = 2000;

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const isGitPath = (p: string) => p === '.git' || p.startsWith('.git/');
const hash = (buf: Buffer) => createHash('sha1').update(buf).digest('hex');

export function registerFiles(hub: Hub, ws: Workspace) {
  hub.on('fs.list', async ({ path: rel = '' }: { path?: string }) => {
    const dir = ws.resolve(rel);
    const dirents = await fsp.readdir(dir, { withFileTypes: true });
    const entries = await Promise.all(
      dirents
        .filter((d) => !HIDDEN.has(d.name))
        .map(async (d) => {
          let isDir = d.isDirectory();
          if (d.isSymbolicLink()) {
            isDir = await fsp.stat(path.join(dir, d.name)).then((s) => s.isDirectory(), () => false);
          }
          return { name: d.name, path: join(rel, d.name), dir: isDir };
        }),
    );
    return entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  });

  hub.on('fs.read', async ({ path: rel }: { path: string }) => {
    const file = ws.resolve(rel);
    const stat = await fsp.stat(file);
    if (stat.size > MAX_READ) return { tooLarge: true };
    const buf = await fsp.readFile(file);
    if (buf.subarray(0, 8000).includes(0)) return { binary: true };
    return { content: buf.toString('utf8'), hash: hash(buf) };
  });

  /** With `expect`, refuses to write unless the file on disk still has that hash. */
  hub.on('fs.write', async ({ path: rel, content, expect }: { path: string; content: string; expect?: string }) => {
    const file = ws.resolve(rel);
    if (expect !== undefined) {
      const current = await fsp.readFile(file).then(hash, () => undefined);
      if (current !== expect) return { conflict: true };
    }
    const buf = Buffer.from(content, 'utf8');
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, buf);
    return { hash: hash(buf) };
  });

  hub.on('fs.delete', async ({ path: rel }: { path: string }) => {
    if (typeof rel !== 'string' || !rel) throw new Error('A file or folder path is required.');
    const target = ws.resolve(rel);
    if (target === ws.root) throw new Error('Cannot delete the workspace root.');
    // Resolve the parent, keeping the final symlink itself as the deletion target.
    const parent = await fsp.realpath(path.dirname(target));
    const file = ws.resolve(ws.relative(path.join(parent, path.basename(target))));
    if (isGitPath(ws.relative(file))) throw new Error('Cannot delete Git metadata.');
    await fsp.rm(file, { recursive: true });
    hub.emit('fs.changed', { paths: [ws.relative(target)], all: true });
    hub.emit('git.changed', {});
  });

  return watch(hub, ws);
}

function watch(hub: Hub, ws: Workspace) {
  const pending = new Set<string>();
  let timer: NodeJS.Timeout | undefined;

  const flush = () => {
    timer = undefined;
    const paths = [...pending];
    pending.clear();
    const files = paths.filter((p) => !isGitPath(p));
    if (files.length > MAX_BATCH) hub.emit('fs.changed', { all: true, paths: [] });
    else if (files.length) hub.emit('fs.changed', { paths: files });
    hub.emit('git.changed', {});
  };

  const watcher = fs.watch(ws.root, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    pending.add(filename.split(path.sep).join('/'));
    timer ??= setTimeout(flush, 100);
  });

  return () => {
    watcher.close();
    clearTimeout(timer);
  };
}
