// R4 round 3 M2: the globe camera must frame the whole route at the zoom MapLibre actually uses
// (MapView clamps to minZoom 1.2), with the polar 1/cos(lat) globe inflation accounted for.
// Plans recorded from this server's /api/route/plan on 2026-10-01 03:15Z. The check below is an
// independent re-implementation of MapLibre's pitch-0 globe perspective (fov 36.87°,
// cameraToCenterDistance = 0.5/tan(fov/2)·H, radius = 512·2^z/2π/cos(centre lat)).
import { describe, expect, it } from 'vitest';
import type { LngLatTuple } from '@/lib/geo';
import type { Plan } from './api';
import { framePadding, framePoints, globeCamera, routeFrame } from './layers';
import akl from '../__fixtures__/r3/plan-AKL-EZE.json';
import hel from '../__fixtures__/r3/plan-HEL-ANC.json';
import lhr from '../__fixtures__/r3/plan-LHR-JFK.json';
import nrt from '../__fixtures__/r3/plan-NRT-LAX.json';
import per from '../__fixtures__/r3/plan-PER-LHR.json';
import sin from '../__fixtures__/r3/plan-SIN-JFK.json';
import svo from '../__fixtures__/r3/plan-SVO-LAX.json';
import syd from '../__fixtures__/r3/plan-SYD-SCL.json';

const MAP_MIN_ZOOM = 1.2;
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
  { name: 'desktop 1440x900 + panel', w: 1440, h: 900, panel: { side: 'right' as const, size: 424 } },
  { name: 'phone 390x844 + 45 % sheet', w: 390, h: 844, panel: { side: 'bottom' as const, size: Math.round(844 * 0.45) } },
];

function check(code: string, vp: (typeof viewports)[number], minZoom: number) {
  const frame = routeFrame(plans[code] as Plan, null, null)!;
  const pad = framePadding({ width: vp.w, height: vp.h }, vp.panel);
  const cam = globeCamera(frame, { width: vp.w, height: vp.h }, pad, { minZoom })!;
  const used = Math.max(minZoom, cam.zoom);
  const halfW = (vp.w - pad.left - pad.right) / 2;
  const halfH = (vp.h - pad.top - pad.bottom) / 2;
  const pts = framePoints(frame);
  const status = (p: LngLatTuple) => {
    const q = project(cam.center, used, vp.h, p);
    return !q.visible ? 'hidden' : Math.abs(q.x) > halfW + 1 || Math.abs(q.y) > halfH + 1 ? 'off' : 'in';
  };
  return { cam, used, missing: pts.filter((p) => status(p) !== 'in').length, endsFacing: frame.endpoints.filter((e) => status(e.position) !== 'hidden').length, inView: pts.filter((p) => status(p) === 'in').length, total: pts.length };
}

describe('globe framing at the zoom MapLibre uses (round 3 M2)', () => {
  for (const vp of viewports) {
    for (const code of Object.keys(plans)) {
      it(`${code} · ${vp.name}: whole route in view, or an honest partial fit with both ends visible`, () => {
        const r = check(code, vp, MAP_MIN_ZOOM);
        expect(r.cam.zoom).toBeGreaterThanOrEqual(MAP_MIN_ZOOM);
        if (r.cam.fits) expect(r.missing).toBe(0);
        else {
          expect(r.cam.zoom).toBe(MAP_MIN_ZOOM);
          // The visible-hemisphere centre: both ends in front of the horizon, most of the arc on screen.
          expect(r.endsFacing).toBe(2);
          // (A 310×320 px padded phone view is smaller than the 1.2-zoom globe: SIN→JFK ~1/3 on screen.)
          expect(r.inView / r.total).toBeGreaterThan(0.3);
        }
      });
    }
  }

  it('desktop fits every recorded route, SIN→JFK and HEL→ANC included', () => {
    for (const code of Object.keys(plans)) expect(check(code, viewports[0]!, MAP_MIN_ZOOM).cam.fits, code).toBe(true);
  });

  it('HEL→ANC (over the pole) is not centred at 88° N any more', () => {
    expect(Math.abs(check('HEL-ANC', viewports[0]!, MAP_MIN_ZOOM).cam.center[1])).toBeLessThan(80);
  });

  it('with the phone minimum zoom lowered (requested of map-engine) every phone case fits', () => {
    for (const code of Object.keys(plans)) {
      const r = check(code, viewports[1]!, 0.3);
      expect(r.cam.fits, code).toBe(true);
      expect(r.missing, code).toBe(0);
    }
  });
});
