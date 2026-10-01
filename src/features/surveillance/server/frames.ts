/**
 * Stills-only frame relay, TxDOT snapshot decoding, stream-status probes and playback resolution.
 *
 *  - Frames are fetched ONLY with allowListedFetch(url, rulesFor(provider, url)): exact host + directory
 *    prefix (or one exact file for operators that publish frames at the host root) and the SSRF guard on every redirect hop, TLS verification on, honest User-Agent, no
 *    Referer/IP forging. The URL always comes from the catalogue (the route takes a camera id).
 *  - The proxied answer's declared Content-Type is checked first: anything that is not image/* (or a
 *    generic octet-stream) is refused as `not_an_image` and its body is never parsed (an operator's
 *    HTML error page is not scraped). Image bodies must also carry JPEG/PNG/WebP/GIF magic, ≤ 3 MB.
 *  - Frame time = the operator's own: its published timestamp (LTA list, TxDOT snapshot) or the
 *    frame file's Last-Modified. Never the proxy's fetch time; when the operator publishes neither,
 *    the answer says so (`X-Frame-Time-Source: none`) and carries only `X-Frame-Fetched-At`.
 *    `fetchedAt` is only ever the time of a real request to the operator: a refusal made without
 *    one (link-out only, no still, an address refused before connecting, a request that never left
 *    this server's queue) carries `fetchedAt: null` and no `X-Frame-Fetched-At`.
 *  - A timeout is told apart: still waiting in this server's per-operator queue, or answered by
 *    the deadline before the operator had its full request time, is `queued` (ours, never counted
 *    against the operator); an operator that had its full time and did not answer is `timeout`.
 *  - Every attempt that reached, or tried to reach, the operator feeds the frame-health ledger
 *    (outcome only, never the bytes; frame-health.ts).
 *  - Nothing is stored: bytes stream straight back with `Cache-Control` = the operator's minimum
 *    poll interval, so browsers/CDNs coalesce refreshes. HLS segments are never proxied.
 * Owner: layers-surveillance. Server-only.
 */
import 'server-only';
import { MEDIA_HOSTS } from '@/config/hosts';
import { sourceCache } from '@/lib/cache';
import { httpJson, redactUrl } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import { allowListedFetch, type AllowRule, type SafeFetchOptions } from '@/lib/ssrf';
import type { Camera, CameraProvider, FrameError, FrameTimeSource, StreamStatusResponse } from '@/lib/types';
import { stillPath } from '../shared';
import { parseLta, parseTxdotId } from './adapters';
import { recordFrame } from './frame-health';
import { providerRow, rulesFor, type ProviderDef } from './registry';

export const MAX_FRAME_BYTES = 3 * 1024 * 1024;
/** A frame time further than this ahead of the fetch is a clock/metadata error, not an observation. */
export const FRAME_FUTURE_SKEW_MS = 60_000;

/** Per-request timeout of one hop to the operator (allowListedFetch's default, set explicitly). */
export const FRAME_HOP_TIMEOUT_MS = 8_000;

export type FrameResult =
  | { ok: true; body: Buffer; contentType: string; observedAt: string | null; timeSource: FrameTimeSource; fetchedAt: string; maxAgeS: number }
  | { ok: false; status: number; error: string; fetchedAt: string | null; upstreamType?: string | null; httpStatus?: number | null };

/** A failed result; `fetchedAt` stays null unless a request actually went to the operator. */
const failed = (status: number, error: string, extra: { fetchedAt?: string | null; upstreamType?: string | null; httpStatus?: number | null } = {}): FrameResult => ({ ok: false, status, error, fetchedAt: null, ...extra });
const isoAt = (ms: number) => new Date(ms).toISOString();

/** `type/subtype` of a declared Content-Type, lower-cased and sanitised (null when absent or odd). */
export function declaredType(v: string | string[] | undefined): string | null {
  const s = (Array.isArray(v) ? v[0] : v) ?? '';
  const t = s.split(';')[0]!.trim().toLowerCase();
  return /^[a-z0-9.+-]{1,40}\/[a-z0-9.+-]{1,60}$/.test(t) ? t : null;
}

/**
 * The frame's own time: the operator's published timestamp first, then Last-Modified. A time more
 * than a minute after the fetch is dropped (never shown as an observation).
 */
export function frameTime(operatorAt: string | null, lastModified: string | null, fetchedAtMs: number): { observedAt: string | null; timeSource: FrameTimeSource } {
  const ok = (iso: string | null) => {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(t) && t - fetchedAtMs <= FRAME_FUTURE_SKEW_MS ? new Date(t).toISOString() : null;
  };
  const op = ok(operatorAt);
  if (op) return { observedAt: op, timeSource: 'operator' };
  const lm = ok(lastModified);
  if (lm) return { observedAt: lm, timeSource: 'last-modified' };
  return { observedAt: null, timeSource: 'none' };
}

