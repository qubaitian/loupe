<script lang="ts">
  import { rpc } from '../lib/rpc.svelte';
  import { basename, dirname, wb } from '../lib/workbench.svelte';

  let query = $state('');
  let files = $state<string[]>([]);
  let selected = $state(0);
  let input = $state<HTMLInputElement>();
  let stale = true;

  rpc.on('fs.changed', () => (stale = true));

  /** Subsequence match; rewards consecutive hits, word starts and hits in the basename. */
  function score(q: string, s: string): number {
    const base = s.lastIndexOf('/') + 1;
    let qi = 0;
    let total = 0;
    let last = -2;
    for (let i = 0; i < s.length && qi < q.length; i++) {
      if (s[i] !== q[qi]) continue;
      const prev = s[i - 1];
      total += 1;
      if (i === last + 1) total += 5;
      if (i >= base) total += 2;
      if (i === 0 || prev === '/' || prev === '-' || prev === '_' || prev === '.') total += 3;
      last = i;
      qi++;
    }
    return qi === q.length ? total - s.length * 0.01 : -1;
  }

  const results = $derived.by(() => {
    const q = query.toLowerCase().replace(/\s+/g, '');
    if (!q) return files.slice(0, 50);
    const scored: [string, number][] = [];
    for (const f of files) {
      const s = score(q, f.toLowerCase());
      if (s >= 0) scored.push([f, s]);
    }
    return scored
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([f]) => f);
  });

  $effect(() => {
    void results;
    selected = 0;
  });

  $effect(() => {
    if (!wb.quickOpen) return;
    query = '';
    input?.focus();
    if (stale) {
      stale = false;
      rpc.call<string[]>('search.files').then((f) => (files = f), () => (stale = true));
    }
  });

  function pick(path: string | undefined) {
    if (!path) return;
    wb.quickOpen = false;
    wb.open(path);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') wb.quickOpen = false;
    else if (e.key === 'Enter') pick(results[selected]);
    else if (e.key === 'ArrowDown') selected = Math.min(results.length - 1, selected + 1);
    else if (e.key === 'ArrowUp') selected = Math.max(0, selected - 1);
    else return;
    e.preventDefault();
  }
</script>

{#if wb.quickOpen}
  <div class="backdrop" role="presentation" onclick={() => (wb.quickOpen = false)}></div>
  <div class="palette">
    <input bind:this={input} bind:value={query} {onkeydown} placeholder="Search files by name" spellcheck="false" />
    <div class="results">
      {#each results as path, i (path)}
        <button class="result" class:selected={i === selected} onmousemove={() => (selected = i)} onclick={() => pick(path)}>
          <span>{basename(path)}</span>
          <span class="dir">{dirname(path)}</span>
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 10;
  }
  .palette {
    position: fixed;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    width: min(600px, 90vw);
    z-index: 11;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    padding: 6px;
  }
  input {
    width: 100%;
  }
  .results {
    max-height: 60vh;
    overflow: auto;
    margin-top: 4px;
  }
  .result {
    display: flex;
    gap: 8px;
    align-items: baseline;
    width: 100%;
    padding: 3px 8px;
    border-radius: 3px;
    text-align: left;
    white-space: nowrap;
  }
  .result.selected {
    background: var(--bg-active);
  }
  .dir {
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--fg-dim);
    font-size: 12px;
  }
</style>
