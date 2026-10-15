import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { rpc } from './rpc.svelte';
import { dirname } from './workbench.svelte';

export type Entry = { name: string; path: string; dir: boolean };
export type Row = Entry & { depth: number };

class Tree {
  children = new SvelteMap<string, Entry[]>();
  expanded = new SvelteSet<string>();

  rows = $derived.by(() => {
    const out: Row[] = [];
    const walk = (dir: string, depth: number) => {
      for (const e of this.children.get(dir) ?? []) {
        out.push({ ...e, depth });
        if (e.dir && this.expanded.has(e.path)) walk(e.path, depth + 1);
      }
    };
    walk('', 0);
    return out;
  });

  async load(dir: string) {
    try {
      this.children.set(dir, await rpc.call<Entry[]>('fs.list', { path: dir }));
    } catch {
      this.children.delete(dir);
      this.expanded.delete(dir);
    }
  }

  async toggle(dir: string) {
    if (this.expanded.has(dir)) {
      this.expanded.delete(dir);
      return;
    }
    this.expanded.add(dir);
    if (!this.children.has(dir)) await this.load(dir);
  }

  refresh(paths: string[], all = false) {
    const dirs = new Set<string>();
    if (all) dirs.add('');
    if (all) for (const d of this.children.keys()) dirs.add(d);
    for (const p of paths) {
      dirs.add(dirname(p));
      dirs.add(p);
    }
    for (const d of dirs) if (d === '' || this.children.has(d)) void this.load(d);
  }
}

export const tree = new Tree();

rpc.onOpen(() => tree.refresh([], true));
rpc.on('fs.changed', ({ paths, all }: { paths: string[]; all?: boolean }) => tree.refresh(paths, all));
