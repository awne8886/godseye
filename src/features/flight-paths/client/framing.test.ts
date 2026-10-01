// @vitest-environment node
/**
 * Round 4 visual-qa m1/m2 (R3-m5/R3-m9 remainders): route framing must keep both endpoint dots and
 * their code labels clear of the measured HUD overlays — on a 390×844 phone (header, view controls,
 * BASEMAP/BLACK MARBLE chips, the 3-line attribution lifted above the 55 % sheet, bottom nav) for
 * LHR-JFK, SYD-SCL, SIN-JFK and HEL-ANC, and in desktop mercator clear of the 48 px left rail.
 * Plans: this server's /api/route/plan, recorded 2026-10-01 03:15Z. Overlay boxes: measured in the
 * app (fixtures below). The check re-projects with an independent implementation of MapLibre's
 * pitch-0 globe (fov 36.87°, radius 512·2^z/2π/cos(centre lat)) and web-mercator.
 */
import { describe, expect, it } from 'vitest';
import type { LngLatTuple } from '@/lib/geo';
import type { Plan } from './api';
import {
  frameArea,
  framePoints,
  hiddenLabels,
  intersects,
  labelBox,
  MARK_CLEAR_PX,
  mercatorRecentre,
  paddingFor,
  placeAnchor,
  type Rect,
  shrinkArea,
  solveFrame,
  zoomFloor,
} from './framing';
import { routeFrame } from './layers';
import { sheetOccupiedPx, sheetRect } from './insets';
import desktopOverlays from '../__fixtures__/r4/overlays-desktop-1600x1000.json';
import phoneOverlays from '../__fixtures__/r4/overlays-phone-390x844.json';
import hel from '../__fixtures__/r3/plan-HEL-ANC.json';
import per from '../__fixtures__/r3/plan-PER-LHR.json';
import lhr from '../__fixtures__/r3/plan-LHR-JFK.json';
import sin from '../__fixtures__/r3/plan-SIN-JFK.json';
import syd from '../__fixtures__/r3/plan-SYD-SCL.json';

const D = Math.PI / 180;
const plans: Record<string, unknown> = { 'LHR-JFK': lhr, 'SYD-SCL': syd, 'SIN-JFK': sin, 'HEL-ANC': hel, 'PER-LHR': per };
const PHONE_CLEAR = ['LHR-JFK', 'SYD-SCL', 'SIN-JFK', 'HEL-ANC'];

/** Independent MapLibre pitch-0 globe: px offset from the padded centre, or null behind the horizon. */
function globe(center: LngLatTuple, zoom: number, H: number, [lng, lat]: LngLatTuple): [number, number] | null {
  const R = (512 * 2 ** zoom) / (2 * Math.PI) / Math.cos(center[1] * D);
  const lat0 = center[1] * D;
  const φ = lat * D;
  const dλ = (lng - center[0]) * D;
  const x = R * Math.cos(φ) * Math.sin(dλ);
  const y = R * (Math.cos(lat0) * Math.sin(φ) - Math.sin(lat0) * Math.cos(φ) * Math.cos(dλ));
  const z = R * (Math.sin(lat0) * Math.sin(φ) + Math.cos(lat0) * Math.cos(φ) * Math.cos(dλ));
  const camDist = (0.5 / Math.tan((36.87 / 2) * D)) * H;
  const camZ = R + camDist;
  if (z < (R * R) / camZ) return null;
  const s = camDist / (camZ - z);
  return [x * s, -y * s];
}

/** Independent web-mercator (world px, unwrapped longitudes). */
function merc(center: LngLatTuple, zoom: number, [lng, lat]: LngLatTuple): [number, number] {
  const w = 512 * 2 ** zoom;
  const X = (l: number) => (w * (l + 180)) / 360;
  const Y = (a: number) => w * (0.5 - Math.log(Math.tan(Math.PI / 4 + (a * D) / 2)) / (2 * Math.PI));
  return [X(lng) - X(center[0]), Y(lat) - Y(center[1])];
}

const rects = (o: { rects: { name: string; rect: Rect }[] }) => o.rects.map((r) => r.rect);
const panelOf = (o: { panel: { side: string; size: number } }) => o.panel as { side: 'right' | 'bottom'; size: number };

interface Placed {
  label: string;
  dot: Rect;
  box: Rect;
}

