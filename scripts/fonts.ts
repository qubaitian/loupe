// Downloads Maple Mono NF CN and splits it into unicode-range chunks under web/fonts/.
// Skips work that is already done, so it is cheap to run before every dev/build.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const VERSION = 'v7.9';
const ZIP = 'MapleMono-NF-CN-unhinted.zip';
const FAMILY = 'Maple Mono NF CN';
const STYLES = [
  { name: 'Regular', weight: '400', style: 'normal' },
  { name: 'Italic', weight: '400', style: 'italic' },
  { name: 'Bold', weight: '700', style: 'normal' },
  { name: 'BoldItalic', weight: '700', style: 'italic' },
];

const root = join(import.meta.dirname, '..');
const out = join(root, 'web/fonts');
const cache = join(root, 'node_modules/.cache/maple-font', VERSION);

const pending = STYLES.filter((s) => !existsSync(join(out, s.name, 'result.css')));
if (pending.length) {
  mkdirSync(cache, { recursive: true });
  const zip = join(cache, ZIP);
  if (!existsSync(zip)) {
    const url = `https://github.com/subframe7536/maple-font/releases/download/${VERSION}/${ZIP}`;
    console.log(`fonts: downloading ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fonts: ${res.status} ${res.statusText}`);
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  }
  for (const s of pending) {
    const ttf = `MapleMono-NF-CN-${s.name}.ttf`;
    if (!existsSync(join(cache, ttf))) execFileSync('unzip', ['-o', '-j', '-q', zip, ttf, '-d', cache]);
    console.log(`fonts: splitting ${ttf}`);
    rmSync(join(out, s.name), { recursive: true, force: true });
    // cn-font-split's install script fetches a native binary, so it stays out of package.json.
    // It aborts on exit (SIGABRT) even after writing everything, so success is judged by its output.
    spawnSync(
      'npx',
      [
        '-y',
        'cn-font-split@7.4.3',
        'run',
        '-i', join(cache, ttf),
        '-o', join(out, s.name),
        '--css.fontFamily', FAMILY,
        '--css.fontWeight', s.weight,
        '--css.fontStyle', s.style,
        '--css.fontDisplay', 'swap',
        '--testHtml', 'false',
        '--reporter', 'false',
      ],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    );
    if (!existsSync(join(out, s.name, 'result.css'))) throw new Error(`fonts: splitting ${ttf} failed`);
  }
}
