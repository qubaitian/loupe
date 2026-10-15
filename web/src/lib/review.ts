import { rpc } from './rpc.svelte';

/** A review note anchored to a 1-based line range of the working-tree file. */
export type Note = { start: number; end: number; text: string };

const HEADING = /^##\s+L?(\d+)(?:\s*[-–]\s*L?(\d+))?\s*$/;

/** Notes for `foo/bar.ts` live in `.agents/foo/bar.ts.md`, one `## L12-30` section per note. */
export const reviewPath = (path: string) => `.agents/${path}.md`;

/** Files under `.agents` (notes, terminal files) do not get side notes themselves. */
export const isNotePath = (path: string) => /(^|\/)\.agents(?:\/|$)/.test(path);

export function parseReview(src: string): Note[] {
  const notes: Note[] = [];
  let cur: Note | null = null;
  for (const line of src.split('\n')) {
    const m = HEADING.exec(line);
    if (m) {
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : a;
      cur = { start: Math.max(1, Math.min(a, b)), end: Math.max(a, b), text: '' };
      notes.push(cur);
    } else if (cur) {
      cur.text += line + '\n';
    }
  }
  for (const n of notes) n.text = n.text.trim();
  return notes.sort((a, b) => a.start - b.start);
}

export async function loadReview(path: string): Promise<Note[]> {
  if (isNotePath(path)) return [];
  try {
    const r = await rpc.call<{ content?: string }>('fs.read', { path: reviewPath(path) });
    return r.content ? parseReview(r.content) : [];
  } catch {
    return [];
  }
}
