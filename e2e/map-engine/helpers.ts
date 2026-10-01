/**
 * Reusable Playwright helpers for every builder's map specs (owner: map-engine).
 *
 *   await gotoMap(page, { camera: { lat: 51.5, lng: -0.12, zoom: 9 }, params: { layers: 'flights' } });
 *   await waitForMapIdle(page);
 *   const cam = await readCamera(page);
 *
 * The map host writes diagnostics on its container (`.maplibregl-map`):
 *  - data-style-ready / data-map-ready: the style JSON is parsed and the map is usable (published to
 *    feature modules: sources/layers can be added, clicks and camera requests are served). Neither
 *    waits for tiles (a hung tile host must not hold the app back, R1r3-M1) nor for the camera;
 *  - data-camera-idle: "true" while no fly/ease/drag is in progress (wait for it before clicking a
 *    precise map position);
 *  - data-map-loads (map constructions this page), data-camera (lat,lng,zoom,pitch,bearing at the
 *    last moveend), data-far-side (camera ground point + altitude on the globe, else "none"),
 *    data-basemap-state (ok/offline/incomplete/stalled), data-admission-pending (start-up units
 *    queued), data-admission-log (the last admitted units, `id@ms` since navigation start),
 *    data-deck-layers / data-deck-undrawn (deck layers handed over / groups not in the style),
 *    data-deck-classes (deck layer classes admitted so far, in order).
 * The wrapper `[data-testid=map-root]` carries data-projection (effective) and data-basemap.
 */
import { inflateSync } from 'node:zlib';
import { expect, type Page } from '@playwright/test';

export interface CameraArg {
  lat: number;
  lng: number;
  zoom: number;
  pitch?: number;
  bearing?: number;
}

export const MAP = '[data-testid="map-root"] .maplibregl-map';

/** `?c=` value for a camera (same format as src/lib/url-state.ts). */
export function cameraParam(c: CameraArg): string {
  const parts = [c.lat, c.lng, c.zoom];
  if (c.pitch !== undefined || c.bearing !== undefined) parts.push(c.pitch ?? 0, c.bearing ?? 0);
  return parts.join(',');
}

/** Open the app with a camera (`?c=`) and any other URL params (layers, proj, theme…). */
export async function gotoMap(page: Page, opts: { camera?: CameraArg; params?: Record<string, string> } = {}): Promise<void> {
  const q = new URLSearchParams(opts.params ?? {});
  if (opts.camera) q.set('c', cameraParam(opts.camera));
  const qs = q.toString();
  await page.goto(qs ? `/?${qs}` : '/');
  // The style is fetched from OpenFreeMap with a 15 s deadline per try and retries after 2, 4, 8, 16, 30 s…
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 90_000 });
  // The HUD splash covers the map (and swallows pointer events) until it lifts (≤ 7 s cap).
  await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 30_000 });
}

/**
 * Wait until the map is ready: style parsed and the map published to feature modules (tiles may
 * still be loading; see the header). The generous default covers a slow style host behind sandbox
 * egress proxies (the style is retried after 2, 4, 8, 16, then every 30 s).
 */
export async function waitForMapIdle(page: Page, timeout = 120_000): Promise<void> {
  await expect(page.locator(MAP)).toHaveAttribute('data-map-ready', 'true', { timeout });
}

/** Wait until the camera has stopped (no fly/ease/drag in progress), e.g. before clicking the map. */
export async function waitForCameraIdle(page: Page, timeout = 60_000): Promise<void> {
  await expect(page.locator(MAP)).toHaveAttribute('data-camera-idle', 'true', { timeout });
}

/** Wait until the map exists and its style is parsed (tiles may still be loading). */
export async function waitForMapStyle(page: Page, timeout = 60_000): Promise<void> {
  await expect(page.locator(MAP)).toHaveAttribute('data-style-ready', 'true', { timeout });
}

/** Camera recorded at the last moveend, or null before the first move. */
export async function readCamera(page: Page): Promise<CameraArg | null> {
  const raw = await page.locator(MAP).getAttribute('data-camera');
  if (!raw) return null;
  const [lat, lng, zoom, pitch, bearing] = raw.split(',').map(Number) as [number, number, number, number, number];
  return { lat, lng, zoom, pitch, bearing };
}

/** Far-side camera (ground point + altitude in metres) or null in mercator / before the first move. */
export async function readFarSideCamera(page: Page): Promise<{ lng: number; lat: number; altitude: number } | null> {
  const raw = await page.locator(MAP).getAttribute('data-far-side');
  if (!raw || raw === 'none') return null;
  const [lng, lat, altitude] = raw.split(',').map(Number) as [number, number, number];
  return { lng, lat, altitude };
}

