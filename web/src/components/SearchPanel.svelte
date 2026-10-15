<script lang="ts">
  import { rpc } from '../lib/rpc.svelte';
  import { basename, dirname, wb } from '../lib/workbench.svelte';

  type Match = { path: string; line: number; column: number; text: string };

  let query = $state('');
  let regex = $state(false);
  let caseSensitive = $state(false);
  let matches = $state<Match[]>([]);
  let truncated = $state(false);
  let error = $state('');
  let input: HTMLInputElement;
  let seq = 0;

  const groups = $derived.by(() => {
    const map = new Map<string, Match[]>();
    for (const m of matches) {
      let list = map.get(m.path);
      if (!list) map.set(m.path, (list = []));
      list.push(m);
    }
    return [...map];
  });

  $effect(() => {
    if (wb.searchFocus) {
      input?.focus();
      input?.select();
    }
  });

  $effect(() => {
    const params = { query, regex, caseSensitive };
    const id = ++seq;
    if (!query) {
      matches = [];
      error = '';
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const r = await rpc.call<{ matches: Match[]; truncated: boolean }>('search.text', params);
        if (id !== seq) return;
        matches = r.matches;
        truncated = r.truncated;
        error = '';
      } catch (e) {
        if (id === seq) error = (e as Error).message;
      }
    }, 250);
    return () => clearTimeout(timer);
  });
</script>

<div class="header">Search</div>
<div class="form">
  <div class="field">
    <input bind:this={input} bind:value={query} placeholder="Search" spellcheck="false" />
    <button class="toggle" class:on={caseSensitive} title="Match Case" onclick={() => (caseSensitive = !caseSensitive)}>Aa</button>
    <button class="toggle" class:on={regex} title="Use Regular Expression" onclick={() => (regex = !regex)}>.*</button>
  </div>
  {#if error}
    <div class="note error">{error}</div>
  {:else if query}
    <div class="note">{matches.length}{truncated ? '+' : ''} {matches.length === 1 ? 'result' : 'results'} in {groups.length} {groups.length === 1 ? 'file' : 'files'}</div>
  {/if}
</div>
<div class="list">
  {#each groups as [path, items] (path)}
    <div class="file" title={path}>
      <span>{basename(path)}</span>
      <span class="dir">{dirname(path)}</span>
      <span class="count">{items.length}</span>
    </div>
    {#each items as m (m.line + ':' + m.column)}
      <button class="match" onclick={() => wb.open(m.path, 'file', m.line, m.column)}>
        <span class="ln">{m.line}</span>{m.text.trim()}
      </button>
    {/each}
  {/each}
</div>

<style>
  .form {
    padding: 0 12px 8px;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 2px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 2px;
    padding-right: 2px;
  }
  .field:focus-within {
    border-color: var(--accent);
  }
  .field input {
    flex: 1;
    min-width: 0;
    border: none;
    background: none;
  }
  .toggle {
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 12px;
    color: var(--fg-dim);
  }
  .toggle.on {
    background: var(--accent);
    color: #fff;
  }
  .note {
    margin-top: 6px;
    font-size: 12px;
    color: var(--fg-dim);
  }
  .error {
    color: var(--git-deleted);
  }
  .list {
    flex: 1;
    overflow: auto;
  }
  .file {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 2px 12px;
    white-space: nowrap;
  }
  .dir {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--fg-dim);
    font-size: 12px;
  }
  .count {
    padding: 0 6px;
    border-radius: 8px;
    background: var(--bg-active);
    font-size: 11px;
  }
  .match {
    display: block;
    width: 100%;
    padding: 1px 12px 1px 24px;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12px;
  }
  .match:hover {
    background: var(--bg-hover);
  }
  .ln {
    display: inline-block;
    min-width: 32px;
    color: var(--fg-dim);
  }
</style>
