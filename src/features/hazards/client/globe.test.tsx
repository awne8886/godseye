// @vitest-environment jsdom
/**
 * visual-qa round 5 MAJOR-1: the hazards ScatterplotLayers (quakes, fires, wildfire events, weather,
 * air quality) had no `depthCompare: 'always'`, so MapLibre's globe surface clipped them into
 * half-discs or hid them (globe z8 quake missing, mercator full discs), and the GPS-interference H3
 * cells z-fought the globe mesh into hatched hexes. Every hazards deck layer now draws with
 * GLOBE_POINT_PARAMETERS and only its camera-facing subset (the far-side filter is then the only
 * thing hiding points behind the limb, for drawing and for deck picking).
 *
 * Data: the recorded upstream fixtures (2026-09-30, docs/data-sources/layers-hazards.md) through
 * the real parsers; the map is a stand-in exposing MapLibre's camera transform and events.
 */
import { act, cleanup, render } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeckLayerStore, useMapInstanceStore } from '@/lib/layer-host';
import { centralAngle, destination } from '@/lib/geo';
import { EARTH_RADIUS_M, isFacing, type FarSideCamera } from '@/lib/map/far-side';
import type { AirQuality, Earthquake, GpsJamCell, WeatherEvent } from '@/lib/types';
import { FX, fixtureBuffer, fixtureJson, fixtureText } from '../server/__fixtures__';
import { normalizeOpenMeteo } from '../server/air-quality';
import { normalizeEonet, type EonetResponse } from '../server/eonet-parse';
import { parseFirmsCsv, sampleByFrp } from '../server/firms-parse';
import { parseGpsJamDay } from '../server/gpsjam';
import { normalizeUsgs, type UsgsCollection } from '../server/usgs-parse';
import { decodeXml, normalizeGdacs, normalizeGvp } from '../server/weather-parse';
import { FIRE_ROW_FIELDS } from '../shared';
import { GLOBE_POINT_PARAMETERS, facingIndices, pickIndices, unitVectors } from './globe';
import { pitchedCamera } from './camera';
import { hazardsCandidates } from './hit-test';

const bodies = vi.hoisted(() => new Map<string, unknown>());
vi.mock('./useHazardData', () => ({ useHazardData: (layer: string) => bodies.get(layer) }));

const { default: EarthquakeLayer } = await import('./EarthquakeLayer');
const { default: FireLayer } = await import('./FireLayer');
const { default: WeatherLayer } = await import('./WeatherLayer');
const { default: AirQualityLayer } = await import('./AirQualityLayer');
const { default: GpsJamLayer } = await import('./GpsJamLayer');

// ── Recorded data through the real parsers ────────────────────────────────────────────────────
const quakes: Earthquake[] = normalizeUsgs(fixtureJson<UsgsCollection>(FX.usgs));
const fireRows = sampleByFrp(
  ([[FX.snpp, 'SNPP'], [FX.j1, 'NOAA20'], [FX.j2, 'NOAA21'], [FX.modis, 'MODIS']] as const).map(([f, sat]) => parseFirmsCsv(fixtureText(f), sat).top),
).map((r) => FIRE_ROW_FIELDS.map((k) => r[k]));
const wildfires: WeatherEvent[] = normalizeEonet(fixtureJson<EonetResponse>(FX.eonet), { only: ['wildfires'] });
const weather: WeatherEvent[] = [
  ...normalizeEonet(fixtureJson<EonetResponse>(FX.eonet), { skip: ['wildfires'] }),
  ...normalizeGdacs(fixtureJson(FX.gdacs)),
  ...normalizeGvp(decodeXml(fixtureBuffer(FX.gvp))),
];
const air: AirQuality[] = normalizeOpenMeteo(fixtureJson(FX.aq), [['London', 51.5, -0.12]]);
/** The recorded day excerpt (399 cells) has one cell with gpsjam share > 0 (bad ≥ 2). */
const cells: GpsJamCell[] = parseGpsJamDay(fixtureText(FX.gpsDay), '2026-09-29').items;

/** Camera height whose horizon is 70° (a zoom-2 globe): points 70–90° away are behind the limb. */
const ALT_70 = EARTH_RADIUS_M * (1 / Math.cos((70 * Math.PI) / 180) - 1);

