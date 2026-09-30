/**
 * Aircraft selection + CPU hit-test for the map's single click router (src/lib/map/picking.ts).
 * GPU picking is unreliable through the interleaved overlay and under SwiftShader, so aircraft
 * are hit-tested on the CPU against their projected, dead-reckoned positions (nearest within
 * HIT_PX, far-side filtered by the frame's `visible` list). Owner: layers-aviation.
 */
import type { Selection } from '@/lib/layer-host';
import type { HitTestMap, PickCandidate } from '@/lib/map/picking';
import type { FlightRecord } from '../adsb';
import type { Frame } from './layers';
import { BUCKET_LAYER } from './useFlights';

/** Click tolerance around an aircraft icon, in CSS pixels. */
export const HIT_PX = 14;

export function aircraftSelection(r: FlightRecord, lngLat: [number, number]): Selection {
  return { kind: 'aircraft', id: r.id, layer: BUCKET_LAYER[r.bucket], source: r.source, observedAt: new Date(r.seenAt * 1000).toISOString(), data: { ...r }, lngLat };
}

/** The nearest drawn aircraft within HIT_PX of `point` (at most one candidate). */
export function hitTestAircraft(f: Frame, point: { x: number; y: number }, map: HitTestMap): PickCandidate[] {
  if (!f.count) return [];
  // Cheap pre-filter in degrees around the pointer before projecting (generous on the globe).
  const at = map.unproject([point.x, point.y]);
  const degPerPx = 360 / (512 * 2 ** map.getZoom());
  const window = HIT_PX * degPerPx * 4;
  const lngWindow = window / Math.max(0.05, Math.cos((at.lat * Math.PI) / 180));
  let best = -1;
  let bestD = HIT_PX * HIT_PX;
  for (let k = 0; k < f.count; k++) {
    const i = f.visible[k]!;
    const lng = f.pos[i * 2]!;
    const lat = f.pos[i * 2 + 1]!;
    if (Math.abs(lat - at.lat) > window) continue;
    if (Math.abs(((lng - at.lng + 540) % 360) - 180) > lngWindow) continue;
    const p = map.project([lng, lat]);
    const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best < 0) return [];
  const r = f.records[best]!;
  const s = aircraftSelection(r, [f.pos[best * 2]!, f.pos[best * 2 + 1]!]);
  return [{ layer: s.layer!, selection: s, distancePx: Math.sqrt(bestD) }];
}
