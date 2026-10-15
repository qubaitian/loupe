<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { copyText } from '../lib/clipboard';
  import { collect, getDoc, getHead } from '../lib/docs';
  import { editorOptions, monaco } from '../lib/monaco';
  import { onTap, showKeyboard } from '../lib/touchKeyboard';
  import { wb } from '../lib/workbench.svelte';
  import ReviewPane from './ReviewPane.svelte';

  let editorEl: HTMLDivElement;
  let diffEl: HTMLDivElement;
  let editor: monaco.editor.IStandaloneCodeEditor;
  let diff: monaco.editor.IStandaloneDiffEditor;
  let ready = $state.raw<{ file: monaco.editor.ICodeEditor; diff: monaco.editor.ICodeEditor }>();
  let shown = $state<{ key: string; kind: 'file' | 'diff'; path: string } | null>(null);
  const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>();

  function bindTapKeyboard(ed: monaco.editor.ICodeEditor) {
    const root = ed.getDomNode();
    if (!root) return () => {};
    // Monaco's own gestures still scroll, place the cursor and focus; this only adds the keyboard.
    return onTap(root, (t) => {
      const target = ed.getTargetAtClientPoint(t.clientX, t.clientY);
      const content = target?.type === monaco.editor.MouseTargetType.CONTENT_TEXT ||
        target?.type === monaco.editor.MouseTargetType.CONTENT_EMPTY;
      // Monaco recreates its textarea whenever the model changes.
      const textarea = root.querySelector<HTMLTextAreaElement>('textarea.inputarea');
      if (!content || !target?.position || !textarea || ed.getOption(monaco.editor.EditorOption.readOnly)) return;
      ed.setPosition(target.position);
      showKeyboard(textarea, () => ed.focus());
    });
  }

  onMount(() => {
    // Touch keyboard control needs a textarea rather than the native EditContext.
    const touchOptions = navigator.maxTouchPoints > 0 ? { editContext: false } : {};
    editor = monaco.editor.create(editorEl, { ...editorOptions, ...touchOptions, theme: 'vs-dark' });
    diff = monaco.editor.createDiffEditor(diffEl, {
      ...editorOptions,
      ...touchOptions,
      theme: 'vs-dark',
      originalEditable: false,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: true,
    });
    const unbindTouch = [editor, diff.getOriginalEditor(), diff.getModifiedEditor()].map(bindTapKeyboard);
    ready = { file: editor, diff: diff.getModifiedEditor() };
    for (const ed of [editor, diff.getModifiedEditor()]) {
      ed.addAction({
        id: 'loupe.copyReference',
        label: 'Copy Line Reference for Agent',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL],
        contextMenuGroupId: '9_cutcopypaste',
        run: (e) => void copyReference(e),
      });
    }
    return () => {
      for (const unbind of unbindTouch) unbind();
      ready = undefined;
      diff.setModel(null);
      diff.dispose();
      editor.dispose();
    };
  });

  $effect(() => {
    const key = wb.activeKey;
    untrack(() => void show(key));
  });

  $effect(() => {
    const reveal = wb.reveal;
    if (reveal) untrack(applyReveal);
  });

  $effect(() => {
    const open = new Set(wb.tabs.map((t) => t.path));
    untrack(() =>
      collect(open, (dead) => {
        const m = diff?.getModel();
        if (m && (dead.includes(m.original) || dead.includes(m.modified))) diff.setModel(null);
        if (editor?.getModel() && dead.includes(editor.getModel()!)) editor.setModel(null);
      }),
    );
    for (const key of [...viewStates.keys()]) {
      if (!wb.tabs.some((t) => t.key === key)) viewStates.delete(key);
    }
  });

  async function show(key: string | null) {
    if (shown?.kind === 'file') viewStates.set(shown.key, editor.saveViewState());
    const tab = wb.tabs.find((t) => t.key === key);
    if (!tab) {
      shown = null;
      editor.setModel(null);
      diff.setModel(null);
      return;
    }
    const doc = await getDoc(tab.path);
    if (wb.activeKey !== tab.key) return;

    if (tab.kind === 'file') {
      editor.setModel(doc.model);
      editor.updateOptions({ readOnly: doc.readonly });
      const vs = viewStates.get(tab.key);
      if (vs) editor.restoreViewState(vs);
      shown = { key: tab.key, kind: 'file', path: tab.path };
    } else {
      const original = await getHead(tab.path, doc.model.getLanguageId());
      if (wb.activeKey !== tab.key) return;
      diff.setModel({ original, modified: doc.model });
      diff.getModifiedEditor().updateOptions({ readOnly: doc.readonly });
      shown = { key: tab.key, kind: 'diff', path: tab.path };
    }
    await tick();
    (tab.kind === 'file' ? editor : diff.getModifiedEditor()).focus();
    applyReveal();
  }

  async function copyReference(ed: monaco.editor.ICodeEditor) {
    const sel = ed.getSelection();
    if (!sel || !shown) return;
    let { startLineNumber: start, endLineNumber: end } = sel;
    // A selection made by dragging over whole lines ends at column 1 of the following line.
    if (end > start && sel.endColumn === 1) end--;
    const file = wb.workspaceRoot ? `${wb.workspaceRoot}/${shown.path}` : shown.path;
    await copyText(`@${file}:${start === end ? start : `${start}-${end}`}`);
  }

  function applyReveal() {
    const r = wb.reveal;
    const tab = wb.active;
    if (!r || !tab || tab.path !== r.path || shown?.key !== tab.key) return;
    const target = tab.kind === 'file' ? editor : diff.getModifiedEditor();
    target.setPosition({ lineNumber: r.line, column: r.column });
    target.revealLineInCenter(r.line);
    target.focus();
    wb.reveal = null;
  }
</script>

<div class="editor split" class:hidden={shown?.kind !== 'file'}>
  <div class="main" bind:this={editorEl}></div>
  <ReviewPane editor={ready?.file} path={shown?.kind === 'file' ? shown.path : null} />
</div>
<div class="editor split" class:hidden={shown?.kind !== 'diff'}>
  <div class="main" bind:this={diffEl}></div>
  <ReviewPane editor={ready?.diff} path={shown?.kind === 'diff' ? shown.path : null} />
</div>
<style>
  .editor {
    position: absolute;
    inset: 0;
  }
  .split {
    display: flex;
  }
  .main {
    flex: 1;
    min-width: 0;
    position: relative;
  }
  .hidden {
    display: none;
  }
</style>
