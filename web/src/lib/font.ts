import '../../fonts/Regular/result.css';
import '../../fonts/Italic/result.css';
import '../../fonts/Bold/result.css';
import '../../fonts/BoldItalic/result.css';

/** Must match `--font` in app.css; Monaco and xterm measure glyphs on canvas and need the literal stack. */
export const fontFamily = '"Maple Mono NF CN", monospace';

/**
 * xterm and Monaco cache glyph metrics on creation, so the face has to be loaded before either is built.
 * The font is split by unicode-range, so the sample text decides which chunks get fetched up front.
 */
export function loadFonts(): Promise<unknown> {
  const sample = 'Wm0 中文';
  return Promise.all(['400', '700'].map((w) => document.fonts.load(`${w} 13px "Maple Mono NF CN"`, sample))).catch(() => {});
}
