/**
 * Aircraft silhouettes drawn in code (no external sprite) and converted to a signed-distance-field
 * atlas, so one small texture stays crisp at every size and can carry an outline (SdfIconLayer).
 * Icons point north (up); the layer rotates them by track. Client-only.
 */
export const ICON_PX = 64;
/** Distance range (px) encoded around the edge: alpha 0.5 = edge, 0 = SPREAD outside, 1 = SPREAD inside. */
const SPREAD = 8;

export type IconName = 'plane' | 'jet' | 'heli';
export const ICON_NAMES: readonly IconName[] = ['plane', 'jet', 'heli'];

type Draw = (ctx: CanvasRenderingContext2D) => void;

/** All paths in a 64×64 box, nose up, centred on (32, 32). */
const SHAPES: Record<IconName, Draw> = {
  // Airliner: long fuselage, swept wings with engines, tailplane.
  plane: (c) => {
    c.beginPath();
    c.moveTo(32, 4);
    c.bezierCurveTo(35, 6, 35.5, 10, 35.5, 16);
    c.lineTo(35.5, 25);
    c.lineTo(58, 37);
    c.lineTo(58, 41);
    c.lineTo(35.5, 35);
    c.lineTo(35, 50);
    c.lineTo(43, 56);
    c.lineTo(43, 59);
    c.lineTo(32, 56.5);
    c.lineTo(21, 59);
    c.lineTo(21, 56);
    c.lineTo(29, 50);
    c.lineTo(28.5, 35);
    c.lineTo(6, 41);
    c.lineTo(6, 37);
    c.lineTo(28.5, 25);
    c.lineTo(28.5, 16);
    c.bezierCurveTo(28.5, 10, 29, 6, 32, 4);
    c.closePath();
    c.fill();
    c.fillRect(16, 31, 4, 7); // engines
    c.fillRect(44, 31, 4, 7);
  },
  // Business / fast jet: slim fuselage, delta-ish swept wing set far aft, T-tail, rear engines.
  jet: (c) => {
    c.beginPath();
    c.moveTo(32, 3);
    c.bezierCurveTo(34.5, 7, 34.8, 12, 34.8, 20);
    c.lineTo(34.8, 28);
    c.lineTo(52, 42);
    c.lineTo(52, 45);
    c.lineTo(34.8, 39);
    c.lineTo(34.5, 52);
    c.lineTo(42, 58);
    c.lineTo(42, 61);
    c.lineTo(32, 58.5);
    c.lineTo(22, 61);
    c.lineTo(22, 58);
    c.lineTo(29.5, 52);
    c.lineTo(29.2, 39);
    c.lineTo(12, 45);
    c.lineTo(12, 42);
    c.lineTo(29.2, 28);
    c.lineTo(29.2, 20);
    c.bezierCurveTo(29.2, 12, 29.5, 7, 32, 3);
    c.closePath();
    c.fill();
    c.fillRect(35, 43, 4, 7); // rear-mounted engines
    c.fillRect(25, 43, 4, 7);
  },
  // Helicopter: rotor disc ring, cabin, tail boom and tail rotor.
  heli: (c) => {
    c.beginPath();
    c.ellipse(32, 26, 7.5, 11, 0, 0, Math.PI * 2);
    c.fill();
    c.fillRect(30.5, 34, 3, 22); // tail boom
    c.fillRect(25, 53, 14, 3); // tail rotor
    c.lineWidth = 3;
    c.beginPath();
    c.arc(32, 26, 21, 0, Math.PI * 2); // rotor disc
    c.stroke();
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(17, 11);
    c.lineTo(47, 41);
    c.moveTo(47, 11);
    c.lineTo(17, 41);
    c.stroke();
  },
};

const INF = 1e20;

/** Exact 1-D squared distance transform (Felzenszwalb & Huttenlocher 2012), in place on f[0..n). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    d[q] = (q - v[k]!) * (q - v[k]!) + f[v[k]!]!;
  }
  for (let q = 0; q < n; q++) f[q] = d[q]!;
}

/** Squared Euclidean distance from every cell to the nearest cell whose `grid` value is 0. */
function edt2d(grid: Float64Array, w: number, h: number): void {
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x]!;
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = f[y]!;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x]!;
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[y * w + x] = f[x]!;
  }
}