/** Viewer-facing meaning of a frame failure (plain language; never upstream text). */
export function frameErrorInfo(error: string): Pick<FrameError, 'state' | 'message'> {
  if (error === 'not_an_image') return { state: 'offline', message: 'The operator answered with a web page instead of an image (a fault on the operator side). No frame to show.' };
  if (error === 'upstream_404' || error === 'upstream_410') return { state: 'offline', message: 'The operator has no current image for this camera.' };
  if (error === 'no_snapshot') return { state: 'offline', message: 'The operator returned no snapshot for this camera.' };
  if (error === 'too_large') return { state: 'offline', message: 'The operator sent a file larger than a camera still.' };
  if (error === 'blocked') return { state: 'unavailable', message: 'The frame address left the operator’s allow-listed image path, so it was not fetched.' };
  if (error === 'timeout') return { state: 'unavailable', message: 'The operator did not answer in time. Try again.' };
  if (error === 'queued') return { state: 'unavailable', message: 'This server was busy relaying other frames from this operator, so the frame was not requested in time. Try again.' };
  return { state: 'unavailable', message: 'The operator could not be reached or answered with an error. Try again.' };
}

/** Failures that say nothing about the camera or the operator, kept out of the ledger. */
const NOT_ATTEMPTS = new Set(['link_out_only', 'no_still', 'queued']);

/** Feed the frame-health ledger (attempts that reached, or tried to reach, the operator only). */
function noted(def: ProviderDef, camera: Camera, r: FrameResult): FrameResult {
  if (!r.ok && NOT_ATTEMPTS.has(r.error)) return r;
  recordFrame(def.row.id, {
    at: r.fetchedAt ? Date.parse(r.fetchedAt) : Date.now(),
    cameraId: camera.id,
    ok: r.ok,
    error: r.ok ? null : r.error,
    observedAt: r.ok && r.observedAt ? Date.parse(r.observedAt) : null,
  });
  return r;
}

/** Content type from magic bytes (Singapore serves JPEGs as application/octet-stream). */
export function sniffImage(b: Buffer): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1'))) return 'image/gif';
  return null;
}

/**
 * The declared type must be an image (or generic octet-stream / absent) AND the bytes must look
 * like one. The declared type is checked first: an HTML or JSON answer is refused without looking
 * at its body.
 */
export function acceptImage(declared: string | undefined, body: Buffer): string | null {
  const d = (declared ?? '').split(';')[0]!.trim().toLowerCase();
  if (!(d.startsWith('image/') || d === 'application/octet-stream' || d === '')) return null;
  return sniffImage(body);
}

// An explicit list, not `image/*`: some operators (eismoinfo.lt) answer 406 to a bare wildcard.
export const FRAME_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif;q=0.9,*/*;q=0.5';
const httpDate = (v: string | string[] | undefined): string | null => {
  const s = Array.isArray(v) ? v[0] : v;
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** Wall-clock `M/D/YYYY h:mm AM` in `timeZone` → UTC ISO (TxDOT publishes local snapshot times). */
export function zonedToUtc(local: string, timeZone: string): string | null {
  const m = local.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!m) return null;
  let h = Number(m[4]) % 12;
  if (m[7]!.toUpperCase() === 'PM') h += 12;
  const asUtc = Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), h, Number(m[5]), Number(m[6] ?? 0));
  // Offset of the zone at that instant (two passes settle DST edges).
  const offsetAt = (t: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - t;
  };
  let t = asUtc - offsetAt(asUtc);
  t = asUtc - offsetAt(t);
  return new Date(t).toISOString();
}

const frameBuckets = new Map<string, ReturnType<typeof providerBucket>>();
function frameLimiter(providerId: string) {
  let b = frameBuckets.get(providerId);
  if (!b) {
    // ≤ 10 frame fetches/s per operator across all visitors (the CDN absorbs repeats).
    b = providerBucket(`cctv-frame-${providerId}`, 10, 10);
    frameBuckets.set(providerId, b);
  }
  return b;
}

/** LTA image URLs are per-snapshot; resolve the current one from a 60-s cached list. */
const ltaList = sourceCache<Camera[]>(
  'cctv:lta-current',
  async (_prev, signal) => ({ data: parseLta((await httpJson<Parameters<typeof parseLta>[0]>('https://api.data.gov.sg/v1/transport/traffic-images', { signal, timeoutMs: 10_000, retries: 1 })).data ?? {}) }),
  { ttlMs: 60_000, retryAfterErrorMs: 30_000 },
);

