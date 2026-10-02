/**
 * R2 round 5 MAJOR-2: the satellite far-side filter. A satellite is drawn (and therefore pickable)
 * only while it is above the camera's horizon at the altitude it is DRAWN at; the old filter kept
 * everything within 90° of the map centre, which drew LEO satellites behind the limb and hid GEO
 * satellites that rise above it. Checked against an independent line-of-sight test (segment
 * camera→satellite against the sphere). Fixture: recorded CelesTrak `active` sample (2026-09-30).
 */
import { describe, expect, it } from 'vitest';
import { fx } from '../__fixtures__';
import { altitudeForZoom, EARTH_RADIUS_M, type FarSideCamera } from '@/lib/map/far-side';
import { centralAngle } from '@/lib/geo';
import { SAT_CATEGORIES, ommToRecord, recordToOmm } from './catalog';
import { satrecFromOmm } from './orbit';
import { ISS_SIZE_PX, SAT_CATEGORY_COUNT, SAT_SIZE_PX, SELECTED_SIZE_PX, compactFrame, propagateBatch, propagateVisible } from './propagate-batch';

const AT = Date.parse('2026-09-30T18:00:00Z');
const recs = fx.active.map((o) => ommToRecord(o)!);
const input = {
  satrecs: recs.map((r) => satrecFromOmm(recordToOmm(r))),
  noradIds: recs.map((r) => r.noradId),
  categories: recs.map((r) => SAT_CATEGORIES.indexOf(r.category)),
};
const palette = SAT_CATEGORIES.map(() => [255, 255, 255, 255] as const);
const all = new Set(SAT_CATEGORIES.map((_, i) => i));
const RAD = Math.PI / 180;

/** Camera over (lng, lat) at a zoom, 1000 px viewport (MapLibre's default FOV). */
const cameraAt = (lng: number, lat: number, zoom: number): FarSideCamera => ({ lng, lat, altitude: altitudeForZoom(lat, zoom, 1000) });

function ecef(lng: number, lat: number, r: number): [number, number, number] {
  return [r * Math.cos(lat * RAD) * Math.cos(lng * RAD), r * Math.cos(lat * RAD) * Math.sin(lng * RAD), r * Math.sin(lat * RAD)];
}

/**
 * Independent visibility: the closest approach of the segment camera→point to the Earth's centre,
 * minus R (> 0: clear line of sight, < 0: the globe is in the way).
 */
function lineOfSightMarginM(cam: FarSideCamera, lng: number, lat: number, altM: number): number {
  const [cx, cy, cz] = ecef(cam.lng, cam.lat, EARTH_RADIUS_M + cam.altitude);
  const [px, py, pz] = ecef(lng, lat, EARTH_RADIUS_M + altM);
  const [dx, dy, dz] = [px - cx, py - cy, pz - cz];
  const t = Math.min(1, Math.max(0, -(cx * dx + cy * dy + cz * dz) / (dx * dx + dy * dy + dz * dz)));
  return Math.hypot(cx + t * dx, cy + t * dy, cz + t * dz) - EARTH_RADIUS_M;
}

