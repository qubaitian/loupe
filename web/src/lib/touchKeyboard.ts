/**
 * Phones raise the keyboard whenever an editable element gains focus, programmatic focus
 * included (Monaco refocusing after a model swap, a search hit being revealed), and again
 * when a swipe ends while one is focused. On touch devices only a tap may raise it: a tap
 * on a native input, or one that a component claims through `onTap` + `showKeyboard`.
 */

const TAP_SLOP = 8;
const TAP_MS = 500;
const NON_TEXT = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);

const tapHandlers = new Map<HTMLElement, (t: Touch) => void>();
let granted: HTMLElement | null = null;
let start: { id: number; x: number; y: number; time: number; target: EventTarget | null } | null = null;

function editable(el: EventTarget | null): el is HTMLElement {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !NON_TEXT.has(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}

function suppress(el: HTMLElement) {
  if (el.inputMode === 'none') return;
  el.dataset.inputMode = el.inputMode;
  el.inputMode = 'none';
}

function release(el: HTMLElement) {
  const mode = el.dataset.inputMode;
  delete el.dataset.inputMode;
  if (mode) el.inputMode = mode;
  else el.removeAttribute('inputmode');
}

/** Focus `el` with the keyboard allowed. Call only from a tap handler. */
export function showKeyboard(el: HTMLElement, focus: () => void = () => el.focus()) {
  // The keyboard only appears on a focus transition, so refocus an already focused element.
  if (document.activeElement === el) el.blur();
  granted = el;
  release(el);
  focus();
}

/** Calls `fn` for taps starting inside `root`, before the page's own touch handlers run. */
export function onTap(root: HTMLElement, fn: (t: Touch) => void): () => void {
  tapHandlers.set(root, fn);
  return () => tapHandlers.delete(root);
}

export function installTouchKeyboard() {
  if (navigator.maxTouchPoints < 1) return;
  const options = { capture: true, passive: true };
  const browsing = () => {
    start = null;
    // Also hides a keyboard that is up: browsing drops back to no keyboard until the next tap.
    if (editable(document.activeElement)) suppress(document.activeElement);
  };

  document.addEventListener('focusin', (e) => {
    if (editable(e.target) && e.target !== granted) suppress(e.target);
  }, true);

  document.addEventListener('touchstart', (e) => {
    granted = null;
    if (e.touches.length !== 1) return browsing();
    const t = e.touches[0];
    start = { id: t.identifier, x: t.clientX, y: t.clientY, time: Date.now(), target: t.target };
  }, options);

  document.addEventListener('touchmove', (e) => {
    if (!start) return;
    const t = e.touches[0];
    if (e.touches.length !== 1 || t.identifier !== start.id || Math.hypot(t.clientX - start.x, t.clientY - start.y) >= TAP_SLOP) browsing();
  }, options);

  document.addEventListener('touchend', (e) => {
    const s = start;
    start = null;
    const t = e.changedTouches[0];
    if (!s || e.touches.length || !t || t.identifier !== s.id || Date.now() - s.time >= TAP_MS ||
      Math.hypot(t.clientX - s.x, t.clientY - s.y) >= TAP_SLOP) return;
    if (editable(s.target)) {
      // The browser focuses it (or re-shows the keyboard if already focused) after touchend.
      granted = s.target;
      release(s.target);
      return;
    }
    for (const [root, fn] of tapHandlers) {
      if (s.target instanceof Node && root.contains(s.target)) fn(t);
    }
  }, options);

  document.addEventListener('touchcancel', () => (start = null), options);
}
