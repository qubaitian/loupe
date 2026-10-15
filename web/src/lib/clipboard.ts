export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // navigator.clipboard only exists in secure contexts (https or localhost).
    const focused = document.activeElement as HTMLElement | null;
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    focused?.focus();
  }
}
