type Listener = (data: any) => void;
type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };
export type Status = 'connecting' | 'open' | 'closed' | 'forbidden' | 'workspace-error' | 'replaced';

class Rpc {
  status = $state<Status>('connecting');
  error = $state('');

  #ws: WebSocket | null = null;
  #seq = 0;
  #retry = 0;
  #pending = new Map<number, Pending>();
  #listeners = new Map<string, Set<Listener>>();
  #openHandlers = new Set<() => void>();

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = new URL(`${proto}://${location.host}/ws`);
    try {
      const folder = new URLSearchParams(location.search).get('folder')
        ?? (location.pathname === '/' ? null : decodeURIComponent(location.pathname));
      if (folder !== null) url.searchParams.set('folder', folder);
    } catch {
      this.error = 'The workspace URL contains an invalid path. Check its percent encoding.';
      this.status = 'workspace-error';
      return;
    }
    const ws = new WebSocket(url);
    this.#ws = ws;
    this.status = 'connecting';

    ws.onopen = () => {
      this.status = 'open';
      this.#retry = 0;
      for (const h of this.#openHandlers) h();
    };

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if ('event' in msg) {
        this.#listeners.get(msg.event)?.forEach((l) => l(msg.data));
        return;
      }
      const p = this.#pending.get(msg.id);
      if (!p) return;
      this.#pending.delete(msg.id);
      if ('error' in msg) p.reject(new Error(msg.error));
      else p.resolve(msg.result);
    };

    ws.onclose = (ev) => {
      for (const p of this.#pending.values()) p.reject(new Error('disconnected'));
      this.#pending.clear();
      if (ev.code === 4403) {
        this.status = 'forbidden';
        return;
      }
      // Another window took this workspace. Reconnecting on our own would take it back, and the two would keep swapping.
      if (ev.code === 4409) {
        this.status = 'replaced';
        return;
      }
      if (ev.code === 4404) {
        this.error = ev.reason || 'Workspace could not be opened.';
        this.status = 'workspace-error';
        return;
      }
      this.status = 'closed';
      setTimeout(() => this.connect(), Math.min(5000, 250 * 2 ** this.#retry++));
    };
  }

  call<T = any>(method: string, params?: unknown): Promise<T> {
    const ws = this.#ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('not connected'));
    const id = ++this.#seq;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Fire-and-forget call with no response. */
  notify(method: string, params?: unknown) {
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify({ method, params }));
  }

  on(event: string, listener: Listener): () => void {
    let set = this.#listeners.get(event);
    if (!set) this.#listeners.set(event, (set = new Set()));
    set.add(listener);
    return () => set.delete(listener);
  }

  /** Runs `handler` on every (re)connect, and immediately if already connected. */
  onOpen(handler: () => void): () => void {
    this.#openHandlers.add(handler);
    if (this.status === 'open') handler();
    return () => this.#openHandlers.delete(handler);
  }
}

export const rpc = new Rpc();