async function currentStillUrl(camera: Camera, def: ProviderDef): Promise<{ url: string; observedAt: string | null } | null> {
  if (def.row.id === 'lta') {
    const r = await ltaList.get().catch(() => null);
    const hit = r?.data?.find((c) => c.id === camera.id);
    if (hit?.stillUrl) return { url: hit.stillUrl, observedAt: hit.observedAt };
  }
  return camera.stillUrl ? { url: camera.stillUrl, observedAt: null } : null;
}

export interface FrameDeps {
  fetchOpts?: SafeFetchOptions;
  env?: Record<string, string | undefined>;
}

/** What one request saw of its operator's limiter: still queued, and when it was last let through. */
export interface LimiterTrace {
  waiting: boolean;
  grantedAt: number | null;
  grants: number;
}

/** Wrap an operator's limiter so a failed request can tell its own queue wait from the operator. */
export function tracedLimiter(bucket: { take(): Promise<void> }): { take(): Promise<void>; trace: LimiterTrace } {
  const trace: LimiterTrace = { waiting: false, grantedAt: null, grants: 0 };
  return {
    trace,
    take: async () => {
      trace.waiting = true;
      try {
        await bucket.take();
        trace.grantedAt = Date.now();
        trace.grants++;
      } finally {
        trace.waiting = false;
      }
    },
  };
}

/**
 * Whose timeout it was: `queued` when the request was still waiting in this server's limiter, or the
 * overall deadline cut the operator off before it had its full per-request time (our queue ate the
 * budget); `timeout` when the operator had that time and did not answer (or its address did not
 * resolve before any request was queued).
 */
export function timeoutCause(trace: LimiterTrace, now: number, hopTimeoutMs: number = FRAME_HOP_TIMEOUT_MS): 'queued' | 'timeout' {
  if (trace.waiting) return 'queued';
  if (trace.grantedAt === null) return 'timeout';
  return now - trace.grantedAt >= hopTimeoutMs * 0.95 ? 'timeout' : 'queued';
}

/** A thrown fetch → FrameResult: whose fault it was, and whether a request reached the operator. */
function fetchFailure(e: unknown, trace: LimiterTrace, firstUrl: string, hopTimeoutMs: number): FrameResult {
  const raw = (e as { code?: string }).code ?? 'network';
  const now = Date.now();
  const code = raw === 'timeout' ? timeoutCause(trace, now, hopTimeoutMs) : raw;
  // A request reached the operator once the limiter let one through — except an address refused on
  // the first hop (allow-list or SSRF guard: nothing was sent).
  const blockedFirst = code === 'blocked' && (e as { url?: string }).url === redactUrl(firstUrl);
  const requested = trace.grants > 0 && !blockedFirst;
  const status = code === 'blocked' ? 403 : code === 'queued' ? 503 : 502;
  return failed(status, code, { fetchedAt: requested ? isoAt(now) : null });
}

/** allowListedFetch options for a frame: the operator's traced limiter, the explicit hop timeout. */
function frameFetchOpts(providerId: string, deps: FrameDeps, opts: SafeFetchOptions): { opts: SafeFetchOptions; trace: LimiterTrace; hopTimeoutMs: number } {
  const lim = tracedLimiter(deps.fetchOpts?.limiter ?? frameLimiter(providerId));
  const merged: SafeFetchOptions = { timeoutMs: FRAME_HOP_TIMEOUT_MS, ...opts, ...deps.fetchOpts, limiter: lim };
  return { opts: merged, trace: lim.trace, hopTimeoutMs: merged.timeoutMs ?? FRAME_HOP_TIMEOUT_MS };
}

