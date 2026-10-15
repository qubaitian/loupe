import devicons from './devicons.json';

export type Icon = { glyph: string; color: string };

/** Entries are `[glyph, color]`. */
const names: Record<string, string[]> = devicons.names;
const exts: Record<string, string[]> = devicons.exts;

const FILE: Icon = { glyph: '\ue64e', color: '#6d8086' }; // nf-seti-default
const FOLDER: Icon = { glyph: '\ue5ff', color: '#90a4ae' }; // nf-custom-folder
const FOLDER_OPEN: Icon = { glyph: '\ue5fe', color: '#90a4ae' }; // nf-custom-folder_open

function icon(entry: string[] | undefined): Icon | undefined {
  return entry && { glyph: entry[0], color: entry[1] };
}

export function fileIcon(name: string): Icon {
  const lower = name.toLowerCase();
  let found = icon(names[name] ?? names[lower]);
  for (let i = name.indexOf('.'); !found && i !== -1; i = name.indexOf('.', i + 1)) {
    found = icon(exts[name.slice(i + 1)] ?? exts[lower.slice(i + 1)]);
  }
  return found ?? FILE;
}

export function folderIcon(open: boolean): Icon {
  return open ? FOLDER_OPEN : FOLDER;
}
