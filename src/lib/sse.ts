/**
 * Server-Sent Events over ReadableStream route handlers (§4): `snapshot` on connect, batched
 * `detections`/`update` events, `status` with retired ids, `heartbeat` every 15 s, and the
 * headers nginx/Caddy need (`X-Accel-Buffering: no`). SseHub pins one broadcaster per feed on
 * globalThis so one server-side poll loop fans out to every client.
 * Owner: lead. Server-only.
 */
import { getClientIp, ipBucketKey } from './ratelimit';

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

/** Encode one SSE frame. Multi-line data is split into `data:` lines per the spec (CR, LF or CRLF). */
export function sseFrame(event: string, data: unknown, id?: string | number): string {
  if (/[\r\n]/.test(event)) throw new Error('SSE event names cannot contain newlines');
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  const lines = payload.split(/\r\n|\r|\n/).map((l) => `data: ${l}`);
  return `${id !== undefined ? `id: ${String(id).replace(/[\r\n]/g, '')}\n` : ''}event: ${event}\n${lines.join('\n')}\n\n`;
}

export type SseSend = (event: string, data: unknown, id?: string | number) => boolean;
/** Send an already-encoded frame (broadcasts encode once for every client). */
export type SseSendRaw = (bytes: Uint8Array) => boolean;

export interface SseOptions {
  heartbeatMs?: number;
  /** Client reconnect delay hint in ms. */
  retryMs?: number;
  /**
   * Close the stream after this long so hosts with duration caps reconnect cleanly. Default:
   * SSE_MAX_DURATION_MS, else 280 s on Vercel, else unlimited.
   */
  maxDurationMs?: number;
  /** A client that falls this many bytes behind is dropped (default 2 MB). */
  maxBufferedBytes?: number;
}

const encoder = new TextEncoder();

export function encodeFrame(event: string, data: unknown, id?: string | number): Uint8Array {
  return encoder.encode(sseFrame(event, data, id));
}

function defaultMaxDuration(): number | undefined {
  const env = Number(process.env.SSE_MAX_DURATION_MS);
  if (Number.isFinite(env) && env > 0) return env;
  return process.env.VERCEL ? 280_000 : undefined;
}

/**
 * Create an SSE Response. `start` receives `send`, an AbortSignal that fires exactly once when the
 * stream ends for any reason (client disconnect, cancel, max duration, slow consumer, start error)
 * and `sendRaw`; it may return a cleanup function (also called once).
 */
export function sseResponse(
  req: Request,
  start: (send: SseSend, signal: AbortSignal, sendRaw: SseSendRaw) => void | (() => void) | Promise<void | (() => void)>,
  { heartbeatMs = 15_000, retryMs = 5_000, maxDurationMs = defaultMaxDuration(), maxBufferedBytes = 2 * 1024 * 1024 }: SseOptions = {},
): Response {
  const ac = new AbortController();
  let cleanup: void | (() => void);
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;

  /** Idempotent: every exit path funnels through here. `drop` discards queued bytes. */
  const close = (drop = false) => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(deadline);
    req.signal.removeEventListener('abort', onAbort);
    ac.abort();
    try {
      cleanup?.();
    } catch {
      /* ignore */
    }
    try {
      if (drop) ctrl?.error(new Error('SSE client too slow'));
      else ctrl?.close();
    } catch {
      /* already closed */
    }
  };
  const onAbort = () => close();

  const sendRaw: SseSendRaw = (bytes) => {
    if (closed || !ctrl) return false;
    // enqueue() never throws on back-pressure: check the queue ourselves and drop stalled clients.
    if ((ctrl.desiredSize ?? 0) < -maxBufferedBytes) {
      close(true);
      return false;
    }
    try {
      ctrl.enqueue(bytes);
      return true;
    } catch {
      close();
      return false;
    }
  };
  const send: SseSend = (event, data, id) => (closed ? false : sendRaw(encodeFrame(event, data, id)));

  const stream = new ReadableStream<Uint8Array>(
    {
      async start(controller) {
        ctrl = controller;
        req.signal.addEventListener('abort', onAbort, { once: true });
        controller.enqueue(encoder.encode(`retry: ${retryMs}\n\n`));
        heartbeat = setInterval(() => send('heartbeat', { at: new Date().toISOString() }), heartbeatMs);
        heartbeat.unref?.();
        if (maxDurationMs) deadline = setTimeout(() => close(), maxDurationMs);
        try {
          const c = await start(send, ac.signal, sendRaw);
          if (closed) c?.();
          else cleanup = c;
        } catch (e) {
          send('error', { error: 'stream_failed', detail: (e as Error).message });
          close();
        }
      },
      cancel() {
        close();
      },
    },
    new ByteLengthQueuingStrategy({ highWaterMark: 256 * 1024 }),
  );
  return new Response(stream, { headers: SSE_HEADERS });
}

/** A broadcaster: one upstream loop, many subscribers (≤ maxClients total, ≤ perIp per client IP). */
export class SseHub {
  private readonly clients = new Set<SseSendRaw>();
  private readonly perIpCount = new Map<string, number>();
  constructor(
    readonly name: string,
    private readonly snapshot: () => unknown | null,
    private readonly maxClients = 2000,
    private readonly perIp = 4,
  ) {}

  get size(): number {
    return this.clients.size;
  }

  /** Open streams counted against one client IP (/64 for IPv6). */
  openFor(ip: string): number {
    return this.perIpCount.get(ipBucketKey(ip)) ?? 0;
  }

  subscribe(req: Request, opts?: SseOptions, ip = getClientIp(req.headers)): Response {
    const key = ipBucketKey(ip);
    const mine = this.perIpCount.get(key) ?? 0;
    if (this.clients.size >= this.maxClients || mine >= this.perIp) {
      return new Response(JSON.stringify({ error: 'too_many_streams', detail: 'Too many open streams; close another tab or try again shortly.' }), {
        status: mine >= this.perIp ? 429 : 503,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '30', 'Cache-Control': 'no-store' },
      });
    }
    this.perIpCount.set(key, mine + 1);
    let released = false;
    let sink: SseSendRaw | null = null;
    // Idempotent and bound to the stream's end signal, so every exit path releases exactly once.
    const release = () => {
      if (released) return;
      released = true;
      if (sink) this.clients.delete(sink);
      const n = (this.perIpCount.get(key) ?? 1) - 1;
      if (n <= 0) this.perIpCount.delete(key);
      else this.perIpCount.set(key, n);
    };
    return sseResponse(
      req,
      (send, signal, sendRaw) => {
        signal.addEventListener('abort', release, { once: true });
        const snap = this.snapshot(); // may throw: the stream closes and `release` runs
        if (snap !== null && snap !== undefined) send('snapshot', snap);
        sink = sendRaw;
        this.clients.add(sendRaw);
        return release;
      },
      opts,
    );
  }

  /** Encode once, fan out; slow or closed clients are removed. Returns how many received it. */
  broadcast(event: string, data: unknown): number {
    const bytes = encodeFrame(event, data);
    let delivered = 0;
    for (const sendRaw of this.clients) {
      if (sendRaw(bytes)) delivered++;
      else this.clients.delete(sendRaw);
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