/** Where the endpoints and labels land for a solved camera, by the independent projections. */
function placed(code: string, sol: NonNullable<ReturnType<typeof solveFrame>>, projection: 'globe' | 'mercator', H: number): Placed[] {
  const frame = routeFrame(plans[code] as Plan, null, null)!;
  return frame.endpoints.map((e) => {
    const xy = projection === 'globe' ? globe(sol.center, sol.zoom, H, e.position) : merc(sol.center, sol.zoom, e.position);
    expect(xy, `${code} ${e.label} behind the horizon`).not.toBeNull();
    const x = sol.anchor[0] + xy![0];
    const y = sol.anchor[1] + xy![1];
    const lb = labelBox(e.label, e.labelOffset!);
    return { label: e.label, dot: { left: x - 7, right: x + 7, top: y - 7, bottom: y + 7 }, box: { left: x + lb.left, right: x + lb.right, top: y + lb.top, bottom: y + lb.bottom } };
  });
}

function allInArea(code: string, sol: NonNullable<ReturnType<typeof solveFrame>>, projection: 'globe' | 'mercator', H: number, area: Rect): boolean {
  const frame = routeFrame(plans[code] as Plan, null, null)!;
  return framePoints(frame).every((p) => {
    const xy = projection === 'globe' ? globe(sol.center, sol.zoom, H, p) : merc(sol.center, sol.zoom, p);
    if (!xy) return false;
    const x = sol.anchor[0] + xy[0];
    const y = sol.anchor[1] + xy[1];
    return x >= area.left - 1 && x <= area.right + 1 && y >= area.top - 1 && y <= area.bottom + 1;
  });
}

describe('phone 390×844: endpoints and labels clear of the chip/attribution stack (visual-qa m1)', () => {
  const viewport = { width: 390, height: 844 };
  const area = frameArea(viewport, panelOf(phoneOverlays));
  const PHONE_MIN_ZOOM = 0.3;
  for (const withBasemapChip of [true, false]) {
    const obstacles = rects(phoneOverlays).filter((_, i) => withBasemapChip || phoneOverlays.rects[i]!.name !== 'imagery-chip-basemap');
    for (const code of PHONE_CLEAR) {
      it(`${code}${withBasemapChip ? ' (BASEMAP INCOMPLETE chip showing)' : ''}: whole route in the area, both marks clear`, () => {
        const frame = routeFrame(plans[code] as Plan, null, null)!;
        const sol = solveFrame(frame, { projection: 'globe', viewport, area, obstacles, minZoom: PHONE_MIN_ZOOM, maxZoom: 8 })!;
        expect(sol.fits).toBe(true);
        expect(sol.clear).toBe(true);
        // The zoom MapLibre will keep (its latitude-adjusted minimum).
        expect(sol.zoom).toBeGreaterThanOrEqual(PHONE_MIN_ZOOM + Math.log2(Math.cos(sol.center[1] * D)) - 1e-9);
        expect(allInArea(code, sol, 'globe', viewport.height, area)).toBe(true);
        for (const m of placed(code, sol, 'globe', viewport.height)) {
          for (const [i, o] of obstacles.entries()) {
            const name = phoneOverlays.rects.find((r) => r.rect === o)?.name ?? String(i);
            expect(intersects(m.box, o), `${code} ${m.label} label under ${name}`).toBe(false);
            expect(intersects(m.dot, o), `${code} ${m.label} dot under ${name}`).toBe(false);
          }
          // Inside the viewport, below the header band and above the sheet.
          expect(m.box.left).toBeGreaterThanOrEqual(0);
          expect(m.box.right).toBeLessThanOrEqual(viewport.width);
          expect(m.box.top).toBeGreaterThanOrEqual(64);
          expect(m.box.bottom).toBeLessThanOrEqual(viewport.height - panelOf(phoneOverlays).size);
        }
        // MapLibre padding puts the centre exactly at the solved anchor.
        const pad = sol.padding;
        expect((pad.left + viewport.width - pad.right) / 2).toBeCloseTo(sol.anchor[0], 0);
        expect((pad.top + viewport.height - pad.bottom) / 2).toBeCloseTo(sol.anchor[1], 0);
      });
    }
  }
});

