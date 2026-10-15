import fsp from 'node:fs/promises';
import path from 'node:path';
import serialize from '@xterm/addon-serialize';
import type { SerializeAddon } from '@xterm/addon-serialize';
import unicode11 from '@xterm/addon-unicode11';
import headless from '@xterm/headless';
import type { Terminal as HeadlessTerminal } from '@xterm/headless';
import pty from 'node-pty';
import type { IPty } from 'node-pty';
import type { Hub } from './hub.ts';
import type { Workspace } from './workspace.ts';

/** Must match the client's scrollback so line numbers in terminal files match the client's buffer. */
const SCROLLBACK = 10000;
/** Output is written to the terminal file once it has been quiet this long... */
const SAVE_DELAY = 300;
/** ...or at least this often while output keeps coming. */
const SAVE_MAX_DELAY = 2000;

/**
 * Each pty is mirrored into a headless xterm so a (re)attaching client gets the
 * current screen state instead of a replay of raw output. Raw replay re-triggers
 * the terminal queries (cursor position, device attributes, colors) inside it,
 * and the client's answers end up typed into the running program.
 */
type Term = {
  id: number;
  proc: IPty;
  screen: HeadlessTerminal;
  serializer: SerializeAddon;
  /** Sequence number of the last output chunk, so clients can drop chunks already in a snapshot. */
  seq: number;
  /** DEC private modes the serialize addon doesn't restore. */
  sgrMouse: boolean;
  cursorHidden: boolean;
  /** Pending write to the terminal file, and when the first unsaved output arrived. */
  saveTimer?: NodeJS.Timeout;
  dirtySince?: number;
  /** Writes are chained so an older text never lands after a newer one. */
  saving: Promise<void>;
};

function trackModes(term: Term) {
  const update = (params: (number | number[])[], on: boolean) => {
    for (const p of params) {
      if (p === 1006) term.sgrMouse = on;
      else if (p === 25) term.cursorHidden = !on;
    }
    return false;
  };
  term.screen.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (p) => update(p, true));
  term.screen.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (p) => update(p, false));
}

function snapshot(term: Term) {
  return new Promise<{ id: number; seq: number; cols: number; rows: number; data: string }>((resolve) => {
    const seq = term.seq;
    // The callback fires once everything written so far has been parsed, and before later chunks are.
    term.screen.write('', () => {
      let data = term.serializer.serialize({ scrollback: SCROLLBACK });
      if (term.sgrMouse) data += '\x1b[?1006h';
      if (term.cursorHidden) data += '\x1b[?25l';
      resolve({ id: term.id, seq, cols: term.screen.cols, rows: term.screen.rows, data });
    });
  });
}

/**
 * Plain text of the active buffer. Soft-wrapped rows are joined, so file lines are logical lines rather than screen rows.
 * The client computes line numbers for `@file:start-end` the same way, so keep both in sync.
 */
function render(screen: HeadlessTerminal) {
  const buf = screen.buffer.active;
  const lines: string[] = [];
  for (let y = 0; y < buf.length; y++) {
    const row = buf.getLine(y);
    const text = row?.translateToString(!buf.getLine(y + 1)?.isWrapped) ?? '';
    if (row?.isWrapped && lines.length) lines[lines.length - 1] += text;
    else lines.push(text);
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.map((l) => l.trimEnd()).join('\n') + '\n';
}

/** `onExit` runs after a terminal's process has exited and it was removed from `count()`. */
export function registerTerminals(hub: Hub, ws: Workspace, onExit: () => void) {
  const terms = new Map<number, Term>();
  let nextId = 0;

  /**
   * Writes the terminal's text to `.agents/terminals/<id>.txt` so an agent can read it.
   * Resolves once everything written to the pty so far is in the file.
   */
  const save = (term: Term) => {
    clearTimeout(term.saveTimer);
    term.saveTimer = undefined;
    term.dirtySince = undefined;
    const file = ws.resolve(`.agents/terminals/${term.id}.txt`);
    // Rendered once the output so far has been parsed.
    const text = new Promise<string>((resolve) => term.screen.write('', () => resolve(render(term.screen))));
    term.saving = term.saving.then(async () => {
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, await text);
    }).catch((err) => console.error(`terminal ${term.id}: cannot write ${file}:`, err));
    return term.saving;
  };

  /** Debounces saves while output streams, but never waits longer than SAVE_MAX_DELAY. */
  const scheduleSave = (term: Term) => {
    // Output can still arrive after exit, when the final save already owns the screen.
    if (!terms.has(term.id)) return;
    const now = Date.now();
    term.dirtySince ??= now;
    clearTimeout(term.saveTimer);
    const delay = Math.min(SAVE_DELAY, term.dirtySince + SAVE_MAX_DELAY - now);
    term.saveTimer = setTimeout(() => void save(term), Math.max(0, delay));
  };

  hub.on('term.create', ({ cols = 80, rows = 24 }: { cols?: number; rows?: number }) => {
    const id = ++nextId;
    const shell = process.env.SHELL || '/bin/zsh';
    const proc = pty.spawn(shell, ['-l'], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: ws.root,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'loupe' },
    });
    const screen = new headless.Terminal({ cols, rows, scrollback: SCROLLBACK, allowProposedApi: true });
    const serializer = new serialize.SerializeAddon();
    screen.loadAddon(serializer);
    screen.loadAddon(new unicode11.Unicode11Addon());
    screen.unicode.activeVersion = '11';

    const term: Term = { id, proc, screen, serializer, seq: 0, sgrMouse: false, cursorHidden: false, saving: Promise.resolve() };
    trackModes(term);
    terms.set(id, term);

    proc.onData((data) => {
      screen.write(data);
      hub.emit('term.data', { id, seq: ++term.seq, data });
      scheduleSave(term);
    });
    proc.onExit(() => {
      terms.delete(id);
      // The file is kept after exit: the last output is often what matters.
      // The screen is disposed only after the final text has been rendered from it.
      void save(term).finally(() => screen.dispose());
      hub.emit('term.exit', { id });
      onExit();
    });
    return { id };
  });

  hub.on('term.list', () => Promise.all([...terms.values()].map(snapshot)));

  hub.on('term.input', ({ id, data, binary }: { id: number; data: string; binary?: boolean }) => {
    terms.get(id)?.proc.write(binary ? Buffer.from(data, 'binary') : data);
  });

  hub.on('term.resize', ({ id, cols, rows }: { id: number; cols: number; rows: number }) => {
    const term = terms.get(id);
    if (!term || !(cols > 0 && rows > 0)) return;
    if (cols === term.screen.cols && rows === term.screen.rows) return;
    term.proc.resize(cols, rows);
    term.screen.resize(cols, rows);
  });

  hub.on('term.kill', ({ id }: { id: number }) => {
    terms.get(id)?.proc.kill();
  });

  /** Saves a terminal file now, so a reference copied by the client points at current text. */
  hub.on('term.save', async ({ id }: { id: number }) => {
    const term = terms.get(id);
    if (!term) throw new Error(`no terminal ${id}`);
    await save(term);
  });

  return {
    count: () => terms.size,
    kill: () => {
      for (const t of terms.values()) t.proc.kill();
    },
  };
}