/** Fetch one still for a catalogued camera (never stored); the outcome feeds the frame-health ledger. */
export async function fetchFrame(camera: Camera, def: ProviderDef, deps: FrameDeps = {}): Promise<FrameResult> {
  const row = providerRow(def, deps.env);
  if (row.link_out_only || !row.proxy_allowed) return failed(404, 'link_out_only');
  if (def.row.id === 'txdot') return fetchTxdotSnapshot(camera, def, deps);
  const target = await currentStillUrl(camera, def);
  if (!target) return failed(404, 'no_still');
  const f = frameFetchOpts(def.row.id, deps, { maxBytes: MAX_FRAME_BYTES, headers: { accept: FRAME_ACCEPT } });
  let res;
  try {
    res = await allowListedFetch(target.url, rulesFor(def, target.url), f.opts);
  } catch (e) {
    return noted(def, camera, fetchFailure(e, f.trace, target.url, f.hopTimeoutMs));
  }
  const fetchedAt = isoAt(Date.now());
  if (!res.ok) return noted(def, camera, failed(502, `upstream_${res.status}`, { fetchedAt, httpStatus: res.status }));
  const type = acceptImage(res.headers['content-type'] as string | undefined, res.body);
  if (!type) return noted(def, camera, failed(502, 'not_an_image', { fetchedAt, upstreamType: declaredType(res.headers['content-type']), httpStatus: res.status }));
  const t = frameTime(target.observedAt, httpDate(res.headers['last-modified']), Date.parse(fetchedAt));
  return noted(def, camera, { ok: true, body: res.body, contentType: type, ...t, fetchedAt, maxAgeS: row.max_poll_interval });
}

/** TxDOT answers JSON `{snippet: <base64 JPEG>, timestampFormatted: 'M/D/YYYY h:mm AM'}` (local time). */
export async function fetchTxdotSnapshot(camera: Camera, def: ProviderDef, deps: FrameDeps = {}): Promise<FrameResult> {
  const parts = parseTxdotId(camera.id);
  if (!parts || !camera.stillUrl) return failed(404, 'no_still');
  const f = frameFetchOpts('txdot', deps, { maxBytes: (8 * MAX_FRAME_BYTES) / 3, headers: { accept: 'application/json' } });
  let res;
  try {
    res = await allowListedFetch(camera.stillUrl, rulesFor(def, camera.stillUrl), f.opts);
  } catch (e) {
    return noted(def, camera, fetchFailure(e, f.trace, camera.stillUrl, f.hopTimeoutMs));
  }
  const fetchedAt = isoAt(Date.now());
  const answered = { fetchedAt, httpStatus: res.status };
  if (!res.ok) return noted(def, camera, failed(502, `upstream_${res.status}`, answered));
  if (declaredType(res.headers['content-type'])?.includes('html')) return noted(def, camera, failed(502, 'not_an_image', { ...answered, upstreamType: declaredType(res.headers['content-type']) }));
  let json: { snippet?: unknown; timestampFormatted?: unknown };
  try {
    json = JSON.parse(res.body.toString('utf8'));
  } catch {
    return noted(def, camera, failed(502, 'parse', answered));
  }
  if (typeof json.snippet !== 'string' || !/^[A-Za-z0-9+/=\s]+$/.test(json.snippet)) return noted(def, camera, failed(502, 'no_snapshot', answered));
  const body = Buffer.from(json.snippet, 'base64');
  if (body.length > MAX_FRAME_BYTES || sniffImage(body) !== 'image/jpeg') return noted(def, camera, failed(502, 'not_an_image', { ...answered, upstreamType: null }));
  const zone = parts.district === 'ELP' ? 'America/Denver' : (def.timeZone ?? 'America/Chicago');
  const published = typeof json.timestampFormatted === 'string' ? zonedToUtc(json.timestampFormatted.trim(), zone) : null;
  const t = frameTime(published, null, Date.parse(fetchedAt));
  return noted(def, camera, { ok: true, body, contentType: 'image/jpeg', ...t, fetchedAt, maxAgeS: def.row.max_poll_interval });
}