describe('phone 390×844: a route that cannot be framed clear says which endpoint the chrome covers (round 4 fix pass)', () => {
  const viewport = { width: 390, height: 844 };
  const area = frameArea(viewport, panelOf(phoneOverlays), true);
  for (const withBasemapChip of [true, false]) {
    const obstacles = rects(phoneOverlays).filter((_, i) => withBasemapChip || phoneOverlays.rects[i]!.name !== 'imagery-chip-basemap');
    it(`PER-LHR${withBasemapChip ? ' (BASEMAP INCOMPLETE chip showing)' : ''}: fits, keeps one end clear, and \`hidden\` is exactly the covered end`, () => {
      const frame = routeFrame(per as unknown as Plan, null, null)!;
      const sol = solveFrame(frame, { projection: 'globe', viewport, area, obstacles, minZoom: 0.3, maxZoom: 8 })!;
      expect(sol.fits).toBe(true);
      expect(sol.clear).toBe(false);
      expect(allInArea('PER-LHR', sol, 'globe', viewport.height, area)).toBe(true);
      // Independent projection: the endpoints whose dot or label overlaps an overlay are the hidden ones.
      const covered = placed('PER-LHR', sol, 'globe', viewport.height)
        .filter((m) => obstacles.some((o) => intersects(m.box, o) || intersects(m.dot, o)))
        .map((m) => m.label);
      expect(sol.hidden).toEqual(covered);
      expect(sol.hidden.length).toBeGreaterThan(0);
      expect(sol.hidden.length).toBeLessThan(frame.endpoints.length);
    });
  }

  it('hiddenLabels lists each covered endpoint once, in order', () => {
    const o = { left: 0, top: 0, right: 10, bottom: 10 };
    const at = (label: string, x: number) => ({ label, box: { left: x, top: 0, right: x + 5, bottom: 5 } });
    expect(hiddenLabels([at('PER', 2), at('PER', 4), at('LHR', 50)], [o])).toEqual(['PER']);
    expect(hiddenLabels([at('PER', 50), at('LHR', 2)], [o])).toEqual(['LHR']);
    expect(hiddenLabels([at('PER', 2)], [])).toEqual([]);
  });
});

describe('landscape phone 844×390 (phone layout by media query): marks clear of the sheet (round 4 fix pass)', () => {
  const viewport = { width: 844, height: 390 };
  // The sheet at its CSS bound (no published height yet): 56 px nav + 55vh.
  const sheet = sheetRect(viewport, sheetOccupiedPx('', viewport.height));
  const area = frameArea(viewport, { side: 'bottom', size: viewport.height - sheet.top }, true);
  for (const code of ['LHR-JFK', 'SYD-SCL']) {
    it(`${code}: no 48 px rail in the area, both endpoint marks above the sheet`, () => {
      expect(area.left).toBe(16);
      const frame = routeFrame(plans[code] as Plan, null, null)!;
      const sol = solveFrame(frame, { projection: 'globe', viewport, area, obstacles: [sheet], minZoom: 0.3, maxZoom: 8 })!;
      expect(sol.fits && sol.clear).toBe(true);
      for (const m of placed(code, sol, 'globe', viewport.height)) {
        expect(m.box.bottom).toBeLessThanOrEqual(sheet.top);
        expect(m.dot.bottom).toBeLessThanOrEqual(sheet.top);
      }
    });
  }
});

describe('desktop 1600×1000: the JFK label clears the left rail in mercator (visual-qa m2)', () => {
  const viewport = { width: 1600, height: 1000 };
  const area = frameArea(viewport, panelOf(desktopOverlays));
  const obstacles = rects(desktopOverlays);
  for (const projection of ['mercator', 'globe'] as const) {
    it(`LHR-JFK ${projection}: every mark clear of every overlay (rail, view controls, header), route in the area`, () => {
      const frame = routeFrame(lhr as unknown as Plan, null, null)!;
      const sol = solveFrame(frame, { projection, viewport, area, obstacles, minZoom: 1.2, maxZoom: 8 })!;
      expect(sol.fits && sol.clear).toBe(true);
      expect(allInArea('LHR-JFK', sol, projection, viewport.height, area)).toBe(true);
      const rail = desktopOverlays.rects.find((r) => r.name === 'rail')!.rect;
      for (const m of placed('LHR-JFK', sol, projection, viewport.height)) {
        expect(m.box.left).toBeGreaterThanOrEqual(rail.right + MARK_CLEAR_PX);
        for (const o of obstacles) expect(intersects(m.box, o), `${m.label} label`).toBe(false);
      }
      // The route is framed large: LHR→JFK spans most of the free width.
      const [a, b] = placed('LHR-JFK', sol, projection, viewport.height);
      expect(Math.abs(a!.dot.left - b!.dot.left)).toBeGreaterThan((area.right - area.left) * 0.6);
    });
  }
});

