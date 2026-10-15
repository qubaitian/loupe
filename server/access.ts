import type http from 'node:http';
import net from 'node:net';

/** Loopback, RFC 1918, Tailscale (CGNAT 100.64/10 and ULA fd7a:115c:a1e0::/48), IPv6 ULA and link-local. */
const DEFAULT_NETS = [
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '100.64.0.0/10',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
];

/** Hostname suffixes trusted in the Host header besides IP literals and single-label names. */
const HOST_SUFFIXES = ['.localhost', '.local', '.ts.net'];

export class Access {
  #nets = new net.BlockList();
  #trustForwarded: boolean;

  /** `trustForwarded`: honor X-Forwarded-For when the peer is loopback (the Vite dev proxy). */
  constructor(extra: string[], trustForwarded: boolean) {
    this.#trustForwarded = trustForwarded;
    for (const cidr of [...DEFAULT_NETS, ...extra]) {
      const [addr, prefix] = cidr.split('/');
      const family = net.isIPv6(addr) ? 'ipv6' : 'ipv4';
      if (!net.isIP(addr)) throw new Error(`invalid --allow network: ${cidr}`);
      this.#nets.addSubnet(addr, Number(prefix ?? (family === 'ipv6' ? 128 : 32)), family);
    }
  }

  allowsAddress(addr: string): boolean {
    const ip = addr.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '').replace(/%.*$/, '');
    const family = net.isIPv6(ip) ? 'ipv6' : net.isIPv4(ip) ? 'ipv4' : null;
    return family !== null && this.#nets.check(ip, family);
  }

  /** Returns a reason string when the request must be rejected. */
  check(req: http.IncomingMessage, websocket: boolean): string | null {
    const peer = req.socket.remoteAddress ?? '';
    if (!this.allowsAddress(peer)) return `address ${peer} not allowed`;
    if (this.#trustForwarded && isLoopback(peer)) {
      const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
      if (fwd && !this.allowsAddress(fwd)) return `address ${fwd} not allowed`;
    }

    const host = req.headers.host ?? '';
    if (!trustedHost(host)) return `host ${host} not allowed`;

    // Browsers always send Origin on WebSocket handshakes; reject cross-site pages.
    const origin = req.headers.origin;
    if (websocket && origin) {
      let originHost = '';
      try {
        originHost = new URL(origin).host;
      } catch {}
      if (originHost !== host) return `origin ${origin} not allowed`;
    }
    return null;
  }
}

function isLoopback(addr: string) {
  return addr === '::1' || /^(::ffff:)?127\./.test(addr);
}

/** Guards against DNS rebinding: only IP literals and local/tailnet names may appear in Host. */
function trustedHost(host: string): boolean {
  let name: string;
  try {
    name = new URL(`http://${host}`).hostname;
  } catch {
    return false;
  }
  if (name.startsWith('[')) return true;
  if (net.isIP(name)) return true;
  if (!name.includes('.')) return name !== '';
  return HOST_SUFFIXES.some((s) => name === s || name.endsWith(s));
}