/**
 * Signed distance (px) to the nearest pixel of the other state, clamped to SPREAD, as a byte
 * (0.5 = edge). Pixels outside the icon box count as "outside". Exact Euclidean distance transform
 * in O(pixels) — perf M3: the former brute-force window scan cost ~1 s at first draw.
 */
export function sdf(inside: Uint8Array, w: number, h: number): Uint8ClampedArray {
  // Pad by SPREAD so the box border behaves as "outside", like an out-of-bounds pixel did.
  const W = w + 2 * SPREAD;
  const H = h + 2 * SPREAD;
  const toOutside = new Float64Array(W * H);
  const toInside = new Float64Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ix = x - SPREAD;
      const iy = y - SPREAD;
      const me = ix >= 0 && ix < w && iy >= 0 && iy < h ? inside[iy * w + ix]! : 0;
      toOutside[y * W + x] = me ? INF : 0;
      toInside[y * W + x] = me ? 0 : INF;
    }
  }
  edt2d(toOutside, W, H);
  edt2d(toInside, W, H);
  const out = new Uint8ClampedArray(w * h);
  const cap = SPREAD * SPREAD;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const me = inside[y * w + x]!;
      const i = (y + SPREAD) * W + x + SPREAD;
      const best = Math.min(cap, me ? toOutside[i]! : toInside[i]!);
      const dist = Math.sqrt(best) - 0.5;
      const signed = me ? dist : -dist;
      out[y * w + x] = Math.round(Math.max(0, Math.min(1, 0.5 + signed / (2 * SPREAD))) * 255);
    }
  }
  return out;
}

export interface IconAtlas {
  canvas: HTMLCanvasElement;
  mapping: Record<IconName, { x: number; y: number; width: number; height: number; anchorX: number; anchorY: number; mask: boolean }>;
}

let cached: IconAtlas | null = null;

/** Build (once) the SDF atlas: white RGB, distance in alpha. Returns null without a DOM. */
export function aircraftAtlas(): IconAtlas | null {
  if (cached) return cached;
  if (typeof document === 'undefined') return null;
  const atlas = document.createElement('canvas');
  atlas.width = ICON_PX * ICON_NAMES.length;
  atlas.height = ICON_PX;
  const actx = atlas.getContext('2d');
  const scratch = document.createElement('canvas');
  scratch.width = ICON_PX;
  scratch.height = ICON_PX;
  const sctx = scratch.getContext('2d', { willReadFrequently: true });
  if (!actx || !sctx) return null;
  const mapping = {} as IconAtlas['mapping'];
  ICON_NAMES.forEach((name, i) => {
    sctx.clearRect(0, 0, ICON_PX, ICON_PX);
    sctx.fillStyle = '#fff';
    sctx.strokeStyle = '#fff';
    SHAPES[name](sctx);
    const px = sctx.getImageData(0, 0, ICON_PX, ICON_PX).data;
    const inside = new Uint8Array(ICON_PX * ICON_PX);
    for (let p = 0; p < inside.length; p++) inside[p] = px[p * 4 + 3]! > 127 ? 1 : 0;
    const field = sdf(inside, ICON_PX, ICON_PX);
    const img = actx.createImageData(ICON_PX, ICON_PX);
    for (let p = 0; p < field.length; p++) {
      img.data[p * 4] = 255;
      img.data[p * 4 + 1] = 255;
      img.data[p * 4 + 2] = 255;
      img.data[p * 4 + 3] = field[p]!;
    }
    actx.putImageData(img, i * ICON_PX, 0);
    mapping[name] = { x: i * ICON_PX, y: 0, width: ICON_PX, height: ICON_PX, anchorX: ICON_PX / 2, anchorY: ICON_PX / 2, mask: true };
  });
  cached = { canvas: atlas, mapping };
  return cached;
}