export function frameResponse(r: FrameResult): Response {
  if (!r.ok) {
    const body: FrameError = { error: 'frame_unavailable', detail: r.error, ...frameErrorInfo(r.error), upstreamType: r.upstreamType ?? null, fetchedAt: r.fetchedAt };
    const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, max-age=0', 'X-Frame-Error': r.error };
    if (r.fetchedAt) headers['X-Frame-Fetched-At'] = r.fetchedAt;
    if (r.status === 503) headers['Retry-After'] = '15';
    return new Response(JSON.stringify(body), { status: r.status, headers });
  }
  const headers: Record<string, string> = {
    'Content-Type': r.contentType,
    'Content-Length': String(r.body.length),
    'Cache-Control': `public, max-age=${r.maxAgeS}, s-maxage=${r.maxAgeS}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Frame-Fetched-At': r.fetchedAt,
    'X-Frame-Time-Source': r.timeSource,
  };
  if (r.observedAt) headers['X-Frame-Observed-At'] = r.observedAt;
  return new Response(new Uint8Array(r.body), { status: 200, headers });
}

// ── Playback resolution ─────────────────────────────────────────────────────────
/** MEDIA_HOSTS entries → allow rules (browser playback is only offered for these). */
export function mediaRules(hosts: readonly string[] = MEDIA_HOSTS): AllowRule[] {
  return hosts.map((h) => {
    const u = new URL(h.replace('://*.', '://wildcard-placeholder.'));
    const host = h.includes('://*.') ? `*.${u.hostname.slice('wildcard-placeholder.'.length)}` : u.hostname;
    return { host, pathPrefix: u.pathname === '' ? '/' : u.pathname };
  });
}

function onMediaHosts(url: string, hosts: readonly string[] = MEDIA_HOSTS): boolean {
  try {
    const u = new URL(url);
    return mediaRules(hosts).some((r) => {
      const hostOk = r.host.startsWith('*.') ? u.hostname.endsWith(r.host.slice(1)) : u.hostname === r.host;
      return u.protocol === 'https:' && hostOk && u.pathname.startsWith(r.pathPrefix);
    });
  } catch {
    return false;
  }
}

/** Camera as published to clients: link-out-only providers expose no frame or stream URLs. */
export function publicCamera(c: Camera, row: CameraProvider): Camera {
  if (!row.link_out_only) return c;
  return { ...c, streamType: 'link', stillUrl: null, streamUrl: null };
}

/**
 * What the viewer should play: direct HLS/MP4 only from MEDIA_HOSTS (the CSP admits nothing else),
 * otherwise the same-origin still, otherwise null (link out to the operator).
 */
export function playableFor(c: Camera, row: CameraProvider, hosts: readonly string[] = MEDIA_HOSTS): { type: Camera['streamType']; url: string } | null {
  if (row.link_out_only) return null;
  if ((c.streamType === 'hls' || c.streamType === 'mp4') && c.streamUrl && onMediaHosts(c.streamUrl, hosts)) return { type: c.streamType, url: c.streamUrl };
  if (c.stillUrl && row.proxy_allowed) return { type: 'jpg', url: stillPath(c) };
  return null;
}

// ── Stream status (real probe, cached 60 s per camera; status only, never frames) ──
export async function probeCamera(camera: Camera, def: ProviderDef, deps: FrameDeps = {}): Promise<Omit<StreamStatusResponse, 'id'>> {
  const checkedAt = new Date().toISOString();
  const row = providerRow(def, deps.env);
  const hls = camera.streamType === 'hls' && camera.streamUrl ? camera.streamUrl : null;
  if (row.link_out_only || (!hls && !camera.stillUrl)) return { status: 'unknown', checkedAt, httpStatus: null };
  if (hls) {
    const f = frameFetchOpts(def.row.id, deps, { maxBytes: 256 * 1024, headers: { accept: 'application/vnd.apple.mpegurl, */*' } });
    try {
      const res = await allowListedFetch(hls, rulesFor(def, hls), f.opts);
      const online = res.ok && res.body.subarray(0, 7).toString('latin1') === '#EXTM3U';
      return { status: online ? 'online' : 'offline', checkedAt, httpStatus: res.status };
    } catch (e) {
      const r = fetchFailure(e, f.trace, hls, f.hopTimeoutMs);
      if (!r.ok && r.error === 'queued') return { status: 'unknown', checkedAt, httpStatus: null, reason: 'queued' };
      return { status: 'offline', checkedAt, httpStatus: (e as { status?: number }).status ?? null, ...(r.ok ? {} : { reason: r.error }) };
    }
  }
  const frame = await fetchFrame(camera, def, deps);
  if (frame.ok) return { status: 'online', checkedAt, httpStatus: 200 };
  // Our own queue was busy: nothing is known about the camera.
  if (frame.error === 'queued') return { status: 'unknown', checkedAt, httpStatus: null, reason: 'queued' };
  return { status: 'offline', checkedAt, httpStatus: frame.httpStatus ?? null, reason: frame.error };
}

const statusCaches = new Map<string, ReturnType<typeof sourceCache<Omit<StreamStatusResponse, 'id'>>>>();

export async function cachedStatus(camera: Camera, def: ProviderDef): Promise<Omit<StreamStatusResponse, 'id'>> {
  let c = statusCaches.get(camera.id);
  if (!c) {
    c = sourceCache(`cctv-status:${camera.id}`, async () => ({ data: await probeCamera(camera, def) }), { ttlMs: 60_000, retryAfterErrorMs: 60_000, isEmpty: () => false });
    statusCaches.set(camera.id, c);
    if (statusCaches.size > 2000) statusCaches.delete(statusCaches.keys().next().value!);
  }
  const r = await c.get();
  return r.data ?? { status: 'unknown', checkedAt: new Date().toISOString(), httpStatus: null };
}