// ── A MapLibre stand-in: camera transform, events, style calls, orthographic projection ──────
type Handler = () => void;
function fakeMap(projection: 'globe' | 'mercator' = 'globe') {
  const cam: FarSideCamera = { lng: 0, lat: 0, altitude: ALT_70 };
  const handlers = new Map<string, Set<Handler>>();
  const layers = new Set<string>();
  const sources = new Set<string>();
  const D = Math.PI / 180;
  const K = 400;
  // Orthographic about the camera ground point: a far-side point lands on the same pixel as its
  // mirror on the near side, exactly where an unfiltered depthCompare:'always' marker would draw.
  const project = ([lng, lat]: [number, number]) => {
    const dl = (lng - cam.lng) * D;
    const x = Math.cos(lat * D) * Math.sin(dl);
    const y = Math.cos(cam.lat * D) * Math.sin(lat * D) - Math.sin(cam.lat * D) * Math.cos(lat * D) * Math.cos(dl);
    return { x: 500 + K * x, y: 500 - K * y };
  };
  const unproject = ([px, py]: [number, number]) => {
    const x = (px - 500) / K;
    const y = (500 - py) / K;
    const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    const lat = Math.asin(y * Math.cos(cam.lat * D) + z * Math.sin(cam.lat * D)) / D;
    const lng = cam.lng + Math.atan2(x, z * Math.cos(cam.lat * D) - y * Math.sin(cam.lat * D)) / D;
    return { lng, lat, wrap: () => ({ lng: ((((lng + 180) % 360) + 360) % 360) - 180, lat }) };
  };
  const map = {
    cam,
    transform: { getCameraLngLat: () => ({ lng: cam.lng, lat: cam.lat }), getCameraAltitude: () => cam.altitude },
    getCenter: () => ({ lng: cam.lng, lat: cam.lat, wrap: () => ({ lng: cam.lng, lat: cam.lat }) }),
    getZoom: () => 2,
    getBearing: () => 0,
    getProjection: () => ({ type: projection }),
    getCanvas: () => ({ clientHeight: 1000 }),
    project,
    unproject,
    on: (t: string, f: Handler) => void (handlers.get(t) ?? handlers.set(t, new Set()).get(t)!).add(f),
    off: (t: string, f: Handler) => void handlers.get(t)?.delete(f),
    fire: (t: string) => handlers.get(t)?.forEach((f) => f()),
    getStyle: () => ({ layers: [] }),
    getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
    getSource: (id: string) => (sources.has(id) ? { id, setData: () => undefined } : undefined),
    addSource: (id: string) => void sources.add(id),
    removeSource: (id: string) => void sources.delete(id),
    addLayer: (l: { id: string }) => void layers.add(l.id),
    removeLayer: (id: string) => void layers.delete(id),
    setPaintProperty: () => undefined,
    queryRenderedFeatures: () => [],
  };
  return map;
}
type FakeMap = ReturnType<typeof fakeMap>;

function mount(map: FakeMap, projection: 'globe' | 'mercator', C: ComponentType) {
  useMapInstanceStore.setState({ map: map as never, projection, ready: true });
  return render(<C />);
}

interface DeckLayerLike {
  id: string;
  props: { data: unknown; parameters?: unknown; billboard?: boolean };
}
const deckLayers = (key: string) => (useDeckLayerStore.getState().entries[key]?.layers ?? []) as unknown as DeckLayerLike[];

/** Positions a deck layer will draw (object data, or the fires' binary position column). */
function drawnPositions(l: DeckLayerLike): [number, number][] {
  const d = l.props.data as { attributes?: { getPosition: { value: Float32Array } }; length?: number } | { lng: number; lat: number }[];
  if (!Array.isArray(d)) {
    const v = d.attributes!.getPosition.value;
    return Array.from({ length: d.length! }, (_, i) => [v[i * 2]!, v[i * 2 + 1]!]);
  }
  return d.map((o) => [o.lng, o.lat]);
}

