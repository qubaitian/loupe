import fs from 'node:fs';
import path from 'node:path';

export class Workspace {
  readonly root: string;
  readonly name: string;

  constructor(dir: string) {
    this.root = fs.realpathSync(path.resolve(dir));
    if (!fs.statSync(this.resolve()).isDirectory()) throw new Error(`not a directory: ${dir}`);
    this.name = path.basename(this.root);
  }

  /** Resolves a workspace-relative path, refusing anything that escapes the root. */
  resolve(rel = ''): string {
    const abs = path.resolve(this.root, rel);
    const prefix = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (abs !== this.root && !abs.startsWith(prefix)) {
      throw new Error(`path outside workspace: ${rel}`);
    }
    return abs;
  }

  relative(abs: string): string {
    return path.relative(this.root, abs).split(path.sep).join('/');
  }
}
