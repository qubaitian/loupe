import { rpc } from './rpc.svelte';

export type Change = { path: string; x: string; y: string };

class Git {
  repo = $state(false);
  branch = $state('');
  files = $state<Change[]>([]);

  /** Single-letter status per path, shown in the file tree and the changes list. */
  decorations = $derived(
    new Map(this.files.map((f) => [f.path, f.x === '?' ? 'U' : f.y !== ' ' ? f.y : f.x])),
  );

  #timer: ReturnType<typeof setTimeout> | undefined;

  async refresh() {
    try {
      const s = await rpc.call<{ repo: boolean; branch?: string; files?: Change[] }>('git.status');
      this.repo = s.repo;
      this.branch = s.branch ?? '';
      this.files = s.files ?? [];
    } catch {
      // keeps the last known state; the next git.changed event retries
    }
  }

  scheduleRefresh() {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.refresh(), 250);
  }
}

export const git = new Git();

rpc.onOpen(() => git.refresh());
rpc.on('git.changed', () => git.scheduleRefresh());