const f32 = ([lng, lat]: readonly [number, number]): [number, number] => [Math.fround(lng), Math.fround(lat)];
const key = (p: readonly [number, number]) => `${p[0]},${p[1]}`;
const sorted = (ps: readonly [number, number][]) => ps.map(key).sort();

interface Case {
  name: string;
  C: ComponentType;
  deckKey: string;
  deckIds: string[];
  scatter: boolean;
  /** Every entity the layer received, per deck layer id. */
  points: Record<string, [number, number][]>;
  binary?: string;
}

const CASES: Case[] = [
  { name: 'earthquakes', C: EarthquakeLayer, deckKey: 'hazards:earthquakes', deckIds: ['hazards-quakes', 'hazards-quake-arrivals'], scatter: true, points: { 'hazards-quakes': quakes.map((q) => [q.lng, q.lat]), 'hazards-quake-arrivals': [] } },
  {
    name: 'fires',
    C: FireLayer,
    deckKey: 'hazards:fires',
    deckIds: ['hazards-fires', 'hazards-wildfire-events'],
    scatter: true,
    binary: 'hazards-fires',
    points: { 'hazards-fires': fireRows.map((r) => [r[2] as number, r[1] as number]), 'hazards-wildfire-events': wildfires.map((e) => [e.lng, e.lat]) },
  },
  { name: 'weather', C: WeatherLayer, deckKey: 'hazards:weather', deckIds: ['hazards-weather-points'], scatter: true, points: { 'hazards-weather-points': weather.map((e) => [e.lng, e.lat]) } },
  { name: 'air_quality', C: AirQualityLayer, deckKey: 'hazards:air_quality', deckIds: ['hazards-air-quality'], scatter: true, points: { 'hazards-air-quality': air.map((a) => [a.lng, a.lat]) } },
  { name: 'gps_jam', C: GpsJamLayer, deckKey: 'hazards:gps_jam', deckIds: ['hazards-gps-jam'], scatter: false, points: { 'hazards-gps-jam': cells.map((c) => [c.lng, c.lat]) } },
];

beforeEach(() => {
  bodies.set('earthquakes', { items: quakes });
  bodies.set('fires', { rows: fireRows, wildfireEvents: wildfires });
  bodies.set('weather', { items: weather });
  bodies.set('air_quality', { items: air });
  bodies.set('gps_jam', { items: cells, suspect: null });
  useDeckLayerStore.setState({ entries: {}, version: 0 });
});
afterEach(() => {
  cleanup();
  useMapInstanceStore.setState({ map: null, projection: 'globe', ready: false });
});

describe('globe-safe GPU state', () => {
  it('turns off face culling and the depth test (same as the aviation billboards)', () => {
    expect(GLOBE_POINT_PARAMETERS).toEqual({ cullMode: 'none', depthCompare: 'always' });
  });

  for (const c of CASES) {
    it(`${c.name}: every deck layer draws with GLOBE_POINT_PARAMETERS${c.scatter ? ' as round billboards' : ''}, on the globe and in mercator`, () => {
      for (const proj of ['globe', 'mercator'] as const) {
        const map = fakeMap(proj);
        const { unmount } = mount(map, proj, c.C);
        const ls = deckLayers(c.deckKey);
        expect(ls.map((l) => l.id).sort()).toEqual([...c.deckIds].sort());
        for (const l of ls) {
          expect(l.props.parameters).toEqual(GLOBE_POINT_PARAMETERS);
          if (c.scatter) expect(l.props.billboard).toBe(true);
        }
        unmount();
      }
    });
  }
});

