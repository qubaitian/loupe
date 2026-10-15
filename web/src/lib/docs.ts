import { monaco } from './monaco';
import { rpc } from './rpc.svelte';
import { wb } from './workbench.svelte';

type ReadResult = { content?: string; hash?: string; binary?: boolean; tooLarge?: boolean };
type WriteResult = { hash?: string; conflict?: boolean };

const AUTOSAVE_DELAY = 1000;
const AUTOSAVE_MAX_WAIT = 5000;

export type Doc = {
  path: string;
  model: monaco.editor.ITextModel;
  /** Alternative version id at last save/load; differs from the model's when dirty. */
  saved: number;
  readonly: boolean;
  /** Hash of the on-disk content the model was last synced with. */
  hash: string | undefined;
  /** The file changed on disk while the model had unsaved edits. */
  conflict: boolean;
  /** Bumped on every successful write so in-flight reads started before it can be discarded. */
  gen: number;
  /** Tail of the write queue; never rejects. */
  saving: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
  pendingSince?: number;
  deleting?: boolean;
};

const docs = new Map<string, Doc>();
const loading = new Map<string, Promise<Doc>>();
const heads = new Map<string, monaco.editor.ITextModel>();

const fileUri = (path: string) => monaco.Uri.from({ scheme: 'file', path: '/' + path });
const headUri = (path: string) => monaco.Uri.from({ scheme: 'loupe-head', path: '/' + path });
const isDirty = (doc: Doc) => doc.model.getAlternativeVersionId() !== doc.saved;

async function read(path: string): Promise<{ text: string; readonly: boolean; hash?: string }> {
  try {
    const r = await rpc.call<ReadResult>('fs.read', { path });
    if (r.binary) return { text: '(binary file)', readonly: true };
    if (r.tooLarge) return { text: '(file too large to open)', readonly: true };
    return { text: r.content ?? '', readonly: false, hash: r.hash };
  } catch {
    return { text: '', readonly: true };
  }
}

function syncTabs(doc: Doc) {
  const dirty = isDirty(doc);
  for (const t of wb.tabs) {
    if (t.path !== doc.path) continue;
    t.dirty = dirty;
    t.conflict = doc.conflict;
  }
}

function schedule(doc: Doc) {
  clearTimeout(doc.timer);
  doc.timer = undefined;
  if (doc.deleting || doc.readonly || doc.conflict || doc.model.isDisposed() || !isDirty(doc)) {
    doc.pendingSince = undefined;
    return;
  }
  doc.pendingSince ??= Date.now();
  const wait = Math.min(AUTOSAVE_DELAY, AUTOSAVE_MAX_WAIT - (Date.now() - doc.pendingSince));
  doc.timer = setTimeout(() => void save(doc.path, true).catch(() => {}), Math.max(0, wait));
}

export function getDoc(path: string): Promise<Doc> {
  const existing = docs.get(path);
  if (existing) return Promise.resolve(existing);
  let p = loading.get(path);
  if (!p) {
    p = read(path).then(({ text, readonly, hash }) => {
      const model = monaco.editor.createModel(text, undefined, fileUri(path));
      const doc: Doc = {
        path,
        model,
        saved: model.getAlternativeVersionId(),
        readonly,
        hash,
        conflict: false,
        gen: 0,
        saving: Promise.resolve(),
      };
      model.onDidChangeContent(() => {
        syncTabs(doc);
        schedule(doc);
      });
      docs.set(path, doc);
      loading.delete(path);
      return doc;
    });
    loading.set(path, p);
  }
  return p;
}

export async function getHead(path: string, languageId: string): Promise<monaco.editor.ITextModel> {
  const text = await rpc.call<string>('git.head', { path }).catch(() => '');
  let model = heads.get(path);
  if (!model || model.isDisposed()) {
    model = monaco.editor.createModel(text, languageId, headUri(path));
    heads.set(path, model);
  } else if (model.getValue() !== text) {
    model.setValue(text);
  }
  return model;
}

/**
 * Writes the doc unless the file changed on disk since it was last synced. An explicit save of a
 * conflicted doc overwrites the disk; autosave skips clean and conflicted docs.
 */
export function save(path: string, auto = false): Promise<void> {
  const doc = docs.get(path);
  if (!doc || doc.readonly) return Promise.resolve();
  clearTimeout(doc.timer);
  doc.timer = undefined;
  doc.pendingSince = undefined;
  const p = doc.saving.then(() => write(doc, auto));
  doc.saving = p.catch(() => {});
  return p;
}

