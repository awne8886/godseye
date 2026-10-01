/**
 * NASA GIBS VIIRS Black Marble 2016 night lights, clipped to the night side of the terminator
 * per pixel. MapLibre requests `godseye-night://{z}/{x}/{y}?t=<ms>` through a custom protocol;
 * the loader fetches the real GIBS tile once (small LRU, ≤ 2 concurrent requests, abort-aware,
 * de-duplicated), then sets every pixel's alpha from the sun's elevation at that pixel for time t
 * (0 at 0°, fully shown at −12°, nautical dusk) and from the pixel's own brightness, so only the
 * recorded lights show over the dark basemap. The map refreshes `t` every 5 minutes.
 * The imagery is a 2016 composite: it is REFERENCE, never "live" lights.
 * Fetch queue + LRU design adapted from OSIRIS terrain-tiles.ts (MIT; see LICENSE NOTICE).
 * Owner: map-engine. Pure core (unit-tested) + browser codec at the bottom.
 */
import { subsolarPoint } from '@/lib/solar';
import { BLACK_MARBLE_MAX_ZOOM, blackMarbleUrl } from './imagery';
import type { RawImage } from './style-images';

export const NIGHT_PROTOCOL = 'godseye-night';
export const NIGHT_SOURCE_ID = 'godseye-night-lights';
export const NIGHT_LAYER_ID = 'godseye-night-lights';
export const NIGHT_REFRESH_MS = 5 * 60_000;
/** Sun elevation (degrees) at which lights are fully shown. */
export const NIGHT_FULL_ELEVATION = -12;

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Tile URL template for a refresh bucket (MapLibre fills {z}/{x}/{y}). */
export function nightTileTemplate(bucketMs: number): string {
  return `${NIGHT_PROTOCOL}://{z}/{x}/{y}?t=${bucketMs}`;
}

/** Floor a timestamp to the 5-minute refresh bucket (identical URLs between refreshes). */
export function nightBucket(nowMs: number): number {
  return Math.floor(nowMs / NIGHT_REFRESH_MS) * NIGHT_REFRESH_MS;
}

/** Night-side weight from solar elevation: 0 in daylight, smoothstep to 1 at −12°. */
export function nightAlpha(elevationDeg: number): number {
  if (elevationDeg >= 0) return 0;
  if (elevationDeg <= NIGHT_FULL_ELEVATION) return 1;
  const t = elevationDeg / NIGHT_FULL_ELEVATION;
  return t * t * (3 - 2 * t);
}

/** Brightness weight: Black Marble's dark ground stays transparent, the lights come through. */
export function lightAlpha(r: number, g: number, b: number): number {
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return Math.max(0, Math.min(1, (lum - 0.08) * 2.5));
}

/** Longitude/latitude of pixel (px, py) in Web-Mercator tile z/x/y of `size` pixels. */
export function tilePixelLngLat(z: number, x: number, y: number, px: number, py: number, size: number): [number, number] {
  const n = 2 ** z;
  const lng = ((x + px / size) / n) * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / size)) / n))) * DEG;
  return [lng, lat];
}

/** Solar elevation for a grid of pixel centres, computed once per row/column. */
function elevationGrid(z: number, x: number, y: number, w: number, h: number, at: number) {
  const sun = subsolarPoint(at);
  const sinD = Math.sin(sun.lat * RAD);
  const cosD = Math.cos(sun.lat * RAD);
  const sinLat = new Float64Array(h);
  const cosLat = new Float64Array(h);
  const cosDLng = new Float64Array(w);
  for (let py = 0; py < h; py++) {
    const lat = tilePixelLngLat(z, x, y, 0, py + 0.5, h)[1] * RAD;
    sinLat[py] = Math.sin(lat);
    cosLat[py] = Math.cos(lat);
  }
  for (let px = 0; px < w; px++) cosDLng[px] = Math.cos((tilePixelLngLat(z, x, y, px + 0.5, 0, w)[0] - sun.lng) * RAD);
  return (px: number, py: number) => Math.asin(Math.max(-1, Math.min(1, sinLat[py]! * sinD + cosLat[py]! * cosD * cosDLng[px]!))) * DEG;
}

