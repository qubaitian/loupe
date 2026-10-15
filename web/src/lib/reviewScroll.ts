export type ScrollAnchor = { code: number; note: number };

/** Match note starts to code lines, interpolating between them and both scroll limits. */
export function reviewScrollTop(
  scrollTop: number,
  codeMax: number,
  noteMax: number,
  anchors: readonly ScrollAnchor[],
): number {
  if (codeMax <= 0 || noteMax <= 0) return 0;
  const position = Math.max(0, Math.min(scrollTop, codeMax));
  let previous: ScrollAnchor = { code: 0, note: 0 };
  const points = anchors.filter((anchor) => anchor.code < codeMax);
  for (const anchor of [...points, { code: codeMax, note: noteMax }]) {
    // Folded lines and repeated ranges can share a code position.
    if (anchor.code <= previous.code) continue;
    const next = { code: anchor.code, note: Math.max(previous.note, Math.min(anchor.note, noteMax)) };
    if (position <= next.code) {
      const progress = (position - previous.code) / (next.code - previous.code);
      return previous.note + progress * (next.note - previous.note);
    }
    previous = next;
  }
  return noteMax;
}
