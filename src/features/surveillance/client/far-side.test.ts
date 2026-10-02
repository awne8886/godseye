/**
 * Round 5 (visual-qa MAJOR-1): camera points on the globe draw with depthCompare 'always' (never
 * half-clipped by the surface) and are far-side filtered — not drawn and not pickable behind the
 * limb. Rows come from the recorded operator fixtures (Hong Kong, Los Angeles, Washington, Spain,
 * New Zealand), turned into the same columnar rows /api/cctv serves.
 */
import { describe, expect, it } from 'vitest';
import { toColumnar, type Cell } from '@/lib/columnar';
import { horizonAngleDeg, isFacing, type FarSideCamera } from '@/lib/map/far-side';
import { CAMERA_FIELDS } from '@/lib/schemas/surveillance';
import * as A from '../server/adapters';
import { FX, json, text } from '../server/__fixtures__';
import { cameraPointsLayer, cameraSelection, CCTV_DECK_ID } from './camera-layer';
import { CCTV_POINT_PARAMETERS, facingRows, unitVectors } from './far-side';
import { IDX } from './rows';

const cams = [
  ...A.parseHongKong(text(FX.hktd)),
  ...A.parseCaltrans(json(FX.caltrans), 7),
  ...A.parseWsdotKml(text(FX.wsdot)),
  ...A.parseDgt(json(FX.dgt)),
  ...A.parseNzta(text(FX.nzta)),
];
const { rows } = toColumnar(cams, CAMERA_FIELDS);
const units = unitVectors(rows, IDX.lng, IDX.lat);
const providers = (r: readonly Cell[][]) => [...new Set(r.map((x) => x[IDX.providerId]))].sort();

/** Camera above Hong Kong at about zoom 3 (≈ 9 300 km up: horizon ≈ 66°). */
const OVER_HK: FarSideCamera = { lng: 114.17, lat: 22.3, altitude: 9_300_000 };
const COLORS = { live: [0, 230, 118, 242] as [number, number, number, number], still: [0, 230, 118, 191] as [number, number, number, number], link: [0, 230, 118, 77] as [number, number, number, number] };

describe('camera points on the globe', () => {
  it('draw with the globe-safe GPU state: no face culling, no depth test against the globe', () => {
    expect(CCTV_POINT_PARAMETERS).toEqual({ cullMode: 'none', depthCompare: 'always' });
    const layer = cameraPointsLayer(rows, COLORS, 2, 'HORUS');
    expect(layer.id).toBe(CCTV_DECK_ID);
    expect(layer.props.parameters).toEqual({ cullMode: 'none', depthCompare: 'always' });
    expect(layer.props.pickable).toBe(true);
    expect(layer.props.data).toBe(rows);
  });

  it('over Hong Kong at ~z3 keep Hong Kong, drop Los Angeles, Washington and Spain (behind the limb)', () => {
    expect(horizonAngleDeg(OVER_HK.altitude)).toBeGreaterThan(60);
    expect(horizonAngleDeg(OVER_HK.altitude)).toBeLessThan(70);
    const seen = facingRows(rows, units, OVER_HK);
    expect(providers(seen)).toEqual(['hktd']);
    expect(seen.length).toBe(rows.filter((r) => r[IDX.providerId] === 'hktd').length);
    // What the layer draws is exactly this set: far-side rows never reach deck (not drawn, not picked).
    expect(cameraPointsLayer(seen, COLORS, 2, 'HORUS').props.data).toBe(seen);
  });

  it('matches isFacing() for every camera from many viewpoints (incl. across the antimeridian)', () => {
    const views: FarSideCamera[] = [
      OVER_HK,
      { lng: -118.25, lat: 34.05, altitude: 2_000_000 },
      { lng: -100, lat: 40, altitude: 20_000_000 },
      { lng: 179.5, lat: -40, altitude: 6_000_000 },
      { lng: -179.5, lat: -41, altitude: 300_000 },
      { lng: -3.7, lat: 40.4, altitude: 1_000_000 },
      { lng: 0, lat: 90, altitude: 15_000_000 },
    ];
    for (const v of views) {
      const want = rows.filter((r) => isFacing([r[IDX.lng] as number, r[IDX.lat] as number], v));
      expect(facingRows(rows, units, v).map((r) => r[IDX.id]), JSON.stringify(v)).toEqual(want.map((r) => r[IDX.id]));
    }
  });

  it('mercator (no far-side camera) keeps every row, as the same array', () => {
    expect(facingRows(rows, units, null)).toBe(rows);
  });

  it('keeps the previous array while the visible set is unchanged (deck re-uploads nothing)', () => {
    const a = facingRows(rows, units, OVER_HK);
    const b = facingRows(rows, units, { ...OVER_HK, lng: OVER_HK.lng + 0.5 }, a);
    expect(b).toBe(a);
    const c = facingRows(rows, units, { lng: -118.25, lat: 34.05, altitude: 2_000_000 }, a);
    expect(c).not.toBe(a);
    expect(providers(c)).toEqual(['caltrans', 'wsdot']); // 2 000 km up over LA: the horizon (≈ 39°) reaches Washington, not Spain or Hong Kong
  });

  it('a picked camera behind the limb never opens a card; a facing one does', () => {
    const hk = rows.find((r) => r[IDX.providerId] === 'hktd')!;
    const la = rows.find((r) => r[IDX.providerId] === 'caltrans')!;
    expect(cameraSelection(hk, OVER_HK)).toMatchObject({ kind: 'camera', layer: 'cctv', id: hk[IDX.id] });
    expect(cameraSelection(la, OVER_HK)).toBeNull();
    expect(cameraSelection(la, null)).toMatchObject({ kind: 'camera', id: la[IDX.id] }); // mercator
    expect(cameraSelection(null, null)).toBeNull();
    expect(cameraSelection({ id: 'x' }, null)).toBeNull();
  });
});