/** Copy of `src` with alpha = nightAlpha(sun elevation) × lightAlpha(pixel) × source alpha. */
export function applyNightAlpha(src: RawImage, z: number, x: number, y: number, at: number): RawImage {
  const { width: w, height: h } = src;
  const data = new Uint8ClampedArray(src.data);
  const elev = elevationGrid(z, x, y, w, h, at);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4;
      const a = nightAlpha(elev(px, py)) * lightAlpha(data[i]!, data[i + 1]!, data[i + 2]!);
      data[i + 3] = Math.round(a * data[i + 3]!);
    }
  }
  return { width: w, height: h, data };
}

/**
 * True when the whole tile is in daylight at `at`: a 9×9 grid including the tile edges must all
 * be above a margin of one grid spacing (elevation changes by at most 1° per degree of arc, and
 * no pixel is farther than one spacing from a sample), so no night pixel is ever skipped.
 */
export function tileIsDaylit(z: number, x: number, y: number, at: number): boolean {
  if (z < 2) return false;
  const n = 9;
  const margin = Math.max(2, 360 / 2 ** z / (n - 1));
  const sun = subsolarPoint(at);
  const sinD = Math.sin(sun.lat * RAD);
  const cosD = Math.cos(sun.lat * RAD);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const [lng, lat] = tilePixelLngLat(z, x, y, i / (n - 1), j / (n - 1), 1);
      const s = Math.sin(lat * RAD) * sinD + Math.cos(lat * RAD) * cosD * Math.cos((lng - sun.lng) * RAD);
      if (Math.asin(Math.max(-1, Math.min(1, s))) * DEG < margin) return false;
    }
  }
  return true;
}

export function parseNightUrl(url: string): { z: number; x: number; y: number; t: number } | null {
  const m = /^godseye-night:\/\/(\d+)\/(\d+)\/(\d+)\?t=(\d+)$/.exec(url);
  if (!m) return null;
  const [z, x, y, t] = m.slice(1).map(Number) as [number, number, number, number];
  if (z > BLACK_MARBLE_MAX_ZOOM || x >= 2 ** z || y >= 2 ** z) return null;
  return { z, x, y, t };
}

// ── Fetch queue + LRU (port of OSIRIS terrain-tiles.ts ideas) ─────────────────────
export interface NightLoaderDeps {
  /** Fetch + decode one Black Marble tile to RGBA. */
  fetchTile: (z: number, x: number, y: number, signal: AbortSignal) => Promise<RawImage>;
  /** Encode RGBA to an image file (PNG) that MapLibre can decode. */
  encode: (img: RawImage) => Promise<ArrayBuffer>;
  maxEntries?: number;
  maxConcurrent?: number;
  timeoutMs?: number;
}