describe('far-side filter: camera horizon + the satellite display altitude', () => {
  const prop = propagateVisible(input, { at: AT, visible: all, selectedId: null });

  it.each([
    [-98, 39, 2],
    [-98, 39, 4],
    [-98, 39, 6],
    [120, -20, 4],
  ])('camera over (%d, %d) at zoom %d draws exactly the satellites in line of sight', (lng, lat, zoom) => {
    const cam = cameraAt(lng, lat, zoom);
    const f = propagateBatch(input, { at: AT, palette, visible: all, camera: cam, selectedId: null });
    expect(f.camera).toEqual(cam);
    const drawn = new Set(f.index);
    let visible = 0;
    let grazing = 0;
    for (let j = 0; j < prop.n; j++) {
      const margin = lineOfSightMarginM(cam, prop.lng[j]!, prop.lat[j]!, prop.displayAltM[j]!);
      if (Math.abs(margin) < 1) {
        grazing++; // grazing the limb within a metre: either answer is right
        continue;
      }
      const i = prop.catIndex[j]!;
      expect(drawn.has(i), `NORAD ${input.noradIds[i]} margin ${margin.toFixed(0)} m`).toBe(margin > 0);
      if (margin > 0) visible++;
    }
    expect(f.count).toBeGreaterThan(0);
    expect(f.count).toBeLessThan(prop.n);
    expect(Math.abs(f.count - visible)).toBeLessThanOrEqual(grazing);
    expect(f.count + f.hidden + f.failed).toBe(recs.length);
  });

  /** Satellites the old rule got wrong for this camera, both ways. */
  function oldRuleErrors(cam: FarSideCamera): { hiddenWithin90: number; drawnBeyond90: number } {
    const drawn = new Set(propagateBatch(input, { at: AT, palette, visible: all, camera: cam, selectedId: null }).index);
    let hiddenWithin90 = 0;
    let drawnBeyond90 = 0;
    for (let j = 0; j < prop.n; j++) {
      const d = centralAngle([cam.lng, cam.lat], [prop.lng[j]!, prop.lat[j]!]) / RAD;
      const isDrawn = drawn.has(prop.catIndex[j]!);
      if (d <= 90 && !isDrawn) hiddenWithin90++;
      if (d > 90 && isDrawn) drawnBeyond90++;
    }
    return { hiddenWithin90, drawnBeyond90 };
  }

  it('zoomed in, satellites behind the limb but within 90° of the centre are no longer drawn (or hit)', () => {
    // z4 over the US: horizon 58° + LEO display altitude 20° ≈ 78°; the old rule drew 78–90°.
    const z4 = oldRuleErrors(cameraAt(-98, 39, 4));
    const z6 = oldRuleErrors(cameraAt(-98, 39, 6));
    expect(z4.hiddenWithin90).toBeGreaterThan(0);
    expect(z6.hiddenWithin90).toBeGreaterThan(z4.hiddenWithin90);
    expect(z6.hiddenWithin90 / prop.n).toBeGreaterThan(0.1);
  });

  it('zoomed out, satellites rising above the limb beyond 90° are drawn (the old rule hid them)', () => {
    expect(oldRuleErrors(cameraAt(0, 0, 2)).drawnBeyond90).toBeGreaterThan(0);
  });

  it('a camera move re-filters the same propagation (no SGP4) and matches a fresh batch', () => {
    for (const cam of [cameraAt(-98, 39, 4), cameraAt(10, 50, 5), null]) {
      const again = compactFrame(input, prop, { palette, visible: all, camera: cam, selectedId: 25544 });
      const fresh = propagateBatch(input, { at: AT, palette, visible: all, camera: cam, selectedId: 25544 });
      expect(Array.from(again.index)).toEqual(Array.from(fresh.index));
      expect(Array.from(again.positions)).toEqual(Array.from(fresh.positions));
      expect(again.selected).toEqual(fresh.selected);
      expect(again.at).toBe(AT);
    }
  });

  it('mercator (camera null) draws every propagated satellite; a hidden category is dropped on re-filter', () => {
    const merc = compactFrame(input, prop, { palette, visible: all, camera: null, selectedId: null });
    expect(merc.count).toBe(prop.n);
    const nav = SAT_CATEGORIES.indexOf('navigation');
    const navOnly = compactFrame(input, prop, { palette, visible: new Set([nav]), camera: null, selectedId: null });
    expect(navOnly.count).toBeGreaterThan(0);
    for (const i of navOnly.index) expect(input.categories[i]).toBe(nav);
    expect(navOnly.count + navOnly.hidden + navOnly.failed).toBe(recs.length);
  });

  it('r10 MAJOR 1: mercator (`flat`) draws every marker on its sub-satellite point (z = 0), the globe at its display altitude', () => {
    const flat = compactFrame(input, prop, { palette, visible: all, camera: null, selectedId: null, flat: true });
    const raised = compactFrame(input, prop, { palette, visible: all, camera: null, selectedId: null });
    expect(flat.flat).toBe(true);
    expect(raised.flat).toBe(false);
    expect(flat.count).toBe(raised.count);
    expect(flat.count).toBeGreaterThan(0);
    for (let k = 0; k < flat.count; k++) {
      expect(flat.positions[k * 3 + 2]).toBe(0);
      expect(flat.positions[k * 3]).toBe(raised.positions[k * 3]);
      expect(flat.positions[k * 3 + 1]).toBe(raised.positions[k * 3 + 1]);
      expect(raised.positions[k * 3 + 2]).toBeGreaterThan(0);
    }
  });

  it('the selected satellite keeps its telemetry when it is behind the globe, but is not drawn there', () => {
    const cam = cameraAt(-98, 39, 6);
    // Find a satellite behind the globe for this camera and select it.
    const f0 = propagateBatch(input, { at: AT, palette, visible: all, camera: cam, selectedId: null });
    const drawn = new Set(f0.index);
    const j = Array.from({ length: prop.n }, (_, k) => k).find((k) => !drawn.has(prop.catIndex[k]!))!;
    const id = input.noradIds[prop.catIndex[j]!]!;
    const f = propagateBatch(input, { at: AT, palette, visible: all, camera: cam, selectedId: id });
    expect(f.selected?.noradId).toBe(id);
    expect(Array.from(f.index)).not.toContain(prop.catIndex[j]);
  });
});