describe('far-side filter (depthCompare is off, so this is all that hides points behind the limb)', () => {
  for (const c of CASES) {
    it(`${c.name}: draws exactly the camera-facing entities and refilters when the camera moves`, () => {
      const map = fakeMap('globe');
      // Face the first entity, then its antipode: the recorded data lies on both sides of the limb.
      const first = Object.values(c.points).find((p) => p.length)![0]!;
      const [camLng, camLat] = first;
      Object.assign(map.cam, { lng: camLng, lat: camLat });
      mount(map, 'globe', c.C);
      const check = () => {
        let anyHidden = false;
        for (const id of c.deckIds) {
          const all = c.points[id]!;
          const want = all.filter((p) => isFacing(p, { ...map.cam }));
          anyHidden ||= want.length < all.length;
          const l = deckLayers(c.deckKey).find((x) => x.id === id)!;
          const got = drawnPositions(l);
          expect(sorted(got)).toEqual(sorted(id === c.binary ? want.map(f32) : want));
        }
        return anyHidden;
      };
      const firstDrawn = deckLayers(c.deckKey).flatMap(drawnPositions).length;
      expect(firstDrawn).toBeGreaterThan(0);
      const hidden = check();
      // Layers with more than one recorded entity have some behind the limb. The AQ fixture is one
      // point (London) and the gpsjam day excerpt has one cell above gpsjam's 0 % share (69.9°N
      // 29.9°E): both face this camera and go behind the limb after the move below.
      if (Object.values(c.points).some((p) => p.length > 1)) expect(hidden).toBe(true);
      // Hidden diagnostics (e2e): drawn and received counts of the main layer, and the camera used.
      const main = c.deckIds[0]!;
      const status = document.querySelector(`[data-testid="hazards-drawn-${c.name}"]`)!;
      expect(status.getAttribute('data-camera')).toBe(`${map.cam.lng.toFixed(3)},${map.cam.lat.toFixed(3)},${Math.round(ALT_70)}`);
      expect(Number(status.getAttribute('data-drawn'))).toBe(drawnPositions(deckLayers(c.deckKey).find((l) => l.id === main)!).length);
      expect(Number(status.getAttribute('data-total'))).toBe(c.points[main]!.length);

      act(() => {
        Object.assign(map.cam, { lng: camLng > 0 ? camLng - 180 : camLng + 180, lat: -camLat });
        map.fire('moveend');
      });
      expect(check()).toBe(true);
      // The entity the camera first looked at is now on the far side: not drawn.
      const mainLayer = deckLayers(c.deckKey).find((l) => l.id === main)!;
      expect(drawnPositions(mainLayer).map(key)).not.toContain(key(c.binary === main ? f32(first) : first));
    });
  }

  it('a tilted globe on a map without `transform` (MapLibre 6.11) filters with the pitched camera, not the map centre', () => {
    const map = fakeMap('globe');
    Object.assign(map.cam, { lng: -51.286, lat: -3.926 });
    const live = { ...map, transform: undefined, getZoom: () => 3, getPitch: () => 60, getBearing: () => 0, getCanvas: () => ({ clientHeight: 1000 }) };
    mount(live as unknown as FakeMap, 'globe', FireLayer);
    const cam = pitchedCamera({ lng: -51.286, lat: -3.926 }, 3, 60, 0, 1000);
    expect(cam.lat).toBeLessThan(-40);
    const all = CASES.find((c) => c.name === 'fires')!.points['hazards-fires']!;
    const want = all.filter((p) => isFacing(p, cam));
    const got = drawnPositions(deckLayers('hazards:fires').find((l) => l.id === 'hazards-fires')!);
    expect(sorted(got)).toEqual(sorted(want.map(f32)));
    // The unpitched centre camera would have drawn a different subset (the round-5 bug).
    const centre = { lng: -51.286, lat: -3.926, altitude: pitchedCamera({ lng: -51.286, lat: -3.926 }, 3, 0, 0, 1000).altitude };
    expect(sorted(all.filter((p) => isFacing(p, centre)).map(f32))).not.toEqual(sorted(got));
    const status = document.querySelector('[data-testid="hazards-drawn-fires"]')!;
    expect(status.getAttribute('data-camera')).toBe(`${cam.lng.toFixed(3)},${cam.lat.toFixed(3)},${Math.round(cam.altitude)}`);
  });

  it('mercator has no far side: every entity is drawn', () => {
    for (const c of CASES) {
      const { unmount } = mount(fakeMap('mercator'), 'mercator', c.C);
      for (const id of c.deckIds) {
        const l = deckLayers(c.deckKey).find((x) => x.id === id)!;
        expect(drawnPositions(l)).toHaveLength(c.points[id]!.length);
      }
      unmount();
    }
  });
});

