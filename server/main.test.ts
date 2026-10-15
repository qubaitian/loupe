import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { WebSocket } from 'ws';
import { Workspace } from './workspace.ts';

async function connect(base: string, folder?: string) {
  const url = new URL('/ws', base);
  url.protocol = 'ws:';
  if (folder !== undefined) url.searchParams.set('folder', folder);
  const ws = new WebSocket(url, { origin: base });
  const events: { event: string; data: any }[] = [];
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  let id = 0;
  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if ('event' in msg) events.push(msg);
    else {
      const request = pending.get(msg.id);
      pending.delete(msg.id);
      if ('error' in msg) request?.reject(new Error(msg.error));
      else request?.resolve(msg.result);
    }
  });
  await once(ws, 'open');
  return {
    ws,
    events,
    call(method: string, params?: unknown): Promise<any> {
      return new Promise((resolve, reject) => {
        pending.set(++id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

async function eventually(check: () => Promise<boolean> | boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await delay(50);
  }
  assert.fail('Timed out waiting for workspace event');
}

test('URL-selected workspaces keep files, git, events and terminals isolated', { timeout: 30_000 }, async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'loupe-workspaces-'));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const alpha = path.join(tmp, 'alpha');
  const beta = path.join(tmp, 'beta 中文 #?%');
  const alias = path.join(tmp, 'alias');
  for (const dir of [alpha, beta]) {
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'shared.txt'), path.basename(dir));
    execFileSync('git', ['init', '-q', '-b', path.basename(dir) === 'alpha' ? 'alpha' : 'beta'], { cwd: dir });
    execFileSync('git', ['add', 'shared.txt'], { cwd: dir });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'Initial'], { cwd: dir });
  }
  await fs.symlink(alpha, alias, 'dir');
  const canonicalAlpha = await fs.realpath(alpha);
  const canonicalBeta = await fs.realpath(beta);
  // The server writes terminal files under $HOME, so give it its own.
  const home = path.join(tmp, 'home');
  await fs.mkdir(home);

  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = (listener.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, [path.join(import.meta.dirname, 'main.ts'), alpha, '--port', String(port), '--host', '127.0.0.1'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOME: home },
  });
  t.after(async () => {
    if (proc.exitCode !== null || proc.signalCode !== null) return;
    const exited = once(proc, 'exit');
    proc.kill('SIGTERM');
    await exited;
  });
  let output = '';
  proc.stdout.on('data', (chunk) => { output += chunk; });
  proc.stderr.on('data', (chunk) => { output += chunk; });
  await eventually(() => {
    assert.equal(proc.exitCode, null, output);
    return output.includes(base);
  });

  let a = await connect(base);
  const b = await connect(base, beta);
  t.after(() => { a.ws.terminate(); b.ws.terminate(); });

  await t.test('default and encoded folder select the expected roots', async () => {
    assert.equal((await a.call('workspace.info')).root, canonicalAlpha);
    assert.equal((await b.call('workspace.info')).root, canonicalBeta);
    assert.equal((await a.call('fs.read', { path: 'shared.txt' })).content, 'alpha');
    assert.equal((await b.call('fs.read', { path: 'shared.txt' })).content, path.basename(beta));
    assert.equal((await a.call('git.status')).branch, 'alpha');
    assert.equal((await b.call('git.status')).branch, 'beta');
    assert.deepEqual(await b.call('search.files'), ['shared.txt']);
    await assert.rejects(b.call('fs.read', { path: '../alpha/shared.txt' }), /outside workspace/);
  });

  await t.test('file changes are only broadcast to their own workspace', async () => {
    a.events.length = 0;
    b.events.length = 0;
    await a.call('fs.write', { path: 'shared.txt', content: 'Changed alpha' });
    await eventually(() => a.events.some((e) => e.event === 'fs.changed' && e.data.paths.includes('shared.txt')));
    assert.equal((await b.call('fs.read', { path: 'shared.txt' })).content, path.basename(beta));
    assert.equal(b.events.some((e) => e.event === 'fs.changed'), false);
  });

  await t.test('deletion removes files and folders and protects workspace boundaries', async () => {
    await a.call('fs.write', { path: 'remove.txt', content: 'Remove me' });
    await a.call('fs.write', { path: 'remove/nested/file.txt', content: 'Remove me too' });
    a.events.length = 0;
    await a.call('fs.delete', { path: 'remove.txt' });
    await assert.rejects(fs.stat(path.join(alpha, 'remove.txt')), { code: 'ENOENT' });
    await eventually(() => a.events.some((e) => e.event === 'fs.changed' && e.data.all && e.data.paths.includes('remove.txt')));
    assert.ok(a.events.some((e) => e.event === 'git.changed'));
    await a.call('fs.delete', { path: 'remove' });
    await assert.rejects(fs.stat(path.join(alpha, 'remove')), { code: 'ENOENT' });

    for (const target of ['', null, 1]) {
      await assert.rejects(a.call('fs.delete', { path: target }), /path is required/);
    }
    await assert.rejects(a.call('fs.delete', { path: '.' }), /workspace root/);
    await assert.rejects(a.call('fs.delete', { path: '../beta 中文 #?%/shared.txt' }), /outside workspace/);
    for (const target of ['.git', '.git/config']) {
      await assert.rejects(a.call('fs.delete', { path: target }), /Git metadata/);
    }
    await assert.rejects(a.call('fs.delete', { path: 'missing.txt' }), /ENOENT/);

    await fs.symlink(beta, path.join(alpha, 'outside'), 'dir');
    await assert.rejects(a.call('fs.delete', { path: 'outside/shared.txt' }), /outside workspace/);
    await a.call('fs.delete', { path: 'outside' });
    await assert.rejects(fs.lstat(path.join(alpha, 'outside')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(beta, 'shared.txt'), 'utf8'), path.basename(beta));

    await fs.symlink(path.join(alpha, '.git'), path.join(alpha, 'metadata'), 'dir');
    await assert.rejects(a.call('fs.delete', { path: 'metadata/config' }), /Git metadata/);
    await a.call('fs.delete', { path: 'metadata' });
    assert.ok((await fs.stat(path.join(alpha, '.git/config'))).isFile());
  });

  await t.test('terminals use the selected cwd and survive reconnects and aliases', async () => {
    const term = await a.call('term.create', { cols: 200, rows: 24 });
    assert.deepEqual(await b.call('term.list'), []);
    await a.call('term.input', { id: term.id, data: "printf '\\nLOUPE_CWD=%s\\n' \"$PWD\"\n" });
    await eventually(async () => (await a.call('term.list'))[0]?.data.includes(`LOUPE_CWD=${canonicalAlpha}`));
    // Only one client per workspace: the newer connection (here through a symlink) replaces the older one.
    const replaced = once(a.ws, 'close');
    a = await connect(base, alias);
    assert.equal((await replaced)[0], 4409);
    assert.equal((await a.call('workspace.info')).root, canonicalAlpha);
    assert.equal((await a.call('term.list'))[0].id, term.id);
    const file = path.join(home, '.loupe/terminals', canonicalAlpha, `${term.id}.txt`);
    assert.equal((await a.call('workspace.info')).terminalDir, path.dirname(file));
    // Output is written to the terminal file without anyone asking.
    await eventually(async () => (await fs.readFile(file, 'utf8').catch(() => '')).includes(`LOUPE_CWD=${canonicalAlpha}`));
    await assert.rejects(fs.stat(path.join(home, '.loupe/terminals', canonicalBeta, `${term.id}.txt`)), { code: 'ENOENT' });
    await assert.rejects(fs.stat(path.join(alpha, '.agents')), { code: 'ENOENT' });
    await a.call('term.input', { id: term.id, data: "printf 'LOUPE_%s\\n' SAVED\n" });
    await eventually(async () => (await a.call('term.list'))[0]?.data.includes('LOUPE_SAVED'));
    await a.call('term.save', { id: term.id });
    assert.match(await fs.readFile(file, 'utf8'), /^LOUPE_SAVED$/m);
    await assert.rejects(b.call('term.save', { id: term.id }), /no terminal/);
    await a.call('term.kill', { id: term.id });
    await eventually(async () => (await a.call('term.list')).length === 0);
    // The file is kept after the terminal exits.
    assert.match(await fs.readFile(file, 'utf8'), /^LOUPE_SAVED$/m);
  });

  await t.test('URL-selected workspaces close once idle but outlive their running terminals', async () => {
    const gamma = path.join(tmp, 'gamma');
    await fs.mkdir(gamma);
    const canonicalGamma = await fs.realpath(gamma);
    const closed = `closed workspace ${canonicalGamma}`;

    const first = await connect(base, gamma);
    const term = await first.call('term.create', { cols: 80, rows: 24 });
    first.ws.close();
    await once(first.ws, 'close');
    const second = await connect(base, gamma);
    try {
      assert.equal((await second.call('term.list'))[0]?.id, term.id);
      assert.equal(output.includes(closed), false);
      await second.call('term.kill', { id: term.id });
      await eventually(async () => (await second.call('term.list')).length === 0);
      assert.equal(output.includes(closed), false);
    } finally {
      second.ws.close();
    }
    await eventually(() => output.includes(closed));
    assert.equal((await a.call('workspace.info')).root, canonicalAlpha);
  });

  await t.test('invalid folders close with a distinct non-retryable code', async () => {
    for (const folder of [path.join(tmp, 'missing'), path.join(alpha, 'shared.txt'), 'relative/path', '']) {
      const client = await connect(base, folder);
      const [code, reason] = await once(client.ws, 'close');
      assert.equal(code, 4404);
      assert.match(String(reason), /Workspace could not be opened/);
    }
    assert.equal((await a.call('workspace.info')).root, canonicalAlpha);
  });

  await t.test('deep links serve the app with absolute asset URLs', async () => {
    for (const url of [new URL(encodeURI(beta).replace(/#/g, '%23').replace(/\?/g, '%3F'), base), new URL(`/?folder=${encodeURIComponent(beta)}`, base)]) {
      const response = await fetch(url);
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, /id="app"/);
      const asset = html.match(/src="(\/assets\/[^\"]+\.js)"/);
      assert.ok(asset);
      assert.equal((await fetch(new URL(asset[1], base))).status, 200);
    }
    assert.equal((await fetch(`${base}/%ZZ`)).status, 400);
    assert.equal((await fetch(base)).status, 200);
  });
});

test('filesystem roots can resolve child paths', () => {
  const root = path.parse(process.cwd()).root;
  const workspace = new Workspace(root);
  assert.equal(workspace.resolve('tmp'), path.join(root, 'tmp'));
});