export async function mapProjection(page: Page): Promise<string | null> {
  return page.locator('[data-testid="map-root"]').getAttribute('data-projection');
}

export async function mapLoads(page: Page): Promise<number> {
  return Number(await page.locator(MAP).getAttribute('data-map-loads'));
}

/** Nudge the camera so a moveend fires (and data-camera / data-far-side are written). */
export async function nudgeMap(page: Page): Promise<void> {
  const box = await page.locator('canvas.maplibregl-canvas').boundingBox();
  if (!box) throw new Error('map canvas not laid out');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 12, y + 4, { steps: 4 });
  await page.mouse.up();
}

/**
 * Same-origin routes another builder has not shipped yet: Next prefetches their links and logs a
 * 404. Remove entries as those routes land (tracked in TODO.md).
 */
export const PENDING_ROUTES = [/^\/docs(\?|$)/, /^\/privacy(\?|$)/];

/**
 * Collect console errors and uncaught page errors from now on. With E2E_IGNORE_HTTPS_ERRORS=1
 * (sandboxes behind a re-signing egress proxy) transport failures (`net::ERR_*`) are the proxy's,
 * not the app's, and are ignored; HTTP status errors and script errors always count.
 */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  const sandbox = process.env.E2E_IGNORE_HTTPS_ERRORS === '1';
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    const url = m.location().url ?? '';
    if (sandbox && /net::ERR_/.test(text)) return;
    try {
      const u = new URL(url);
      const local = ['127.0.0.1', 'localhost'].includes(u.hostname);
      if (/404/.test(text) && local && PENDING_ROUTES.some((r) => r.test(u.pathname + u.search))) return;
      // An upstream that is down makes our own route answer 503 SOURCE OFFLINE (§0: never an empty
      // 200); Chrome logs every non-2xx fetch as a console error. That is the app being honest about a
      // third party, not an app error — the layer's own spec checks how it is shown.
      if (/status of 503/.test(text) && local && u.pathname.startsWith('/api/')) return;
    } catch {
      /* no location: keep the error */
    }
    errors.push(`${text}${url ? ` @ ${url}` : ''}`);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

export interface TokenPixelOptions {
  /** Lowest blend alpha that counts (default 0.4). */
  minAlpha?: number;
  /** Brightest base channel the colour may be blended over (default 48: the dark globe, water, land). */
  maxBase?: number;
}

/**
 * Pixels showing `token`'s colour inside `rect` (fractions of the canvas), decoded from a
 * screenshot. A pixel counts when it is the token blended over a dark base at alpha ≥ `minAlpha`:
 * pixel ≈ a·token + (1 − a)·base with every base channel in [0, maxBase] (± 6 for rounding), solved
 * per channel for the range of `a`. An opaque mark counts (a = 1) and so does a translucent line.
 *
 * Why (CI globe first draw): the planned route is a 2 px dashed line at alpha 153/255 over a 15 %
 * glow, measured on screen at about (124, 103, 40) — never within the old opaque-only rule
 * (Σ|Δ| ≤ 60 from the token), which only the route comet's 4 px head (≈ 60 px) could pass, and only
 * while its 6 s sweep happened to be inside the clip; under reduced motion that count stayed 0.
 * Measured with this rule on saved screenshots (desktop globe, default layers, day_night on): 0–2 px
 * before the arc is drawn, 713–1043 px once it is (globe and mercator), with or without the comet;
 * the same globe view without a route, every default layer drawn: 19–37 px.
 *
 * Count only once the style has parsed (and the splash, gold too, has lifted): on a slow style
 * fetch something gold already scores ≈ 232 px under this rule in the default clip before the
 * style parses (seen 9.1–15.2 s after navigation on both the old and the new build; with a route
 * also after style parse, before the arc). It stays below the 300 px route threshold, and the route
 * specs only count frames produced after style parse and splash removal; anyone starting a
 * screencast or poll earlier must exclude that window too (`watchTokenFrames(...).first(notBefore)`).
 */
export async function tokenPixels(page: Page, token: string, rect: CanvasRect = DEFAULT_RECT, opts: TokenPixelOptions = {}): Promise<number> {
  const rgb = await tokenRgb(page, token);
  const box = await canvasBox(page);
  const clip = { x: box.x + box.width * rect.x0, y: box.y + box.height * rect.y0, width: box.width * (rect.x1 - rect.x0), height: box.height * (rect.y1 - rect.y0) };
  // Decoded and counted here, not in the page: a page busy drawing the globe on a software GPU
  // answered an in-page decode only after 5–6 s.
  const img = decodePng(await page.screenshot({ clip }));
  return countTokenPixels(img, rgb, { x: 0, y: 0, width: img.width, height: img.height }, opts);
}