describe('picking never reaches a far-side entity', () => {
  it('a quake behind the limb is not hit at the pixel where it would draw; facing, the same quake is', () => {
    const map = fakeMap('globe');
    const q = quakes[0]!;
    Object.assign(map.cam, { lng: q.lng, lat: q.lat });
    mount(map, 'globe', EarthquakeLayer);
    const idsAt = () => hazardsCandidates(map as never, map.project([q.lng, q.lat])).map((h) => h.selection.id);
    expect(idsAt()).toContain(q.id);
    // 80° east of the quake: past the camera's 70° horizon, yet inside the 90° the old map-centre
    // test allowed. The orthographic stand-in still maps the quake into the disc (where a
    // depthCompare:'always' marker would draw if it were not filtered).
    act(() => {
      const [lng, lat] = destination([q.lng, q.lat], 90, (80 * Math.PI * EARTH_RADIUS_M) / 180 / 1000);
      Object.assign(map.cam, { lng, lat });
      map.fire('moveend');
    });
    const d = (centralAngle([map.cam.lng, map.cam.lat], [q.lng, q.lat]) * 180) / Math.PI;
    expect(d).toBeGreaterThan(75);
    expect(d).toBeLessThan(85);
    const at = map.project([q.lng, q.lat]);
    expect(Math.hypot(at.x - 500, at.y - 500)).toBeLessThan(400);
    expect(idsAt()).not.toContain(q.id);
    expect(deckLayers('hazards:earthquakes')[0]!.props.data as Earthquake[]).not.toContain(q);
  });

  it('a GPS-interference cell is hit only on the camera-facing side', () => {
    const map = fakeMap('globe');
    const c0 = cells[0]!;
    Object.assign(map.cam, { lng: c0.lng, lat: c0.lat });
    mount(map, 'globe', GpsJamLayer);
    const hit = (m: FakeMap) => hazardsCandidates(m as never, m.project([c0.lng, c0.lat])).filter((h) => h.layer === 'gps_jam');
    expect(hit(map).map((h) => h.selection.id)).toEqual([c0.h3]);
    // A stand-in whose unproject (wrongly) answers the cell's centre from the far side: still no hit.
    act(() => {
      Object.assign(map.cam, { lng: c0.lng > 0 ? c0.lng - 180 : c0.lng + 180, lat: -c0.lat });
      map.fire('moveend');
    });
    const lying = { ...map, unproject: () => ({ lng: c0.lng, lat: c0.lat, wrap: () => ({ lng: c0.lng, lat: c0.lat }) }) };
    expect(hit(lying as FakeMap)).toEqual([]);
  });
});

describe('facingIndices (pure)', () => {
  it('agrees with isFacing() (src/lib/map/far-side.ts) for surface points at several cameras', () => {
    const pts: [number, number][] = [];
    for (let lat = -87.5; lat <= 87.5; lat += 7.3) for (let lng = -179; lng < 180; lng += 9.7) pts.push([lng, lat]);
    const units = unitVectors(pts.length, (i) => pts[i]![0], (i) => pts[i]![1]);
    const cams: FarSideCamera[] = [
      { lng: 0, lat: 0, altitude: ALT_70 },
      { lng: -98, lat: 39, altitude: 3_000_000 },
      { lng: 151.2, lat: -33.9, altitude: 40_000_000 },
      { lng: 179.9, lat: 70, altitude: 250_000 },
    ];
    for (const cam of cams) {
      const want = pts.map((p, i) => (isFacing(p, cam) ? i : -1)).filter((i) => i >= 0);
      expect(Array.from(facingIndices(units, cam)!)).toEqual(want);
      expect(want.length).toBeGreaterThan(0);
      expect(want.length).toBeLessThan(pts.length);
    }
  });

  it('mercator (no camera) keeps every item, identity included', () => {
    const items = [{ lng: 1, lat: 2 }];
    expect(facingIndices(unitVectors(1, () => 1, () => 2), null)).toBeNull();
    expect(pickIndices(items, null)).toBe(items);
  });

  it('a non-finite position never faces the camera', () => {
    const units = unitVectors(2, (i) => [Number.NaN, 0][i]!, () => 0);
    expect(Array.from(facingIndices(units, { lng: 0, lat: 0, altitude: ALT_70 })!)).toEqual([1]);
  });
});
