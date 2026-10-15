// Regenerates web/src/lib/devicons.json from nvim-web-devicons (MIT): file name/extension -> [Nerd Font glyph, color].
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REV = '58447c1fca354bbf184425e4a8d01deecbd6f3c4';
const base = `https://raw.githubusercontent.com/nvim-tree/nvim-web-devicons/${REV}/lua/nvim-web-devicons/default`;

async function table(file: string): Promise<Record<string, [string, string]>> {
  const res = await fetch(`${base}/${file}`);
  if (!res.ok) throw new Error(`devicons: ${file}: ${res.status}`);
  const entries: Record<string, [string, string]> = {};
  for (const m of (await res.text()).matchAll(/\["([^"]+)"\]\s*=\s*\{\s*icon\s*=\s*"([^"]+)",\s*color\s*=\s*"(#[0-9A-Fa-f]{6})"/g)) {
    entries[m[1]] = [m[2], m[3]];
  }
  return entries;
}

const data = {
  names: await table('icons_by_filename.lua'),
  exts: await table('icons_by_file_extension.lua'),
};
writeFileSync(join(import.meta.dirname, '../web/src/lib/devicons.json'), JSON.stringify(data) + '\n');
console.log(`devicons: ${Object.keys(data.names).length} names, ${Object.keys(data.exts).length} extensions`);
