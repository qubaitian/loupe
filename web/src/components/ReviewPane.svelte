<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { monaco } from '../lib/monaco';
  import { isNotePath, loadReview, reviewPath, type Note } from '../lib/review';
  import { reviewScrollTop } from '../lib/reviewScroll';
  import { rpc } from '../lib/rpc.svelte';
  import { wb } from '../lib/workbench.svelte';

  let { editor, path }: { editor: monaco.editor.ICodeEditor | undefined; path: string | null } = $props();

  const GAP = 6;

  let notes = $state<Note[]>([]);
  let heights = $state<number[]>([]);
  let scrollTop = $state(0);
  let layoutVersion = $state(0);
  let pane = $state<HTMLDivElement>();
  let paneHeight = $state(0);
  let activeIndex = $state<number | null>(null);
  let alignment = $state.raw<{ index: number } | null>(null);
  let resizing = $state.raw<{ id: number; x: number; width: number; total: number } | null>(null);

  onDestroy(endResize);

  $effect(() => {
    const p = path;
    notes = [];
    activeIndex = null;
    alignment = null;
    if (!p || isNotePath(p)) {
      return;
    }
    let cancelled = false;
    const load = () =>
      loadReview(p).then((n) => {
        if (!cancelled) notes = n;
      });
    void load();
    const file = reviewPath(p);
    const unsubscribe = rpc.on('fs.changed', ({ paths, all }: { paths: string[]; all?: boolean }) => {
      if (all || paths.includes(file)) void load();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  });

  $effect(() => {
    const ed = editor;
    if (!ed) return;
    const bump = () => layoutVersion++;
    const subs = [
      ed.onDidScrollChange((e) => {
        if (e.scrollTopChanged) {
          scrollTop = e.scrollTop;
          alignment = null;
          activeIndex = null;
        }
      }),
      ed.onDidContentSizeChange(bump),
      ed.onDidLayoutChange(bump),
      ed.onDidChangeModel(bump),
      ed.onDidChangeModelContent(bump),
      ed.onDidChangeHiddenAreas(bump),
      ed.onMouseMove((e) => {
        if (e.event.buttons & 1) return;
        const line = e.target.position?.lineNumber;
        const index = line === undefined ? -1 : notes.findIndex((n) => n.start <= line && line <= n.end);
        activeIndex = index < 0 ? null : index;
        if (index >= 0) alignment = { index };
      }),
      ed.onMouseLeave(() => (activeIndex = null)),
    ];
    scrollTop = ed.getScrollTop();
    return () => subs.forEach((s) => s.dispose());
  });

  const codeTops = $derived.by(() => {
    void layoutVersion;
    const ed = editor;
    const model = ed?.getModel();
    if (!ed || !model) return [];
    return notes.map((n) => ed.getTopForLineNumber(Math.min(n.start, model.getLineCount())));
  });

  // Preserve line alignment where there is room; longer notes push later cards down.
  const tops = $derived.by(() => {
    let floor = 0;
    return codeTops.map((codeTop, i) => {
      const top = Math.max(codeTop, floor);
      floor = top + (heights[i] ?? 0) + GAP;
      return top;
    });
  });

  const trackHeight = $derived.by(() => {
    void layoutVersion;
    const last = tops.length - 1;
    return Math.max(editor?.getScrollHeight() ?? 0, last < 0 ? 0 : tops[last] + (heights[last] ?? 0) + GAP);
  });

  const centerIndex = $derived.by(() => {
    void layoutVersion;
    const ed = editor;
    const model = ed?.getModel();
    if (!ed || !model) return null;
    const top = scrollTop;
    const bottom = top + ed.getLayoutInfo().height;
    const center = (top + bottom) / 2;
    let nearest: number | null = null;
    let distance = Infinity;
    const visible = ed.getVisibleRanges();
    notes.forEach((n, i) => {
      if (!visible.some((r) => n.start <= r.endLineNumber && n.end >= r.startLineNumber)) return;
      const start = codeTops[i];
      const end = ed.getBottomForLineNumber(Math.min(n.end, model.getLineCount()));
      if (end <= top || start >= bottom) return;
      const gap = Math.max(start - center, center - end, 0);
      if (gap < distance) {
        nearest = i;
        distance = gap;
      }
    });
    return nearest;
  });

  const selectedIndex = $derived(activeIndex ?? centerIndex);

  $effect(() => {
    const ed = editor;
    const el = pane;
    const height = paneHeight;
    const contentHeight = trackHeight;
    const position = scrollTop;
    const index = alignment?.index ?? centerIndex;
    const anchors = codeTops.map((code, i) => ({ code, note: tops[i] }));
    if (!ed || !el || !height) return;
    // Align the hovered block, or the block nearest the center when scrolling.
    const codeTop = index === null ? undefined : codeTops[index];
    const target = index !== null && codeTop !== undefined
      ? tops[index] - Math.max(0, codeTop - position)
      : reviewScrollTop(
          position,
          ed.getScrollHeight() - ed.getLayoutInfo().height,
          Math.max(0, contentHeight - height),
          anchors,
        );
    let cancelled = false;
    // Wait for measured card heights to reach the DOM before assigning native scrollTop.
    void tick().then(() => {
      if (!cancelled) el.scrollTop = target;
    });
    return () => {
      cancelled = true;
    };
  });

  const highlight = $derived(editor?.createDecorationsCollection());

  $effect(() => {
    const collection = highlight;
    return () => collection?.clear();
  });

  $effect(() => {
    void layoutVersion;
    const n = selectedIndex === null ? undefined : notes[selectedIndex];
    highlight?.set(
      n ? [{ range: new monaco.Range(n.start, 1, n.end, 1), options: { isWholeLine: true, className: 'review-highlight' } }] : [],
    );
  });

  function reveal(n: Note, index: number) {
    activeIndex = index;
    const ed = editor;
    if (!ed) return;
    ed.revealLinesInCenterIfOutsideViewport(n.start, n.end);
    ed.setPosition({ lineNumber: n.start, column: 1 });
    ed.focus();
  }

  function startResize(e: PointerEvent) {
    if (e.button !== 0 || !pane) return;
    const el = e.currentTarget as HTMLElement;
    const total = el.parentElement!.clientWidth;
    if (!total) return;
    e.preventDefault();
    resizing = { id: e.pointerId, x: e.clientX, width: wb.reviewWidth, total };
    el.setPointerCapture(e.pointerId);
    document.body.classList.add('dragging');
    activeIndex = null;
  }

  function moveResize(e: PointerEvent) {
    if (!resizing || e.pointerId !== resizing.id) return;
    wb.setReviewWidth(resizing.width - (e.clientX - resizing.x) / resizing.total * 100);
  }

  function endResize() {
    if (!resizing) return;
    resizing = null;
    document.body.classList.remove('dragging');
  }

  function resizeKey(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft') wb.setReviewWidth(wb.reviewWidth + 2);
    else if (e.key === 'ArrowRight') wb.setReviewWidth(wb.reviewWidth - 2);
    else if (e.key === 'Home') wb.setReviewWidth(20);
    else if (e.key === 'End') wb.setReviewWidth(70);
    else return;
    e.preventDefault();
  }
</script>

{#if notes.length}
  <!-- Focusable separators support keyboard resizing. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="divider"
    class:resizing={resizing !== null}
    role="separator"
    aria-label="Resize review pane"
    aria-orientation="vertical"
    aria-valuemin="20"
    aria-valuemax="70"
    aria-valuenow={Math.round(wb.reviewWidth)}
    tabindex="0"
    title="Drag to resize review pane; double-click to reset"
    onpointerdown={startResize}
    onpointermove={moveResize}
    onpointerup={endResize}
    onpointercancel={endResize}
    onlostpointercapture={endResize}
    onkeydown={resizeKey}
    ondblclick={() => wb.setReviewWidth(40)}
  ></div>
  <div class="pane" style:flex-basis="{wb.reviewWidth}%" bind:this={pane} bind:clientHeight={paneHeight}>
    <div class="track" style:height="{trackHeight}px">
      {#each notes as n, i (i)}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div
          class="note"
          class:active={i === selectedIndex}
          style:top="{tops[i] ?? 0}px"
          bind:clientHeight={heights[i]}
          onmouseenter={() => (activeIndex = i)}
          onmouseleave={() => (activeIndex = null)}
          onclick={() => reveal(n, i)}
        >
          <div class="range">L{n.start}{n.end !== n.start ? `–${n.end}` : ''}</div>
          <div class="text">{n.text}</div>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .divider {
    flex: 0 0 6px;
    position: relative;
    cursor: col-resize;
    touch-action: none;
    background: var(--bg-sidebar);
  }
  .divider:hover,
  .divider:focus-visible,
  .divider.resizing {
    background: var(--accent);
  }
  .pane {
    flex: 0 0 40%;
    min-width: 0;
    position: relative;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    overflow-anchor: none;
    border-left: 1px solid var(--border);
    background: var(--bg-sidebar);
  }
  .track {
    position: relative;
  }
  .note {
    position: absolute;
    left: 6px;
    right: 6px;
    padding: 6px 8px;
    border-left: 2px solid var(--accent);
    border-radius: 2px;
    background: var(--bg);
    cursor: pointer;
  }
  .note:hover,
  .note.active {
    background: var(--bg-active);
  }
  .range {
    font-size: 11px;
    color: var(--fg-dim);
    margin-bottom: 2px;
  }
  .text {
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 12px;
  }
  :global(.review-highlight) {
    background: rgba(14, 99, 156, 0.25);
  }
</style>
