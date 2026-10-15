<script lang="ts">
  import { git } from '../lib/git.svelte';
  import { basename, dirname, wb } from '../lib/workbench.svelte';
</script>

<div class="header">Source Control {#if git.branch}<span class="branch">⎇ {git.branch}</span>{/if}</div>

{#if !git.repo}
  <div class="note">This folder is not a git repository</div>
{:else}
  <div class="list">
    {#if git.files.length}
      <div class="section">Changes <span class="count">{git.files.length}</span></div>
      {#each git.files as c (c.path)}
        {@const l = git.decorations.get(c.path)}
        <div
          class="item"
          class:active={wb.activeKey === `diff:${c.path}`}
          role="button"
          tabindex="0"
          title={c.path}
          onclick={() => wb.open(c.path, 'diff')}
          onkeydown={(e) => e.key === 'Enter' && wb.open(c.path, 'diff')}
        >
          <span class="name status-{l}">{basename(c.path)}</span>
          <span class="dir">{dirname(c.path)}</span>
          <span class="letter status-{l}">{l}</span>
        </div>
      {/each}
    {:else}
      <div class="note">No changes</div>
    {/if}
  </div>
{/if}

<style>
  .branch {
    float: right;
    text-transform: none;
    color: var(--fg-dim);
  }
  .list {
    flex: 1;
    overflow: auto;
  }
  .section {
    padding: 4px 12px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
  }
  .count {
    margin-left: 4px;
    padding: 0 6px;
    border-radius: 8px;
    background: var(--bg-active);
    font-weight: normal;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding: 0 12px 0 20px;
    cursor: pointer;
    white-space: nowrap;
  }
  .item:hover,
  .item.active {
    background: var(--bg-hover);
  }
  .item.active {
    background: var(--bg-active);
  }
  .dir {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--fg-dim);
    font-size: 12px;
  }
  .letter {
    width: 12px;
    text-align: center;
    font-size: 12px;
  }
  .note {
    padding: 8px 12px;
    color: var(--fg-dim);
  }
  .status-M {
    color: var(--git-modified);
  }
  .status-U,
  .status-A {
    color: var(--git-added);
  }
  .status-D {
    color: var(--git-deleted);
    text-decoration: line-through;
  }
  .letter.status-D {
    text-decoration: none;
  }
</style>