export function createNightTileLoader({ fetchTile, encode, maxEntries = 48, maxConcurrent = 2, timeoutMs = 12_000 }: NightLoaderDeps) {
  type Consumer = { resolve: (img: RawImage) => void; reject: (e: unknown) => void; cleanup: () => void };
  type Job = { key: string; z: number; x: number; y: number; controller: AbortController; consumers: Set<Consumer>; started: boolean };
  const cache = new Map<string, RawImage>();
  const jobs = new Map<string, Job>();
  const queue: Job[] = [];
  let running = 0;
  let empty: Promise<ArrayBuffer> | null = null;

  const remember = (key: string, img: RawImage) => {
    cache.delete(key);
    cache.set(key, img);
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
  };

  const pump = () => {
    while (running < maxConcurrent && queue.length) {
      const job = queue.shift()!;
      if (!job.consumers.size) continue;
      job.started = true;
      running++;
      const timer = setTimeout(() => job.controller.abort(new DOMException('Night-lights tile timed out', 'TimeoutError')), timeoutMs);
      fetchTile(job.z, job.x, job.y, job.controller.signal)
        .then((img) => {
          remember(job.key, img);
          job.consumers.forEach((c) => c.resolve(img));
        })
        .catch((e: unknown) => job.consumers.forEach((c) => c.reject(e)))
        .finally(() => {
          clearTimeout(timer);
          job.consumers.forEach((c) => c.cleanup());
          job.consumers.clear();
          if (jobs.get(job.key) === job) jobs.delete(job.key);
          running--;
          pump();
        });
    }
  };

  const source = (z: number, x: number, y: number, signal: AbortSignal): Promise<RawImage> => {
    const key = `${z}/${x}/${y}`;
    const hit = cache.get(key);
    if (hit) {
      remember(key, hit);
      return Promise.resolve(hit);
    }
    let job = jobs.get(key);
    if (!job) {
      job = { key, z, x, y, controller: new AbortController(), consumers: new Set(), started: false };
      jobs.set(key, job);
      queue.push(job);
    }
    const task = job;
    return new Promise<RawImage>((resolve, reject) => {
      const consumer: Consumer = { resolve, reject, cleanup: () => signal.removeEventListener('abort', abort) };
      function abort() {
        consumer.cleanup();
        task.consumers.delete(consumer);
        reject(signal.reason);
        if (task.consumers.size) return; // another request still wants this tile
        task.controller.abort();
        if (jobs.get(key) === task) jobs.delete(key);
        if (!task.started) {
          const i = queue.indexOf(task);
          if (i >= 0) queue.splice(i, 1);
        }
      }
      task.consumers.add(consumer);
      signal.addEventListener('abort', abort, { once: true });
      pump();
    });
  };

  const load = async (url: string, signal: AbortSignal): Promise<ArrayBuffer> => {
    const p = parseNightUrl(url);
    if (!p) throw new Error(`Invalid night-lights tile: ${url}`);
    if (signal.aborted) throw signal.reason;
    if (tileIsDaylit(p.z, p.x, p.y, p.t)) {
      empty ??= encode({ width: 1, height: 1, data: new Uint8ClampedArray(4) });
      return (await empty).slice(0);
    }
    const img = await source(p.z, p.x, p.y, signal);
    signal.throwIfAborted();
    return encode(applyNightAlpha(img, p.z, p.x, p.y, p.t));
  };

  return { load, cacheSize: () => cache.size, pending: () => queue.length + running };
}

// ── Browser codec (OffscreenCanvas) ──────────────────────────────────────────────
async function fetchBlackMarble(z: number, x: number, y: number, signal: AbortSignal): Promise<RawImage> {
  const res = await fetch(blackMarbleUrl(z, x, y), { signal, credentials: 'omit', mode: 'cors' });
  if (!res.ok) throw new Error(`Black Marble tile HTTP ${res.status}`);
  const bmp = await createImageBitmap(await res.blob());
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('OffscreenCanvas 2D unavailable');
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data };
}

async function encodePng(img: RawImage): Promise<ArrayBuffer> {
  const canvas = new OffscreenCanvas(img.width, img.height);
  // Software canvas: a GPU-backed one would need a new raster context and a synchronous pixel readback.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('OffscreenCanvas 2D unavailable');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
}

/** True where the per-pixel night clip can run (OffscreenCanvas + createImageBitmap). */
export function nightLightsSupported(): boolean {
  return typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function';
}

/** The fetch → decode → clip → encode pipeline with the OffscreenCanvas codec (worker or page). */
export function createBrowserNightLoader() {
  return createNightTileLoader({ fetchTile: fetchBlackMarble, encode: encodePng });
}

type AddProtocol = (name: string, action: (req: { url: string }, ac: AbortController) => Promise<{ data: ArrayBuffer; cacheControl?: string }>) => void;
type TileLoad = (url: string, signal: AbortSignal) => Promise<ArrayBuffer>;
let installed = false;

/**
 * Register the `godseye-night://` protocol once per page. `load` normally runs the pipeline in the
 * geometry worker (decode, per-pixel clip and PNG encode stay off the main thread); without it the
 * pipeline runs in the page.
 */
export function installNightProtocol(addProtocol: AddProtocol, load?: TileLoad): void {
  if (installed || !nightLightsSupported()) return;
  const run: TileLoad = load ?? createBrowserNightLoader().load;
  addProtocol(NIGHT_PROTOCOL, async (req, ac) => ({ data: await run(req.url, ac.signal) }));
  installed = true;
}
