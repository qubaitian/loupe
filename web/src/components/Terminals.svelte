<script lang="ts">
  import { FitAddon } from '@xterm/addon-fit';
  import { Unicode11Addon } from '@xterm/addon-unicode11';
  import { WebglAddon } from '@xterm/addon-webgl';
  import { Terminal } from '@xterm/xterm';
  import '@xterm/xterm/css/xterm.css';
  import { onMount } from 'svelte';
  import { copyText } from '../lib/clipboard';
  import { fontFamily } from '../lib/font';
  import { rpc } from '../lib/rpc.svelte';
  import { onTap, showKeyboard } from '../lib/touchKeyboard';
  import { wb } from '../lib/workbench.svelte';

  type Instance = {
    id: number;
    term: Terminal;
    fit: FitAddon;
    el: HTMLDivElement;
    unbindTouch: () => void;
    /** Last output chunk applied; chunks at or below it are already on screen. */
    seq: number;
    /** While a snapshot is being written, xterm's replies to queries in it must not reach the pty. */
    replaying: boolean;
    size: { cols: number; rows: number };
  };
  type Snapshot = { id: number; seq: number; cols: number; rows: number; data: string };
  type Chunk = { id: number; seq: number; data: string };

  const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);

  let host: HTMLDivElement;
  let ids = $state<number[]>([]);
  let active = $state<number | null>(null);
  const instances = new Map<number, Instance>();
  let attaching = false;
  let held: Chunk[] = [];

  /**
   * A phone has no wheel. Full-screen TUIs (Cursor CLI) turn mouse tracking on,
   * so a finger drag arrives as a selection instead of a scroll.
   */
  function bindTouchScroll(root: HTMLElement, term: Terminal): () => void {
    const textarea = term.textarea;
    if (navigator.maxTouchPoints < 1 || !textarea) return () => {};
    let tracking = false;
    let scrolling = false;
    let x0 = 0;
    let y0 = 0;
    let lastY = 0;
    let carry = 0;

    const stepPx = () => {
      const screen = root.querySelector<HTMLElement>('.xterm-screen');
      return screen && term.rows > 0 ? Math.max(12, screen.clientHeight / term.rows) : 18;
    };

    root.addEventListener('touchstart', (e) => {
      // Own the gesture before xterm or the browser can focus its textarea.
      e.preventDefault();
      e.stopPropagation();
      scrolling = false;
      if (e.touches.length !== 1) {
        tracking = false;
        return;
      }
      const t = e.touches[0];
      x0 = t.clientX;
      y0 = lastY = t.clientY;
      carry = 0;
      tracking = true;
    }, { capture: true, passive: false });

    root.addEventListener('touchmove', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!tracking || e.touches.length !== 1) return;
      const t = e.touches[0];
      if (!scrolling) {
        const dx = t.clientX - x0;
        const dy = t.clientY - y0;
        if (Math.hypot(dx, dy) < 8) return;
        if (Math.abs(dx) > Math.abs(dy)) {
          tracking = false;
          return;
        }
        scrolling = true;
      }
      carry += lastY - t.clientY;
      lastY = t.clientY;
      const step = stepPx();
      const screen = root.querySelector<HTMLElement>('.xterm-screen');
      const toApp = term.buffer.active.type === 'alternate' || root.querySelector('.xterm')?.classList.contains('enable-mouse-events');
      while (Math.abs(carry) >= step) {
        const dir = carry > 0 ? 1 : -1;
        carry -= dir * step;
        if (toApp && screen) {
          screen.dispatchEvent(new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            view: window,
            deltaY: dir,
            deltaMode: WheelEvent.DOM_DELTA_LINE,
            clientX: t.clientX,
            clientY: t.clientY,
          }));
        } else {
          term.scrollLines(dir);
        }
      }
    }, { capture: true, passive: false });

    root.addEventListener('touchend', (e) => {
      e.preventDefault();
      e.stopPropagation();
      tracking = false;
    }, { capture: true, passive: false });

    root.addEventListener('touchcancel', (e) => {
      e.stopPropagation();
      tracking = false;
    }, { capture: true });
    // Native tap-to-focus is canceled at touchstart; a tap focuses with the keyboard instead.
    return onTap(root, () => showKeyboard(textarea, () => term.focus()));
  }

  function ensure(id: number): Instance {
    const existing = instances.get(id);
    if (existing) return existing;
    const el = document.createElement('div');
    el.className = 'term';
    host.appendChild(el);
    const term = new Terminal({
      fontFamily,
      fontSize: 13,
      cursorBlink: true,
      // Same as SCROLLBACK in server/terminals.ts, so copied line numbers match the terminal file.
      scrollback: 10000,
      macOptionIsMeta: true,
      allowProposedApi: true,
      theme: { background: '#1e1e1e' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = '11';
    term.open(el);
    const unbindTouch = bindTouchScroll(el, term);
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // falls back to the DOM renderer
    }
    const inst: Instance = { id, term, fit, el, unbindTouch, seq: 0, replaying: false, size: { cols: term.cols, rows: term.rows } };
    term.attachCustomKeyEventHandler((e) => {
      // Ctrl+L is "clear screen" in the shell, so other platforms get Ctrl+Shift+L.
      const chord = isMac ? e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey : e.ctrlKey && e.shiftKey && !e.altKey;
      if (!chord || e.code !== 'KeyL') return true;
      e.preventDefault();
      if (e.type === 'keydown') void copyReference(inst);
      return false;
    });
    term.onData((data) => {
      if (!inst.replaying) rpc.notify('term.input', { id, data });
    });
    term.onBinary((data) => {
      if (!inst.replaying) rpc.notify('term.input', { id, data, binary: true });
    });
    instances.set(id, inst);
    ids.push(id);
    active ??= id;
    return inst;
  }

  /**
   * Copies `@file:start-end` for the selected lines of the terminal file the server keeps up to date.
   * Line numbers follow the server's `render` in server/terminals.ts: soft-wrapped rows are joined into one line.
   */
  async function copyReference(inst: Instance) {
    const buf = inst.term.buffer.active;
    const sel = inst.term.getSelectionPosition();
    /** Buffer row -> 1-based file line. */
    const lineOf: number[] = [];
    let line = 0;
    /** Last line with text, since the file drops trailing blank lines. */
    let last = 0;
    for (let y = 0; y < buf.length; y++) {
      const row = buf.getLine(y);
      if (!row?.isWrapped || !line) line++;
      lineOf.push(line);
      if (row?.translateToString(true).trim()) last = line;
    }

    let range = '';
    if (sel) {
      let endY = sel.end.y;
      // A selection that ends at column 0 doesn't include anything on that row.
      if (endY > sel.start.y && sel.end.x === 0) endY--;
      const start = Math.min(lineOf[sel.start.y] ?? last, last);
      const end = Math.min(lineOf[endY] ?? last, last);
      if (start > 0) range = start === end ? `:${start}` : `:${start}-${end}`;
    }
    // Copied before the save finishes: clipboard writes need the key event's user activation.
    const file = `${wb.terminalDir}/${inst.id}.txt`;
    await Promise.all([copyText(`@${file}${range}`), rpc.call('term.save', { id: inst.id })]);
  }

  function remove(id: number) {
    const inst = instances.get(id);
    if (!inst) return;
    inst.unbindTouch();
    inst.term.dispose();
    inst.el.remove();
    instances.delete(id);
    ids = ids.filter((x) => x !== id);
    if (active === id) active = ids.at(-1) ?? null;
  }

  async function create() {
    const { id } = await rpc.call<{ id: number }>('term.create', { cols: 80, rows: 24 });
    ensure(id).size = { cols: 80, rows: 24 };
    active = id;
  }

  function fitActive() {
    if (active == null || !wb.panelOpen) return;
    const inst = instances.get(active);
    if (!inst || !inst.el.offsetParent) return;
    inst.fit.fit();
    const { cols, rows } = inst.term;
    if (cols === inst.size.cols && rows === inst.size.rows) return;
    inst.size = { cols, rows };
    rpc.notify('term.resize', { id: inst.id, cols, rows });
  }

  function apply(chunk: Chunk) {
    const inst = ensure(chunk.id);
    if (chunk.seq <= inst.seq) return;
    inst.seq = chunk.seq;
    inst.term.write(chunk.data);
  }

  function restore(snap: Snapshot) {
    const inst = ensure(snap.id);
    inst.term.reset();
    inst.term.resize(snap.cols, snap.rows);
    inst.size = { cols: snap.cols, rows: snap.rows };
    inst.seq = snap.seq;
    inst.replaying = true;
    inst.term.write(snap.data, () => {
      inst.replaying = false;
      // A focus gained during the replay wasn't reported, and TUIs that draw their own cursor only do so while focused.
      if (inst.term.modes.sendFocusMode && document.activeElement === inst.term.textarea) {
        rpc.notify('term.input', { id: inst.id, data: '\x1b[I' });
      }
    });
  }

  async function attach() {
    attaching = true;
    held = [];
    let list: Snapshot[];
    try {
      list = await rpc.call<Snapshot[]>('term.list');
    } catch {
      return;
    } finally {
      attaching = false;
    }
    for (const id of [...instances.keys()]) if (!list.some((t) => t.id === id)) remove(id);
    for (const snap of list) restore(snap);
    // Output that arrived while the snapshots were in flight; anything already captured is skipped by seq.
    for (const chunk of held) if (instances.has(chunk.id)) apply(chunk);
    held = [];
    if (!list.length) await create();
    requestAnimationFrame(fitActive);
  }

  onMount(() => {
    const offData = rpc.on('term.data', (chunk: Chunk) => (attaching ? held.push(chunk) : apply(chunk)));
    const offExit = rpc.on('term.exit', ({ id }: { id: number }) => remove(id));
    const offOpen = rpc.onOpen(attach);
    const ro = new ResizeObserver(() => fitActive());
    ro.observe(host);
    return () => {
      offData();
      offExit();
      offOpen();
      ro.disconnect();
      for (const id of [...instances.keys()]) remove(id);
    };
  });

  $effect(() => {
    const current = active;
    const open = wb.panelOpen;
    for (const inst of instances.values()) inst.el.style.display = inst.id === current ? '' : 'none';
    if (!open || current == null) return;
    requestAnimationFrame(() => {
      fitActive();
      instances.get(current)?.term.focus();
    });
  });
</script>

<div class="terminals">
  <div class="bar">
    <span class="title">Terminal</span>
    {#each ids as id, i (id)}
      <button class="tab" class:active={id === active} onclick={() => (active = id)}>
        {i + 1}: shell
        <span
          class="x"
          role="button"
          tabindex="-1"
          onclick={(e) => {
            e.stopPropagation();
            rpc.notify('term.kill', { id });
          }}
          onkeydown={() => {}}>×</span
        >
      </button>
    {/each}
    <button class="icon" title="New Terminal" onclick={create}>+</button>
    <span class="spacer"></span>
    <button class="icon" title="Hide" onclick={() => wb.hidePanel()}>⌄</button>
  </div>
  <div class="host" bind:this={host}></div>
</div>

<style>
  .terminals {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 30px;
    padding: 0 8px;
    flex: none;
    font-size: 12px;
  }
  .title {
    text-transform: uppercase;
    color: var(--fg-dim);
    margin-right: 12px;
    font-size: 11px;
  }
  .tab {
    padding: 2px 8px;
    border-radius: 3px;
    color: var(--fg-dim);
  }
  .tab.active {
    background: var(--bg-hover);
    color: var(--fg);
  }
  .x {
    margin-left: 6px;
    opacity: 0.6;
  }
  .x:hover {
    opacity: 1;
  }
  .spacer {
    flex: 1;
  }
  .host {
    flex: 1;
    min-height: 0;
    position: relative;
    padding: 0 0 4px 12px;
  }
  .host :global(.term) {
    position: absolute;
    inset: 0 0 4px 12px;
    touch-action: none;
  }
</style>