describe('category-sorted output for the per-mission IconLayers (L105)', () => {
  const prop = propagateVisible(input, { at: AT, visible: all, selectedId: null });
  const nav = SAT_CATEGORIES.indexOf('navigation');

  it('SAT_CATEGORY_COUNT matches SAT_CATEGORIES', () => {
    expect(SAT_CATEGORY_COUNT).toBe(SAT_CATEGORIES.length);
  });

  it.each([null, cameraAt(-98, 39, 4)])('rows are grouped by category with offsets, stable within a category (camera %o)', (cam) => {
    const f = compactFrame(input, prop, { palette, visible: all, camera: cam, selectedId: null });
    const o = f.categoryOffsets;
    expect(o).toHaveLength(SAT_CATEGORY_COUNT + 1);
    expect(o[0]).toBe(0);
    expect(o[SAT_CATEGORY_COUNT]).toBe(f.count);
    let nonEmpty = 0;
    for (let c = 0; c < SAT_CATEGORY_COUNT; c++) {
      expect(o[c + 1]!).toBeGreaterThanOrEqual(o[c]!);
      if (o[c + 1]! > o[c]!) nonEmpty++;
      for (let k = o[c]!; k < o[c + 1]!; k++) {
        expect(input.categories[f.index[k]!]).toBe(c);
        if (k > o[c]!) expect(f.index[k]!).toBeGreaterThan(f.index[k - 1]!);
      }
    }
    expect(nonEmpty).toBeGreaterThan(1);
    // The same satellites as an unsorted filter: every propagated row is either drawn or hidden once.
    expect(new Set(f.index).size).toBe(f.count);
    expect(f.count + f.hidden + f.failed).toBe(recs.length);
  });

  it('positions, colours and sizes travel with their row through the sort', () => {
    const f = compactFrame(input, prop, { palette: SAT_CATEGORIES.map((_, c) => [c * 40, 10, 20, 255] as const), visible: all, camera: null, selectedId: 25544 });
    const row = new Map(Array.from({ length: prop.n }, (_, j) => [prop.catIndex[j]!, j]));
    for (let k = 0; k < f.count; k++) {
      const i = f.index[k]!;
      const j = row.get(i)!;
      expect(f.positions[k * 3]).toBeCloseTo(prop.lng[j]!, 4);
      expect(f.positions[k * 3 + 1]).toBeCloseTo(prop.lat[j]!, 4);
      expect(f.colors[k * 4]).toBe(input.categories[i]! * 40);
      const id = input.noradIds[i];
      expect(f.sizes[k]).toBe(id === 25544 ? SELECTED_SIZE_PX : SAT_SIZE_PX);
    }
    const iss = compactFrame(input, prop, { palette, visible: all, camera: null, selectedId: null });
    const k = Array.from(iss.index).findIndex((i) => input.noradIds[i] === 25544);
    expect(k).toBeGreaterThanOrEqual(0);
    expect(iss.sizes[k]).toBe(ISS_SIZE_PX);
  });

  it('a selected satellite in a hidden category is drawn in its own category slice', () => {
    const id = input.noradIds[input.categories.findIndex((c) => c !== nav)]!;
    const selCat = input.categories[input.noradIds.indexOf(id)]!;
    const p = propagateVisible(input, { at: AT, visible: new Set([nav]), selectedId: id });
    const f = compactFrame(input, p, { palette, visible: new Set([nav]), camera: null, selectedId: id });
    const o = f.categoryOffsets;
    expect(o[selCat + 1]! - o[selCat]!).toBe(1);
    expect(input.noradIds[f.index[o[selCat]!]!]).toBe(id);
  });

  it('propagating into the previous tick reuses its buffers and gives the same answer as a fresh propagation', () => {
    const first = propagateVisible(input, { at: AT, visible: all, selectedId: null });
    const buffers = [first.catIndex, first.lng, first.lat, first.altKm, first.displayAltM, first.velocityKmS, first.shadow];
    const next = propagateVisible(input, { at: AT + 1000, visible: all, selectedId: null }, first);
    expect(next).toBe(first);
    expect([next.catIndex, next.lng, next.lat, next.altKm, next.displayAltM, next.velocityKmS, next.shadow]).toEqual(buffers);
    for (let b = 0; b < buffers.length; b++) expect([next.catIndex, next.lng, next.lat, next.altKm, next.displayAltM, next.velocityKmS, next.shadow][b]).toBe(buffers[b]);
    const fresh = propagateVisible(input, { at: AT + 1000, visible: all, selectedId: null });
    expect(next.n).toBe(fresh.n);
    expect(Array.from(next.lng.subarray(0, next.n))).toEqual(Array.from(fresh.lng.subarray(0, fresh.n)));
    expect(next.at).toBe(AT + 1000);
    // A catalogue that grew does not fit: fresh buffers.
    const bigger = { satrecs: [...input.satrecs, ...input.satrecs], noradIds: [...input.noradIds, ...input.noradIds], categories: [...input.categories, ...input.categories] };
    expect(propagateVisible(bigger, { at: AT, visible: all, selectedId: null }, first)).not.toBe(first);
  });

  it('20k satellites: a camera re-filter stays far inside the 1 s tick (and the frame budget)', () => {
    // Timing input only: the recorded sample tiled to 20k rows (never shipped, never drawn).
    const reps = Math.ceil(20_000 / input.satrecs.length);
    const big = {
      satrecs: Array.from({ length: reps }, () => input.satrecs).flat(),
      noradIds: Array.from({ length: reps }, () => input.noradIds).flat(),
      categories: Array.from({ length: reps }, () => input.categories).flat(),
    };
    // Wall-clock on a shared CI runner swings 2–3× with load (r10 MINOR 3: a 40 ms bound read
    // 66.6 ms), so the check is twofold. Relative: the re-filter is timed against the SGP4 pass on
    // the same machine in the same moment, and must stay a small fraction of it — the regression
    // that matters (SGP4 or a per-row allocation creeping into the camera path) costs as much as
    // the SGP4 pass itself, whatever the load. Absolute: the fastest of 9 runs (load only ever adds
    // time) must stay far inside the 1 s tick.
    const sgp4: number[] = [];
    let p = propagateVisible(big, { at: AT, visible: all, selectedId: null });
    for (let r = 0; r < 3; r++) {
      const t0 = performance.now();
      p = propagateVisible(big, { at: AT, visible: all, selectedId: null }, p);
      sgp4.push(performance.now() - t0);
    }
    expect(p.n).toBeGreaterThanOrEqual(19_000);
    const cam = cameraAt(-98, 39, 3);
    compactFrame(big, p, { palette, visible: all, camera: cam, selectedId: null }); // warm-up
    const runs: number[] = [];
    for (let r = 0; r < 9; r++) {
      const t0 = performance.now();
      compactFrame(big, p, { palette, visible: all, camera: cam, selectedId: null });
      runs.push(performance.now() - t0);
    }
    const fastest = Math.min(...runs);
    expect(fastest).toBeLessThan(Math.min(...sgp4) / 3);
    expect(fastest).toBeLessThan(150);
  });
});
