import { WebSocket } from 'ws';

export type Handler = (params: any) => unknown;

export class Hub {
  private handlers = new Map<string, Handler>();
  private conns = new Set<WebSocket>();

  get connections() {
    return this.conns.size;
  }

  on(method: string, handler: Handler) {
    this.handlers.set(method, handler);
  }

  emit(event: string, data: unknown) {
    const msg = JSON.stringify({ event, data });
    for (const ws of this.conns) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }

  /**
   * Makes `ws` the only client of this workspace. An older client is closed with 4409:
   * several clients would fight over terminal sizes, so the newest one (a refresh, another device) wins.
   */
  attach(ws: WebSocket) {
    for (const old of this.conns) old.close(4409, 'This workspace was opened in another window.');
    this.conns.clear();
    this.conns.add(ws);
    ws.on('close', () => this.conns.delete(ws));
    ws.on('message', async (raw) => {
      // Requests still in flight from a replaced client must not reach the workspace.
      if (!this.conns.has(ws)) return;
      let msg: { id?: number; method: string; params?: unknown };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      const { id, method, params } = msg;
      try {
        const handler = this.handlers.get(method);
        if (!handler) throw new Error(`unknown method: ${method}`);
        const result = await handler(params ?? {});
        if (id != null) ws.send(JSON.stringify({ id, result: result ?? null }));
      } catch (e) {
        if (id != null) ws.send(JSON.stringify({ id, error: e instanceof Error ? e.message : String(e) }));
      }
    });
  }
}
