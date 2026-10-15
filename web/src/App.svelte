<script lang="ts">
  import Editor from './components/Editor.svelte';
  import FileTree from './components/FileTree.svelte';
  import GitPanel from './components/GitPanel.svelte';
  import QuickOpen from './components/QuickOpen.svelte';
  import SearchPanel from './components/SearchPanel.svelte';
  import Terminals from './components/Terminals.svelte';
  import { revert, save } from './lib/docs';
  import { git } from './lib/git.svelte';
  import { rpc } from './lib/rpc.svelte';
  import { basename, wb, type SidebarView } from './lib/workbench.svelte';

  const views: { id: SidebarView; label: string; key: string; icon: string }[] = [
    { id: 'files', label: 'Explorer', key: '⌘⇧E', icon: 'M4 2h6l4 4v12H4z M10 2v4h4' },
    { id: 'search', label: 'Search', key: '⌘⇧F', icon: 'M8.5 3a5.5 5.5 0 1 1 0 11a5.5 5.5 0 0 1 0-11z M12.5 12.5L18 18' },
    { id: 'git', label: 'Source Control', key: '⌃⇧G', icon: 'M6 3v10 M6 13a2 2 0 1 0 0 4a2 2 0 0 0 0-4 M14 5a2 2 0 1 0 0 4a2 2 0 0 0 0-4 M14 9c0 3-8 2-8 4' },
  ];

  rpc.onOpen(async () => {
    const info = await rpc.call<{ name: string; root: string }>('workspace.info');
    wb.workspaceName = info.name;
    wb.workspaceRoot = info.root;
    document.title = info.name;
  });

  const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);

  function showView(id: SidebarView) {
    wb.sidebar = id;
    wb.sidebarOpen = true;
    if (id === 'search') wb.searchFocus++;
  }

  function onActivity(id: SidebarView) {
    if ((id === 'files' || id === 'git') && wb.sidebar === id) wb.sidebarOpen = !wb.sidebarOpen;
    else showView(id);
  }

  function loadFromDisk(path: string) {
    if (confirm(`Discard your unsaved edits to ${path} and load the version on disk?`)) void revert(path);
  }

  function onkeydown(e: KeyboardEvent) {
    // Ctrl/Alt chords belong to programs running in the terminal (Ctrl+P, Ctrl+S, Meta+W…).
    const inTerminal = e.target instanceof Element && !!e.target.closest('.xterm');
    const mod = isMac ? e.metaKey : e.ctrlKey && !inTerminal;
    const k = e.key.toLowerCase();
    let handled = true;
    if (mod && !e.shiftKey && k === 'p') wb.quickOpen = !wb.quickOpen;
    else if (mod && !e.shiftKey && k === 's') {
      if (wb.active) void save(wb.active.path);
    } else if (mod && e.shiftKey && k === 'f') showView('search');
    else if (mod && e.shiftKey && k === 'e') showView('files');
    else if (!inTerminal && e.ctrlKey && e.shiftKey && k === 'g') showView('git');
    else if ((e.ctrlKey && e.code === 'Backquote') || (mod && !e.shiftKey && k === 'j')) wb.cyclePanel();
    else if (!inTerminal && e.altKey && e.code === 'KeyW') {
      if (wb.activeKey) wb.close(wb.activeKey);
    } else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function drag(e: PointerEvent, apply: (dx: number, dy: number) => void) {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const y0 = e.clientY;
    const move = (ev: PointerEvent) => apply(ev.clientX - x0, ev.clientY - y0);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      document.body.classList.remove('dragging');
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    document.body.classList.add('dragging');
  }

  function dragSidebar(e: PointerEvent) {
    const w0 = wb.sidebarWidth;
    drag(e, (dx) => wb.setSidebarWidth(w0 + dx));
  }

  function dragPanel(e: PointerEvent) {
    const h0 = wb.panelHeight;
    drag(e, (_dx, dy) => wb.setPanelHeight(h0 - dy));
  }
</script>

<svelte:window
  onkeydowncapture={onkeydown}
  onbeforeunload={(e) => {
    if (wb.tabs.some((t) => t.dirty)) e.preventDefault();
  }}
/>

<div class="app" style:--sidebar-width="{wb.sidebarOpen ? wb.sidebarWidth : 0}px">
  <nav class="activity">
    {#each views as v (v.id)}
      <button class:active={wb.sidebarOpen && wb.sidebar === v.id} title="{v.label} ({v.key})" onclick={() => onActivity(v.id)}>
        <svg viewBox="0 0 20 20" width="22" height="22"><path d={v.icon} /></svg>
        {#if v.id === 'git' && git.files.length}<span class="dot">{git.files.length}</span>{/if}
      </button>
    {/each}
    <button class:on={wb.panelOpen} title="Terminal (⌘J)" onclick={() => wb.cyclePanel()}>
      <svg viewBox="0 0 20 20" width="22" height="22"><path d="M2 4h16v12H2z M5 8l3 2l-3 2 M10 13h4" /></svg>
    </button>
  </nav>

  <aside class="sidebar" inert={!wb.sidebarOpen}>
    <div class="view" class:hidden={wb.sidebar !== 'files'}><FileTree /></div>
    <div class="view" class:hidden={wb.sidebar !== 'search'}><SearchPanel /></div>
    <div class="view" class:hidden={wb.sidebar !== 'git'}><GitPanel /></div>
  </aside>
  <div class="sash vertical" class:collapsed={!wb.sidebarOpen} role="separator" onpointerdown={dragSidebar}></div>

  <main class="main">
    <div class="tabs" class:hidden={wb.panelMax}>
      {#each wb.tabs as tab (tab.key)}
        <div
          class="tab"
          class:active={tab.key === wb.activeKey}
          role="tab"
          tabindex="0"
          aria-selected={tab.key === wb.activeKey}
          title={tab.path}
          onclick={() => (wb.activeKey = tab.key)}
          onkeydown={(e) => e.key === 'Enter' && (wb.activeKey = tab.key)}
          onauxclick={(e) => e.button === 1 && wb.close(tab.key)}
        >
          <span class="name" class:conflict={tab.conflict}>
            {basename(tab.path)}{#if tab.kind === 'diff'}<span class="kind"> ↔ HEAD</span>{/if}
          </span>
          {#if tab.conflict}
            <button
              class="warn"
              title="The file changed on disk while you had unsaved edits. Save (⌘S) to keep yours, or click to load the version on disk."
              onclick={(e) => (e.stopPropagation(), loadFromDisk(tab.path))}>⚠</button
            >
          {/if}
          <button class="close" class:dirty={tab.dirty} title="Close (⌥W)" onclick={(e) => (e.stopPropagation(), wb.close(tab.key))}>
            <span class="dot">●</span><span class="x">×</span>
          </button>
        </div>
      {/each}
    </div>
    <div class="editor-area" class:hidden={wb.panelMax}><Editor /></div>

    <div class="sash horizontal" class:hidden={!wb.panelOpen || wb.panelMax} role="separator" onpointerdown={dragPanel}></div>
    <section class="panel" class:hidden={!wb.panelOpen} class:max={wb.panelMax} style:height={wb.panelMax ? null : `${wb.panelHeight}px`}>
      <Terminals />
    </section>
  </main>

</div>

<QuickOpen />

{#if rpc.status === 'connecting' || rpc.status === 'closed'}
  <div class="conn">{rpc.status === 'connecting' ? 'Connecting…' : 'Disconnected, reconnecting…'}</div>
{/if}

{#if rpc.status === 'forbidden'}
  <div class="overlay">
    <div>
      <h2>Forbidden</h2>
      <p>loupe only accepts connections from loopback, private and Tailscale addresses. Start it with <code>--allow &lt;cidr&gt;</code> to add a network; the reason is logged in the server terminal.</p>
    </div>
  </div>
{/if}

{#if rpc.status === 'replaced'}
  <div class="overlay">
    <div>
      <h2>Opened in another window</h2>
      <p>A workspace can be open in only one window at a time, so terminals keep one size.</p>
      <button class="primary" onclick={() => rpc.connect()}>Open here</button>
    </div>
  </div>
{/if}

{#if rpc.status === 'workspace-error'}
  <div class="overlay">
    <div>
      <h2>Unable to open workspace</h2>
      <p>{rpc.error}</p>
      <p>Use an absolute project path in the address bar, or <code>?folder=/path/to/project</code>.</p>
      <a href="/">Open default workspace</a>
    </div>
  </div>
{/if}

<style>
  .app {
    display: grid;
    grid-template-columns: 48px var(--sidebar-width) 0 1fr;
    grid-template-rows: 100%;
    height: var(--app-height, 100vh);
  }
  .activity {
    display: flex;
    flex-direction: column;
    background: var(--bg-activity);
  }
  .activity button {
    position: relative;
    flex: none;
    width: 48px;
    height: 48px;
    display: grid;
    place-items: center;
    color: var(--fg-dim);
    border-left: 2px solid transparent;
    border-bottom: 2px solid transparent;
  }
  .activity button:hover,
  .activity button.active,
  .activity button.on {
    color: var(--fg);
  }
  .activity button.active {
    border-left-color: var(--fg);
  }
  /* Portrait is short on width, so the activity bar sits across the top. */
  @media (orientation: portrait) {
    .app {
      grid-template-columns: var(--sidebar-width) 0 1fr;
      grid-template-rows: 48px minmax(0, 1fr);
    }
    .activity {
      grid-column: 1 / -1;
      flex-direction: row;
    }
    .activity button.active {
      border-left-color: transparent;
      border-bottom-color: var(--fg);
    }
  }
  .activity svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .activity .dot {
    position: absolute;
    right: 6px;
    bottom: 8px;
    min-width: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--accent);
    color: #fff;
    font-size: 10px;
    line-height: 16px;
  }
  .sidebar {
    background: var(--bg-sidebar);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    position: relative;
  }
  .view {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
  }
  .hidden {
    display: none !important;
  }
  .sash {
    position: relative;
    z-index: 5;
  }
  .sash::after {
    content: '';
    position: absolute;
  }
  .sash.vertical.collapsed,
  .sash.vertical.collapsed::after {
    pointer-events: none;
  }
  .sash.vertical::after {
    inset: 0 -3px;
    cursor: col-resize;
  }
  .sash.horizontal {
    flex: none;
    height: 0;
    border-top: 1px solid var(--border);
  }
  .sash.horizontal::after {
    inset: -3px 0;
    cursor: row-resize;
  }
  .sash:hover::after {
    background: var(--accent);
    opacity: 0.6;
  }
  .main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .tabs {
    display: flex;
    flex: none;
    height: 35px;
    background: var(--bg-sidebar);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 6px 0 12px;
    border-right: 1px solid var(--bg);
    color: var(--fg-dim);
    cursor: pointer;
    white-space: nowrap;
  }
  .tab.active {
    background: var(--bg);
    color: var(--fg);
  }
  .kind {
    color: var(--fg-dim);
    font-size: 11px;
  }
  .conflict {
    color: var(--git-modified);
  }
  .warn {
    color: var(--git-modified);
  }
  .close {
    width: 20px;
    height: 20px;
    border-radius: 3px;
    visibility: hidden;
  }
  .close .dot {
    display: none;
  }
  .close.dirty {
    visibility: visible;
  }
  .close.dirty .dot {
    display: inline;
  }
  .close.dirty .x {
    display: none;
  }
  .tab:hover .close,
  .tab.active .close {
    visibility: visible;
  }
  .tab:hover .close .dot,
  .close:hover .dot {
    display: none;
  }
  .tab:hover .close .x {
    display: inline;
  }
  .close:hover {
    background: var(--bg-hover);
  }
  .editor-area {
    flex: 1;
    position: relative;
    min-height: 0;
  }
  .panel {
    flex: none;
    min-height: 0;
  }
  .panel.max {
    flex: 1;
  }
  .conn {
    position: fixed;
    right: 12px;
    bottom: 12px;
    z-index: 50;
    padding: 4px 10px;
    border-radius: 4px;
    background: var(--bg-hover);
    color: #ffd27a;
    font-size: 12px;
  }
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.7);
    text-align: center;
  }
</style>