describe('solver pieces', () => {
  it('paddingFor puts MapLibre’s padded centre at the anchor with non-negative padding', () => {
    const vp = { width: 390, height: 844 };
    for (const a of [[195, 422], [100, 160], [300, 700]] as [number, number][]) {
      const p = paddingFor(a, vp);
      expect(Math.min(p.left, p.right, p.top, p.bottom)).toBeGreaterThanOrEqual(0);
      expect((p.left + vp.width - p.right) / 2).toBeCloseTo(a[0], 0);
      expect((p.top + vp.height - p.bottom) / 2).toBeCloseTo(a[1], 0);
    }
  });

  it('placeAnchor slides a shape so its mark dodges an obstacle, or gives up when it cannot', () => {
    const area = { left: 0, top: 0, right: 400, bottom: 300 };
    const shape = { ext: { left: -50, top: -20, right: 50, bottom: 20 }, marks: [{ left: -50, top: -10, right: -30, bottom: 10 }] };
    // Centred, the mark (x 150–170, y 140–160) would sit under this obstacle.
    const obstacle = { left: 100, top: 100, right: 200, bottom: 200 };
    const a = placeAnchor(shape, area, [obstacle])!;
    const mark = { left: a[0] - 50, top: a[1] - 10, right: a[0] - 30, bottom: a[1] + 10 };
    expect(intersects({ left: mark.left - MARK_CLEAR_PX + 0.01, top: mark.top - MARK_CLEAR_PX + 0.01, right: mark.right + MARK_CLEAR_PX - 0.01, bottom: mark.bottom + MARK_CLEAR_PX - 0.01 }, obstacle)).toBe(false);
    expect(a[0] - 50).toBeGreaterThanOrEqual(0);
    expect(a[1] + 20).toBeLessThanOrEqual(300);
    // An obstacle covering the whole area leaves no anchor.
    expect(placeAnchor(shape, area, [{ left: -10, top: -10, right: 410, bottom: 310 }])).toBeNull();
    // A shape larger than the area has no anchor either.
    expect(placeAnchor({ ext: { left: -300, top: 0, right: 300, bottom: 1 }, marks: [] }, area, [])).toBeNull();
  });

  it('shrinkArea cuts the desktop view-controls bar off the bottom but leaves phone chips to the marks', () => {
    const desk = { left: 88, top: 104, right: 1136, bottom: 932 };
    const controls = desktopOverlays.rects.find((r) => r.name === 'view-controls')!.rect;
    expect(shrinkArea(desk, [controls]).bottom).toBe(controls.top - MARK_CLEAR_PX);
    const phone = frameArea({ width: 390, height: 844 }, panelOf(phoneOverlays));
    const attribution = phoneOverlays.rects.find((r) => r.name === 'attribution')!.rect;
    const shrunk = shrinkArea(phone, rects(phoneOverlays));
    // Never below half of either axis.
    expect(shrunk.bottom - shrunk.top).toBeGreaterThanOrEqual((phone.bottom - phone.top) / 2);
    expect(shrunk.right - shrunk.left).toBeGreaterThanOrEqual((phone.right - phone.left) / 2);
    expect(shrunk.top).toBeGreaterThanOrEqual(phone.top);
    expect(attribution.top).toBeGreaterThan(phone.top);
  });

  it('zoomFloor follows MapLibre: the globe minimum is latitude-adjusted, mercator keeps the world a viewport tall', () => {
    const env = { projection: 'globe' as const, viewport: { width: 390, height: 844 } };
    expect(zoomFloor(env, [0, 0], 0.3)).toBeCloseTo(0.3);
    expect(zoomFloor(env, [0, 60], 0.3)).toBeCloseTo(0.3 - 1);
    expect(zoomFloor({ ...env, projection: 'mercator' }, [0, 60], 0.3)).toBeCloseTo(Math.log2(844 / 512));
    expect(zoomFloor({ ...env, projection: 'mercator', viewport: { width: 1600, height: 1000 } }, [0, 0], 1.2)).toBe(1.2);
  });

  it('mercatorRecentre moves the centre inside MapLibre’s latitude clamp without moving the drawing', () => {
    const H = 844;
    const zoom = 1;
    const center: LngLatTuple = [-40, 60];
    const anchor: [number, number] = [195, 180];
    const r = mercatorRecentre(center, zoom, anchor, H);
    const w = 512 * 2 ** zoom;
    const y = (lat: number) => w * (0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * D) / 2)) / (2 * Math.PI));
    expect(y(r.center[1])).toBeCloseTo(H / 2, 3); // pulled down to the clamp
    // JFK lands on the same screen point either way.
    const jfk: LngLatTuple = [-73.78, 40.64];
    const before = merc(center, zoom, jfk).map((v, i) => v + anchor[i]!);
    const after = merc(r.center, zoom, jfk).map((v, i) => v + r.anchor[i]!);
    expect(after[0]).toBeCloseTo(before[0]!, 6);
    expect(after[1]).toBeCloseTo(before[1]!, 6);
    // Already inside the clamp: unchanged.
    expect(mercatorRecentre([0, 10], 3, anchor, H)).toEqual({ center: [0, 10], anchor });
  });
});
