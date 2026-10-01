// R4 round 3 M2: the globe camera must frame the whole route at the zoom MapLibre actually uses
// (its minimum zoom — 1.2 desktop, 0.3 phone — is latitude-adjusted on the globe: minZoom +
// log2 cos(centre lat)), with the polar 1/cos(lat) globe inflation accounted for. Plans recorded
// from this server's /api/route/plan on 2026-10-01 03:15Z. The check below is an independent
// re-implementation of MapLibre's pitch-0 globe perspective (fov 36.87°,
// cameraToCenterDistance = 0.5/tan(fov/2)·H, radius = 512·2^z/2π/cos(centre lat)), measured from
// the solved anchor (MapLibre's padded centre).
import { describe, expect, it } from 'vitest';
import type { LngLatTuple } from '@/lib/geo';
import type { Plan } from './api';
import { frameArea, framePoints, solveFrame } from './framing';
import { routeFrame } from './layers';
import akl from '../__fixtures__/r3/plan-AKL-EZE.json';
import hel from '../__fixtures__/r3/plan-HEL-ANC.json';
import lhr from '../__fixtures__/r3/plan-LHR-JFK.json';
import nrt from '../__fixtures__/r3/plan-NRT-LAX.json';
import per from '../__fixtures__/r3/plan-PER-LHR.json';
import sin from '../__fixtures__/r3/plan-SIN-JFK.json';
import svo from '../__fixtures__/r3/plan-SVO-LAX.json';
import syd from '../__fixtures__/r3/plan-SYD-SCL.json';

const D = Math.PI / 180;
const plans: Record<string, unknown> = { 'SVO-LAX': svo, 'SYD-SCL': syd, 'LHR-JFK': lhr, 'AKL-EZE': akl, 'SIN-JFK': sin, 'PER-LHR': per, 'NRT-LAX': nrt, 'HEL-ANC': hel };

function project(center: LngLatTuple, zoom: number, H: number, [lng, lat]: LngLatTuple) {
  const R = (512 * 2 ** zoom) / (2 * Math.PI) / Math.cos(center[1] * D);
  const lat0 = center[1] * D;
  const φ = lat * D;
  const dλ = (lng - center[0]) * D;
  const x = R * Math.cos(φ) * Math.sin(dλ);
  const y = R * (Math.cos(lat0) * Math.sin(φ) - Math.sin(lat0) * Math.cos(φ) * Math.cos(dλ));
  const z = R * (Math.sin(lat0) * Math.sin(φ) + Math.cos(lat0) * Math.cos(φ) * Math.cos(dλ));
  const camDist = (0.5 / Math.tan((36.87 / 2) * D)) * H;
  const camZ = R + camDist;
  const s = camDist / (camZ - z);
  return { x: x * s, y: -y * s, visible: z >= (R * R) / camZ };
}

const viewports = [
  { name: 'desktop 1440x900 + panel', w: 1440, h: 900, panel: { side: 'right' as const, size: 424 }, minZoom: 1.2 },
  { name: 'phone 390x844 + 55 % sheet', w: 390, h: 844, panel: { side: 'bottom' as const, size: 520 }, minZoom: 0.3 },
];

function check(code: string, vp: (typeof viewports)[number]) {
  const frame = routeFrame(plans[code] as Plan, null, null)!;
  const viewport = { width: vp.w, height: vp.h };
  const area = frameArea(viewport, vp.panel);
  const cam = solveFrame(frame, { projection: 'globe', viewport, area, minZoom: vp.minZoom })!;
  // MapLibre's own clamp (latitude-adjusted minimum zoom on the globe).
  const used = Math.max(vp.minZoom + Math.log2(Math.cos(cam.center[1] * D)), cam.zoom);
  const pts = framePoints(frame);
  const status = (p: LngLatTuple) => {
    const q = project(cam.center, used, vp.h, p);
    const x = cam.anchor[0] + q.x;
    const y = cam.anchor[1] + q.y;
    return !q.visible ? 'hidden' : x < area.left - 1 || x > area.right + 1 || y < area.top - 1 || y > area.bottom + 1 ? 'off' : 'in';
  };
  return { cam, used, missing: pts.filter((p) => status(p) !== 'in').length, total: pts.length };
}

describe('globe framing at the zoom MapLibre uses (round 3 M2)', () => {
  for (const vp of viewports) {
    for (const code of Object.keys(plans)) {
      it(`${code} · ${vp.name}: the whole route inside the free area at a zoom MapLibre keeps`, () => {
        const r = check(code, vp);
        expect(r.cam.fits).toBe(true);
        expect(r.used).toBeCloseTo(r.cam.zoom, 9);
        expect(r.missing).toBe(0);
        // Centres stay inside MapLibre's ±85.05° clamp.
        expect(Math.abs(r.cam.center[1])).toBeLessThanOrEqual(85.06);
      });
    }
  }

  it('HEL→ANC (over the pole): never centred beyond MapLibre’s 85.05° clamp (the arc midpoint is at 88° N)', () => {
    const frame = routeFrame(plans['HEL-ANC'] as Plan, null, null)!;
    expect(Math.max(...frame.arc.map((p) => p[1]))).toBeGreaterThan(87);
    for (const vp of viewports) expect(Math.abs(check('HEL-ANC', vp).cam.center[1])).toBeLessThanOrEqual(85.06);
  });

  it('a route too big for the area at the minimum zoom is reported as a partial fit, centred on its visible half', () => {
    const frame = routeFrame(plans['SIN-JFK'] as Plan, null, null)!;
    const viewport = { width: 390, height: 844 };
    const tiny = { left: 150, top: 100, right: 240, bottom: 160 };
    const cam = solveFrame(frame, { projection: 'globe', viewport, area: tiny, minZoom: 1.2 })!;
    expect(cam.fits).toBe(false);
    expect(cam.clear).toBe(false);
    expect(cam.anchor).toEqual([195, 130]);
    // Both ends in front of the horizon.
    for (const e of frame.endpoints) expect(project(cam.center, cam.zoom, 844, e.position).visible).toBe(true);
  });
});