/** Fractions of the map canvas (default: left of the docked panel, below the header). */
export interface CanvasRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export const DEFAULT_RECT: CanvasRect = { x0: 0.08, y0: 0.15, x1: 0.62, y1: 0.85 };

/** A decoded 8-bit RGB(A) image. */
export interface DecodedImage {
  width: number;
  height: number;
  channels: 3 | 4;
  data: Uint8Array;
}

/**
 * Decode a PNG as Chromium writes them for screenshots and screencast frames: 8-bit RGB or RGBA,
 * not interlaced (anything else throws). Pure Node (zlib), so counting never needs the page.
 */
export function decodePng(buf: Buffer): DecodedImage {
  const SIGNATURE = '89504e470d0a1a0a';
  if (buf.subarray(0, 8).toString('hex') !== SIGNATURE) throw new Error('not a PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colour = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8]!;
      colour = body[9]!;
      interlace = body[12]!;
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || (colour !== 2 && colour !== 6) || interlace !== 0) throw new Error(`unsupported PNG (depth ${depth}, colour type ${colour}, interlace ${interlace})`);
  const channels = colour === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const data = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    const up = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? data[row + x - channels]! : 0;
      const b = y > 0 ? data[up + x]! : 0;
      const c = x >= channels && y > 0 ? data[up + x - channels]! : 0;
      let v = raw[src + x]!;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`bad PNG filter ${filter}`);
      data[row + x] = v & 0xff;
    }
  }
  return { width, height, channels, data };
}

/**
 * Pixels of `img` inside `box` (image pixels) that show `rgb` blended over a dark base at alpha ≥
 * `minAlpha` (see `tokenPixels`).
 */
export function countTokenPixels(img: DecodedImage, rgb: readonly number[], box: { x: number; y: number; width: number; height: number }, opts: TokenPixelOptions = {}): number {
  const minAlpha = opts.minAlpha ?? 0.4;
  const maxBase = opts.maxBase ?? 48;
  const TOL = 6;
  const x0 = Math.max(0, Math.round(box.x));
  const y0 = Math.max(0, Math.round(box.y));
  const x1 = Math.min(img.width, Math.round(box.x + box.width));
  const y1 = Math.min(img.height, Math.round(box.y + box.height));
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = (y * img.width + x) * img.channels;
      // Intersect, over the three channels, the alphas a for which some base b ∈ [0, maxBase]
      // gives v = a·t + (1 − a)·b (± TOL): v − a·t ≥ −TOL and v − a·t ≤ (1 − a)·maxBase + TOL.
      let lo = minAlpha;
      let hi = 1;
      for (let k = 0; k < 3 && lo <= hi; k++) {
        const v = img.data[p + k]!;
        const t = rgb[k]!;
        if (t > 0) hi = Math.min(hi, (v + TOL) / t);
        const slope = t - maxBase;
        const rhs = v - maxBase - TOL;
        if (slope > 0) lo = Math.max(lo, rhs / slope);
        else if (slope < 0) hi = Math.min(hi, rhs / slope);
        else if (rhs > 0) hi = -1;
      }
      if (lo <= hi) n++;
    }
  }
  return n;
}

/** A CSS colour token resolved in the page, as [r, g, b]. */
export async function tokenRgb(page: Page, token: string): Promise<number[]> {
  const rgb = await page.evaluate((t) => {
    const probe = document.createElement('i');
    probe.style.color = `var(${t})`;
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c.match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
  }, token);
  if (rgb.length < 3) throw new Error(`token ${token} did not resolve to a colour`);
  return rgb.slice(0, 3);
}

async function canvasBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator('canvas.maplibregl-canvas').boundingBox();
  if (!box) throw new Error('map canvas not laid out');
  return box;
}

export interface TokenFrame {
  /** Wall-clock time the compositor produced the frame (ms since the epoch). */
  epochMs: number;
  /** Token pixels in the frame's rect. */
  px: number;
  /** Frames decoded until this one (diagnostics). */
  frames: number;
  /** Highest count in an earlier frame at or after `notBefore` (diagnostics). */
  maxBefore: number;
  /** Highest count in a frame before `notBefore`, not eligible (diagnostics: splash, boot). */
  maxEarly: number;
  /** Frames at or after `notBefore` skipped for counting above `maxPx` (diagnostics). */
  overMax: number;
}

