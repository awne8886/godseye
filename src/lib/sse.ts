/**
 * Server-Sent Events over ReadableStream route handlers (§4): `snapshot` on connect, batched
 * `detections`/`update` events, `status` with retired ids, `heartbeat` every 15 s, and the
 * headers nginx/Caddy need (`X-Accel-Buffering: no`). SseHub pins one broadcaster per feed on
 * globalThis so one server-side poll loop fans out to every client.
 * Owner: lead. Server-only.
 */

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

/** Encode one SSE frame. Multi-line data is split into `data:` lines per the spec. */
export function sseFrame(event: string, data: unknown, id?: string | number): string {
  if (/[\r\n]/.test(event)) throw new Error('SSE event names cannot contain newlines');
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  const lines = payload.split(/\r?\n/).map((l) => `data: ${l}`);
  return `${id !== undefined ? `id: ${String(id).replace(/[\r\n]/g, '')}\n` : ''}event: ${event}\n${lines.join('\n')}\n\n`;
}

export type SseSend = (event: string, data: unknown, id?: string | number) => boolean;

export interface SseOptions {
  heartbeatMs?: number;
  /** Client reconnect delay hint in ms. */
  retryMs?: number;
  /** Close the stream after this long so hosts with duration caps reconnect cleanly (Vercel). */
  maxDurationMs?: number;
}

/**
 * Create an SSE Response. `start` receives `send` and an AbortSignal that fires when the client
 * disconnects; it may return a cleanup function.
 */
export function sseResponse(
  req: Request,
  start: (send: SseSend, signal: AbortSignal) => void | (() => void) | Promise<void | (() => void)>,
  { heartbeatMs = 15_000, retryMs = 5_000, maxDurationMs }: SseOptions = {},
): Response {
  const encoder = new TextEncoder();
  const ac = new AbortController();
  let cleanup: void | (() => void);
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(deadline);
        ac.abort();
        try {
          cleanup?.();
        } catch {
          /* ignore */
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const send: SseSend = (event, data, id) => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(sseFrame(event, data, id)));
          return true;
        } catch {
          close();
          return false;
        }
      };
      req.signal.addEventListener('abort', close, { once: true });
      controller.enqueue(encoder.encode(`retry: ${retryMs}\n\n`));
      heartbeat = setInterval(() => send('heartbeat', { at: new Date().toISOString() }), heartbeatMs);
      if (maxDurationMs) deadline = setTimeout(close, maxDurationMs);
      try {
        cleanup = await start(send, ac.signal);
      } catch (e) {
        send('error', { error: 'stream_failed', detail: (e as Error).message });
        close();
      }
    },
    cancel() {
      clearInterval(heartbeat);
      clearTimeout(deadline);
      ac.abort();
      cleanup?.();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}

/** A broadcaster: one upstream loop, many subscribers. */
export class SseHub {
  private readonly clients = new Set<SseSend>();
  constructor(
    readonly name: string,
    private readonly snapshot: () => unknown | null,
    private readonly maxClients = 2000,
  ) {}

  get size(): number {
    return this.clients.size;
  }

  subscribe(req: Request, opts?: SseOptions): Response {
    if (this.clients.size >= this.maxClients) {
      return new Response(JSON.stringify({ error: 'too_many_streams', detail: 'Try again shortly.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '30', 'Cache-Control': 'no-store' },
      });
    }
    return sseResponse(
      req,
      (send) => {
        const snap = this.snapshot();
        if (snap !== null && snap !== undefined) send('snapshot', snap);
        this.clients.add(send);
        return () => this.clients.delete(send);
      },
      opts,
    );
  }

  broadcast(event: string, data: unknown): number {
    let delivered = 0;
    for (const send of this.clients) {
      if (send(event, data)) delivered++;
      else this.clients.delete(send);
    }
    return delivered;
  }
}

const G = globalThis as unknown as { __godseyeHubs?: Map<string, SseHub> };

/** One hub per name per process (survives HMR). */
export function getHub(name: string, snapshot: () => unknown | null): SseHub {
  const hubs = (G.__godseyeHubs ??= new Map());
  let hub = hubs.get(name);
  if (!hub) {
    hub = new SseHub(name, snapshot);
    hubs.set(name, hub);
  }
  return hub;
}
