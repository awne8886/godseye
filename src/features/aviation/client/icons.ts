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

/** Brute-force signed distance (px) to the nearest pixel of the other state, clamped to SPREAD. */
function sdf(inside: Uint8Array, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const me = inside[y * w + x]!;
      let best = SPREAD * SPREAD;
      for (let dy = -SPREAD; dy <= SPREAD; dy++) {
        const yy = y + dy;
        for (let dx = -SPREAD; dx <= SPREAD; dx++) {
          const xx = x + dx;
          const other = yy < 0 || yy >= h || xx < 0 || xx >= w ? 0 : inside[yy * w + xx]!;
          if (other !== me) {
            const d = dx * dx + dy * dy;
            if (d < best) best = d;
          }
        }
      }
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
