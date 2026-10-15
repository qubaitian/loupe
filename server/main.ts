import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { WebSocketServer } from 'ws';
import { Access } from './access.ts';
import { registerFiles } from './files.ts';
import { registerGit } from './git.ts';
import { Hub } from './hub.ts';
import { registerSearch } from './search.ts';
import { registerTerminals, terminalDir } from './terminals.ts';
import { Workspace } from './workspace.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string', default: '4100' },
    host: { type: 'string' },
    allow: { type: 'string', multiple: true, default: [] },
    dev: { type: 'boolean', default: false },
  },
});

const workspace = new Workspace(positionals[0] ?? process.cwd());
const port = Number(values.port);
// In dev, Vite is the network-facing server and proxies /ws to us over loopback.
const host = values.host ?? (values.dev ? '127.0.0.1' : undefined);
const access = new Access(values.allow, values.dev);
const distDir = path.resolve(import.meta.dirname, '../dist');

type Session = { hub: Hub; terminals: () => number; dispose: () => void };
const sessions = new Map<string, Session>();

function sessionFor(ws: Workspace) {
  const existing = sessions.get(ws.root);
  if (existing) return existing;
  const hub = new Hub();
  hub.on('workspace.info', () => ({ name: ws.name, root: ws.root, terminalDir: terminalDir(ws) }));
  const stopWatching = registerFiles(hub, ws);
  registerGit(hub, ws);
  registerSearch(hub, ws);
  const terminals = registerTerminals(hub, ws, () => release(ws.root));
  const session = { hub, terminals: terminals.count, dispose: () => { stopWatching(); terminals.kill(); } };
  sessions.set(ws.root, session);
  return session;
}

/**
 * Closes a URL-selected workspace once no client is connected and no terminal is running,
 * so every folder ever opened doesn't keep a recursive watcher alive. The startup workspace stays.
 */
function release(root: string) {
  const session = sessions.get(root);
  if (!session || root === workspace.root || session.hub.connections || session.terminals()) return;
  sessions.delete(root);
  session.dispose();
  console.log(`closed workspace ${root}`);
}

sessionFor(workspace);

const server = http.createServer((req, res) => {
  const denied = access.check(req, false);
  if (denied) {
    res.writeHead(403).end(`forbidden: ${denied}`);
    return;
  }
  if (values.dev) {
    res.writeHead(404).end('dev mode: open the vite server instead');
    return;
  }
  serveStatic(req, res);
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  const denied = access.check(req, true);
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (denied) {
      console.warn(`rejected websocket: ${denied}`);
      ws.close(4403, 'forbidden');
      return;
    }
    try {
      const folder = url.searchParams.get('folder');
      if (folder !== null && !path.isAbsolute(folder)) throw new Error('folder must be an absolute path');
      const selected = folder === null ? workspace : new Workspace(folder);
      sessionFor(selected).hub.attach(ws);
      ws.on('close', () => release(selected.root));
    } catch (e) {
      console.warn(`could not open workspace: ${e instanceof Error ? e.message : String(e)}`);
      ws.close(4404, 'Workspace could not be opened. Check that the folder is an existing, readable directory on the server.');
    }
  });
});

server.listen(port, host, () => {
  console.log(`loupe  ${workspace.root}`);
  for (const url of listenUrls()) console.log(`     ${url}`);
});

function listenUrls(): string[] {
  const p = values.dev ? 5173 : port;
  if (values.dev) return [`http://localhost:${p}`];
  if (host && host !== '0.0.0.0' && host !== '::') return [`http://${host.includes(':') ? `[${host}]` : host}:${p}`];
  const urls = [`http://localhost:${p}`];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.internal || a.family !== 'IPv4' || !access.allowsAddress(a.address)) continue;
      urls.push(`http://${a.address}:${p}`);
    }
  }
  return urls;
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    for (const session of sessions.values()) session.dispose();
    process.exit(0);
  });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('invalid URL path encoding');
    return;
  }
  let file = path.join(distDir, pathname);
  if (!file.startsWith(distDir + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(distDir, 'index.html');
  }
  if (!fs.existsSync(file)) {
    res.writeHead(500).end('dist/ not found, run `npm run build` first');
    return;
  }
  const immutable = file.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}
