<script lang="ts">
  import { copyText } from '../lib/clipboard';
  import { deletePath } from '../lib/docs';
  import { git } from '../lib/git.svelte';
  import { fileIcon, folderIcon } from '../lib/icons';
  import { tree, type Row } from '../lib/tree.svelte';
  import { wb } from '../lib/workbench.svelte';

  const activePath = $derived(wb.active?.path);
  let context = $state<{ path: string; dir: boolean; x: number; y: number; trigger: HTMLButtonElement } | null>(null);
  let menu = $state<HTMLDivElement>();

  $effect(() => {
    if (!context || !menu) return;
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(context.x, window.innerWidth - bounds.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(context.y, window.innerHeight - bounds.height - 4))}px`;
    menu.querySelector<HTMLButtonElement>('button')?.focus();
  });

  $effect(() => {
    if (!wb.sidebarOpen || wb.sidebar !== 'files') context = null;
  });

  function showContext(event: MouseEvent, row: Row) {
    event.preventDefault();
    const trigger = event.currentTarget as HTMLButtonElement;
    const bounds = trigger.getBoundingClientRect();
    context = {
      path: row.path,
      dir: row.dir,
      x: event.clientX || bounds.left,
      y: event.clientY || bounds.bottom,
      trigger,
    };
  }

  function dismiss(restoreFocus = false) {
    if (restoreFocus) context?.trigger.focus();
    context = null;
  }

  function dismissOutside(event: Event) {
    if (event.target instanceof Node && !menu?.contains(event.target)) dismiss();
  }

  function copyPath(relative: boolean) {
    if (!context) return;
    const path = relative ? context.path : `${wb.workspaceRoot.replace(/\/$/, '')}/${context.path}`;
    dismiss(true);
    void copyText(path);
  }

  async function deleteEntry() {
    if (!context) return;
    const { path, dir } = context;
    dismiss(true);
    const unsaved = wb.tabs.some((tab) => (tab.path === path || tab.path.startsWith(`${path}/`)) && tab.dirty);
    const message = dir ? `Permanently delete folder "${path}" and all its contents?`
      : `Permanently delete file "${path}"?`;
    if (!confirm(`${message}${unsaved ? '\nUnsaved changes will be discarded.' : ''}`)) return;
    try {
      await deletePath(path);
      tree.refresh([path], true);
    } catch (error) {
      alert(`Unable to delete "${path}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function menuKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      dismiss(true);
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const buttons = Array.from(menu?.querySelectorAll<HTMLButtonElement>('button') ?? []);
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  }

  function click(row: Row) {
    if (row.dir) void tree.toggle(row.path);
    else wb.open(row.path);
  }
</script>

<svelte:window
  onpointerdowncapture={dismissOutside}
  onfocusin={dismissOutside}
  onscrollcapture={() => dismiss()}
  onresize={() => dismiss()}
  onblur={() => dismiss()}
/>

<div class="header">{wb.workspaceName || 'Explorer'}</div>
<div class="list">
  {#each tree.rows as row (row.path)}
    {@const status = row.dir ? undefined : git.decorations.get(row.path)}
    {@const open = row.dir && tree.expanded.has(row.path)}
    {@const icon = row.dir ? folderIcon(open) : fileIcon(row.name)}
    <button
      class="row status-{status}"
      class:active={row.path === activePath}
      title={row.path}
      onclick={() => click(row)}
      oncontextmenu={(event) => showContext(event, row)}
    >
      {#each { length: row.depth } as _}<span class="guide"></span>{/each}
      <span class="chevron" class:open>
        {#if row.dir}
          <svg viewBox="0 0 16 16" width="16" height="16"><path d="M6 4l4 4-4 4" /></svg>
        {/if}
      </span>
      <span class="file-icon" style:color={icon.color}>{icon.glyph}</span>
      <span class="name">{row.name}</span>
      {#if status}<span class="badge">{status}</span>{/if}
    </button>
  {/each}
</div>

{#if context}
  <div
    bind:this={menu}
    class="context-menu"
    role="menu"
    aria-label="File actions"
    tabindex="-1"
    style:left="{context.x}px"
    style:top="{context.y}px"
    onkeydown={menuKeydown}
    oncontextmenu={(event) => event.preventDefault()}
  >
    <button role="menuitem" tabindex="-1" onclick={() => copyPath(false)}>Copy Path</button>
    <button role="menuitem" tabindex="-1" onclick={() => copyPath(true)}>Copy Relative Path</button>
    <button class="delete" role="menuitem" tabindex="-1" onclick={() => void deleteEntry()}>Delete</button>
  </div>
{/if}

<style>
  .context-menu {
    position: fixed;
    z-index: 60;
    min-width: 190px;
    max-width: calc(100vw - 8px);
    padding: 4px;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 5px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  }
  .context-menu button {
    display: block;
    width: 100%;
    padding: 5px 12px;
    border-radius: 3px;
    text-align: left;
  }
  .context-menu button:hover,
  .context-menu button:focus-visible {
    background: var(--accent);
    color: #fff;
    outline: none;
  }
  .context-menu button.delete {
    margin-top: 4px;
    border-top: 1px solid var(--border);
    color: var(--git-deleted);
  }
  .context-menu button.delete:hover,
  .context-menu button.delete:focus-visible {
    color: #fff;
  }
  .list {
    flex: 1;
    overflow: auto;
    padding-bottom: 8px;
  }
  .row {
    display: flex;
    align-items: center;
    width: 100%;
    height: 22px;
    padding: 0 12px 0 8px;
    text-align: left;
    white-space: nowrap;
    outline: 1px solid transparent;
    outline-offset: -1px;
  }
  .row:hover {
    background: var(--bg-hover);
  }
  .row.active {
    background: var(--bg-active);
  }
  .list:focus-within .row.active {
    background: #04395e;
    outline-color: #007fd4;
  }
  .guide {
    flex: none;
    align-self: stretch;
    width: 12px;
    margin-left: 7px;
    margin-right: -7px;
    border-left: 1px solid transparent;
    transition: border-color 0.1s;
  }
  .list:hover .guide {
    border-left-color: #585858;
  }
  .chevron {
    display: flex;
    flex: none;
    width: 16px;
    color: var(--fg);
    opacity: 0.8;
    transition: transform 0.1s;
  }
  .chevron.open {
    transform: rotate(90deg);
  }
  .chevron path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .file-icon {
    flex: none;
    width: 16px;
    margin: 0 6px 0 2px;
    font-size: 15px;
    line-height: 1;
    text-align: center;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }
  .badge {
    font-size: 12px;
    margin-left: 6px;
    opacity: 0.9;
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
  }
</style>