export interface TokenFrameWatch {
  /**
   * The first frame produced at or after `notBefore` (epoch ms; may resolve later than the frames
   * it rules on) with `minPx` ≤ count ≤ `maxPx`, or null after `timeoutMs` from this call. Reads
   * the token colour and canvas box from the page first, so call it once the app has rendered.
   */
  first(notBefore: Promise<number> | number, timeoutMs: number): Promise<TokenFrame | null>;
  /** Stop the screencast and detach (idempotent). */
  stop(): Promise<void>;
}

/**
 * Start a CDP screencast now (before `page.goto` if wanted, so no early frame is missed) and judge
 * its frames later with `first()`. Frames are decoded in Node with `tokenPixels`' rule, so nothing
 * waits for a page main thread that a software GPU keeps busy (a forced screenshot there took
 * 4–22 s). Frames that arrive before `first()` knows the token colour are kept (as PNG bytes, at
 * most `bufferFrames`) and judged once it does. Chromium only (every project in this suite).
 */
export async function watchTokenFrames(page: Page, token: string, o: { minPx: number; maxPx?: number; rect?: CanvasRect; opts?: TokenPixelOptions; bufferFrames?: number }): Promise<TokenFrameWatch> {
  const maxPx = o.maxPx ?? Infinity;
  const rect = o.rect ?? DEFAULT_RECT;
  const cap = o.bufferFrames ?? 240;
  const cdp = await page.context().newCDPSession(page);
  const raw: { epochMs: number; png: Buffer }[] = [];
  const counted: { epochMs: number; px: number }[] = [];
  let measure: ((png: Buffer) => number) | null = null;
  let onCounted: (() => void) | null = null;
  let stopped = false;
  cdp.on('Page.screencastFrame', (f) => {
    if (stopped) return;
    const epochMs = f.metadata.timestamp !== undefined ? f.metadata.timestamp * 1000 : Date.now();
    try {
      const png = Buffer.from(f.data, 'base64');
      if (measure) {
        counted.push({ epochMs, px: measure(png) });
        onCounted?.();
      } else {
        raw.push({ epochMs, png });
        if (raw.length > cap) raw.shift();
      }
    } finally {
      // Acknowledged after counting, so frames never pile up faster than they are decoded.
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined);
    }
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    onCounted = null;
    await cdp.send('Page.stopScreencast').catch(() => undefined);
    await cdp.detach().catch(() => undefined);
  };
  const first = async (notBefore: Promise<number> | number, timeoutMs: number): Promise<TokenFrame | null> => {
    const rgb = await tokenRgb(page, token);
    const box = await canvasBox(page);
    const view = page.viewportSize();
    measure = (png) => {
      const img = decodePng(png);
      const s = view ? img.width / view.width : 1;
      const area = { x: (box.x + box.width * rect.x0) * s, y: (box.y + box.height * rect.y0) * s, width: box.width * (rect.x1 - rect.x0) * s, height: box.height * (rect.y1 - rect.y0) * s };
      return countTokenPixels(img, rgb, area, o.opts);
    };
    for (const r of raw.splice(0)) counted.push({ epochMs: r.epochMs, px: measure(r.png) });
    let gate: number | undefined;
    const judge = (): TokenFrame | null => {
      if (gate === undefined) return null;
      let maxBefore = 0;
      let maxEarly = 0;
      let overMax = 0;
      for (let i = 0; i < counted.length; i++) {
        const c = counted[i]!;
        if (c.epochMs < gate) maxEarly = Math.max(maxEarly, c.px);
        else if (c.px > maxPx) overMax++;
        else if (c.px >= o.minPx) return { epochMs: c.epochMs, px: c.px, frames: i + 1, maxBefore, maxEarly, overMax };
        else maxBefore = Math.max(maxBefore, c.px);
      }
      return null;
    };
    return new Promise<TokenFrame | null>((resolve) => {
      let done = false;
      const finish = (v: TokenFrame | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        onCounted = null;
        resolve(v);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      const check = () => {
        const hit = judge();
        if (hit) finish(hit);
      };
      onCounted = check;
      Promise.resolve(notBefore).then((t) => {
        gate = t;
        check();
      }, () => finish(null));
    });
  };
  return { first, stop };
}

/**
 * The first composited frame, from now on, that shows at least `minPx` pixels of `token` inside
 * `rect` (`tokenPixels`' rule), with the time the compositor produced it — or null after
 * `timeoutMs` (see `watchTokenFrames`).
 */
export async function firstTokenFrame(page: Page, token: string, o: { minPx: number; maxPx?: number; timeoutMs: number; rect?: CanvasRect; opts?: TokenPixelOptions }): Promise<TokenFrame | null> {
  const watch = await watchTokenFrames(page, token, o);
  try {
    return await watch.first(0, o.timeoutMs);
  } finally {
    await watch.stop();
  }
}