async function write(doc: Doc, auto: boolean) {
  if (doc.deleting || doc.model.isDisposed() || doc.readonly) return;
  if (auto && (doc.conflict || !isDirty(doc))) return;
  const version = doc.model.getAlternativeVersionId();
  const content = doc.model.getValue();
  const expect = doc.conflict ? undefined : doc.hash;
  const r = await rpc.call<WriteResult>('fs.write', { path: doc.path, content, expect });
  if (r.conflict) {
    doc.conflict = true;
    syncTabs(doc);
    void reload(doc);
    return;
  }
  doc.hash = r.hash;
  doc.saved = version;
  doc.conflict = false;
  doc.gen++;
  syncTabs(doc);
  schedule(doc);
}

/** Pulls the on-disk content into a clean doc; flags a conflict instead if the user has unsaved edits. */
async function reload(doc: Doc) {
  await doc.saving;
  if (doc.deleting) return;
  const gen = doc.gen;
  const { text, readonly, hash } = await read(doc.path);
  if (doc.deleting || doc.model.isDisposed() || doc.gen !== gen) return;
  if (hash !== undefined && hash === doc.hash) return;
  if (doc.model.getValue() === text) {
    doc.saved = doc.model.getAlternativeVersionId();
  } else if (isDirty(doc)) {
    doc.conflict = true;
    schedule(doc);
    syncTabs(doc);
    return;
  } else {
    doc.model.pushEditOperations([], [{ range: doc.model.getFullModelRange(), text }], () => null);
    doc.saved = doc.model.getAlternativeVersionId();
  }
  doc.hash = hash;
  doc.readonly = readonly;
  doc.conflict = false;
  schedule(doc);
  syncTabs(doc);
}

/** Discards local edits and reloads from disk. */
export async function revert(path: string) {
  const doc = docs.get(path);
  if (!doc) return;
  await doc.saving;
  doc.saved = doc.model.getAlternativeVersionId();
  doc.hash = undefined;
  doc.conflict = false;
  await reload(doc);
  syncTabs(doc);
}

/** Stops pending saves before deleting a file or folder, then closes its tabs. */
export async function deletePath(path: string) {
  const matches = (candidate: string) => candidate === path || candidate.startsWith(`${path}/`);
  await Promise.all([...loading].filter(([p]) => matches(p)).map(([, pending]) => pending));
  const affected = [...docs.values()].filter((doc) => matches(doc.path));
  const previous = affected.map((doc) => ({ doc, readonly: doc.readonly }));
  for (const doc of affected) {
    clearTimeout(doc.timer);
    doc.timer = undefined;
    doc.pendingSince = undefined;
    doc.deleting = true;
    doc.readonly = true;
    doc.gen++;
  }
  try {
    await Promise.all(affected.map((doc) => doc.saving));
    await rpc.call('fs.delete', { path });
  } catch (error) {
    for (const { doc, readonly } of previous) {
      doc.deleting = false;
      doc.readonly = readonly;
      schedule(doc);
    }
    throw error;
  }
  for (const tab of [...wb.tabs]) {
    if (!matches(tab.path)) continue;
    tab.dirty = false;
    wb.close(tab.key);
  }
}

/** Disposes models no open tab refers to. Returns the models about to be disposed so callers can detach them first. */
export function collect(openPaths: Set<string>, detach: (models: monaco.editor.ITextModel[]) => void) {
  const dead: monaco.editor.ITextModel[] = [];
  for (const [path, doc] of docs) if (!openPaths.has(path)) dead.push(doc.model);
  for (const [path, model] of heads) if (!openPaths.has(path)) dead.push(model);
  if (!dead.length) return;
  detach(dead);
  for (const [path, doc] of [...docs]) {
    if (openPaths.has(path)) continue;
    clearTimeout(doc.timer);
    docs.delete(path);
  }
  for (const path of [...heads.keys()]) if (!openPaths.has(path)) heads.delete(path);
  for (const m of dead) m.dispose();
}

rpc.on('fs.changed', ({ paths, all }: { paths: string[]; all?: boolean }) => {
  const changed = new Set(paths);
  for (const doc of docs.values()) if (all || changed.has(doc.path)) void reload(doc);
});

let headTimer: ReturnType<typeof setTimeout> | undefined;
rpc.on('git.changed', () => {
  clearTimeout(headTimer);
  headTimer = setTimeout(() => {
    for (const [path, model] of heads) void getHead(path, model.getLanguageId());
  }, 300);
});

rpc.onOpen(() => {
  for (const doc of docs.values()) void reload(doc);
});

window.addEventListener('blur', () => {
  for (const doc of docs.values()) if (doc.timer !== undefined) void save(doc.path, true).catch(() => {});
});
