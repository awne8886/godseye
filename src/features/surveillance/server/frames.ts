/**
 * Stills-only frame relay, TxDOT snapshot decoding, stream-status probes and playback resolution.
 *
 *  - Frames are fetched ONLY with allowListedFetch(url, rulesFor(provider, url)): exact host + directory
 *    prefix (or one exact file for operators that publish frames at the host root) and the SSRF guard on every redirect hop, TLS verification on, honest User-Agent, no
 *    Referer/IP forging. The URL always comes from the catalogue (the route takes a camera id).
 *  - Only image/* bodies (or octet-stream whose magic bytes are JPEG/PNG/WebP/GIF) ≤ 3 MB pass.
 *  - Nothing is stored: bytes stream straight back with `Cache-Control` = the operator's minimum
 *    poll interval, so browsers/CDNs coalesce refreshes. HLS segments are never proxied.
 * Owner: layers-surveillance. Server-only.
 */
import 'server-only';
import { MEDIA_HOSTS } from '@/config/hosts';
import { sourceCache } from '@/lib/cache';
import { httpJson } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import { allowListedFetch, type AllowRule, type SafeFetchOptions } from '@/lib/ssrf';
import type { Camera, CameraProvider, StreamStatusResponse } from '@/lib/types';
import { stillPath } from '../shared';
import { parseLta, parseTxdotId } from './adapters';
import { providerRow, rulesFor, type ProviderDef } from './registry';

export const MAX_FRAME_BYTES = 3 * 1024 * 1024;

export type FrameResult =
  | { ok: true; body: Buffer; contentType: string; observedAt: string | null; maxAgeS: number }
  | { ok: false; status: number; error: string };

/** Content type from magic bytes (Singapore serves JPEGs as application/octet-stream). */
export function sniffImage(b: Buffer): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1'))) return 'image/gif';
  return null;
}

/** The declared type must be an image (or generic octet-stream) AND the bytes must look like one. */
export function acceptImage(declared: string | undefined, body: Buffer): string | null {
  const d = (declared ?? '').split(';')[0]!.trim().toLowerCase();
  const sniffed = sniffImage(body);
  if (!sniffed) return null;
  if (d.startsWith('image/') || d === 'application/octet-stream' || d === '') return sniffed;
  return null;
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

/** Fetch one still for a catalogued camera (never stored). */
export async function fetchFrame(camera: Camera, def: ProviderDef, deps: FrameDeps = {}): Promise<FrameResult> {
  const row = providerRow(def, deps.env);
  if (row.link_out_only || !row.proxy_allowed) return { ok: false, status: 404, error: 'link_out_only' };
  if (def.row.id === 'txdot') return fetchTxdotSnapshot(camera, def, deps);
  const target = await currentStillUrl(camera, def);
  if (!target) return { ok: false, status: 404, error: 'no_still' };
  let res;
  try {
    res = await allowListedFetch(target.url, rulesFor(def, target.url), { maxBytes: MAX_FRAME_BYTES, headers: { accept: FRAME_ACCEPT }, limiter: frameLimiter(def.row.id), ...deps.fetchOpts });
  } catch (e) {
    const code = (e as { code?: string }).code;
    return { ok: false, status: code === 'blocked' ? 403 : 502, error: code ?? 'network' };
  }
  if (!res.ok) return { ok: false, status: 502, error: `upstream_${res.status}` };
  const type = acceptImage(res.headers['content-type'] as string | undefined, res.body);
  if (!type) return { ok: false, status: 502, error: 'not_an_image' };
  return { ok: true, body: res.body, contentType: type, observedAt: target.observedAt ?? httpDate(res.headers['last-modified']), maxAgeS: row.max_poll_interval };
}

/** TxDOT answers JSON `{snippet: <base64 JPEG>, timestampFormatted: 'M/D/YYYY h:mm AM'}` (local time). */
export async function fetchTxdotSnapshot(camera: Camera, def: ProviderDef, deps: FrameDeps = {}): Promise<FrameResult> {
  const parts = parseTxdotId(camera.id);
  if (!parts || !camera.stillUrl) return { ok: false, status: 404, error: 'no_still' };
  let res;
  try {
    res = await allowListedFetch(camera.stillUrl, rulesFor(def, camera.stillUrl), { maxBytes: 8 * MAX_FRAME_BYTES / 3, headers: { accept: 'application/json' }, limiter: frameLimiter('txdot'), ...deps.fetchOpts });
  } catch (e) {
    const code = (e as { code?: string }).code;
    return { ok: false, status: code === 'blocked' ? 403 : 502, error: code ?? 'network' };
  }
  if (!res.ok) return { ok: false, status: 502, error: `upstream_${res.status}` };
  let json: { snippet?: unknown; timestampFormatted?: unknown };
  try {
    json = JSON.parse(res.body.toString('utf8'));
  } catch {
    return { ok: false, status: 502, error: 'parse' };
  }
  if (typeof json.snippet !== 'string' || !/^[A-Za-z0-9+/=\s]+$/.test(json.snippet)) return { ok: false, status: 502, error: 'no_snapshot' };
  const body = Buffer.from(json.snippet, 'base64');
  if (body.length > MAX_FRAME_BYTES || sniffImage(body) !== 'image/jpeg') return { ok: false, status: 502, error: 'not_an_image' };
  const zone = parts.district === 'ELP' ? 'America/Denver' : (def.timeZone ?? 'America/Chicago');
  const observedAt = typeof json.timestampFormatted === 'string' ? zonedToUtc(json.timestampFormatted.trim(), zone) : null;
  return { ok: true, body, contentType: 'image/jpeg', observedAt, maxAgeS: def.row.max_poll_interval };
}

export function frameResponse(r: FrameResult): Response {
  if (!r.ok) {
    return new Response(JSON.stringify({ error: 'frame_unavailable', detail: r.error }), {
      status: r.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, max-age=0' },
    });
  }
  const headers: Record<string, string> = {
    'Content-Type': r.contentType,
    'Content-Length': String(r.body.length),
    'Cache-Control': `public, max-age=${r.maxAgeS}, s-maxage=${r.maxAgeS}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-origin',
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
    try {
      const res = await allowListedFetch(hls, rulesFor(def, hls), { maxBytes: 256 * 1024, headers: { accept: 'application/vnd.apple.mpegurl, */*' }, limiter: frameLimiter(def.row.id), ...deps.fetchOpts });
      const online = res.ok && res.body.subarray(0, 7).toString('latin1') === '#EXTM3U';
      return { status: online ? 'online' : 'offline', checkedAt, httpStatus: res.status };
    } catch (e) {
      return { status: 'offline', checkedAt, httpStatus: (e as { status?: number }).status ?? null };
    }
  }
  const frame = await fetchFrame(camera, def, deps);
  if (frame.ok) return { status: 'online', checkedAt, httpStatus: 200 };
  const m = frame.error.match(/^upstream_(\d{3})$/);
  return { status: 'offline', checkedAt, httpStatus: m ? Number(m[1]) : null };
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
