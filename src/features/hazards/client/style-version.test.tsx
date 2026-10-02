// @vitest-environment jsdom
/**
 * Verification round 6 (MAJOR): Style Studio and Ghost Protocol rewrite `--map-*` tokens without
 * touching the preset theme and announce it with `godseye:style`. The hazards layers memoised their
 * colours on data only (native NWS/NHC and Sentinel paints on `[]`), so they kept the old colours
 * until the next poll, or for ever. Every layer now depends on useStyleVersion(): deck layers carry
 * it in updateTriggers (deck re-runs the colour accessors on the same data), baked colour columns
 * and ring features are rebuilt, and native paints are re-applied in place.
 *
 * Data: the recorded upstream fixtures through the real parsers (as globe.test.tsx), mercator.
 */
import { act, cleanup, render } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeckLayerStore, useMapInstanceStore } from '@/lib/layer-host';
import { MAP_STYLE_EVENT } from '@/lib/map/style-version';
import type { MapToken } from '@/lib/tokens';
import type { AirQuality, Earthquake, GpsJamCell, WeatherEvent } from '@/lib/types';
import { FX, fixtureBuffer, fixtureJson, fixtureText } from '../server/__fixtures__';
import { normalizeOpenMeteo } from '../server/air-quality';
import { normalizeEonet, type EonetResponse } from '../server/eonet-parse';
import { parseFirmsCsv, sampleByFrp } from '../server/firms-parse';
import { parseGpsJamDay } from '../server/gpsjam';
import { normalizeUsgs, type UsgsCollection } from '../server/usgs-parse';
import { decodeXml, normalizeGdacs, normalizeGvp } from '../server/weather-parse';
import { FIRE_ROW_FIELDS, aqiCategory, jamLevel, quakeToken, weatherToken } from '../shared';

const bodies = vi.hoisted(() => new Map<string, unknown>());
vi.mock('./useHazardData', () => ({ useHazardData: (layer: string) => bodies.get(layer) }));

const { default: EarthquakeLayer } = await import('./EarthquakeLayer');
const { default: FireLayer } = await import('./FireLayer');
const { default: WeatherLayer } = await import('./WeatherLayer');
const { default: AirQualityLayer } = await import('./AirQualityLayer');
const { default: GpsJamLayer } = await import('./GpsJamLayer');
const { default: SentinelLayer } = await import('./SentinelLayer');

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
const cells: GpsJamCell[] = parseGpsJamDay(fixtureText(FX.gpsDay), '2026-09-29').items;

/** A distinctive Style Studio colour no preset uses. */
const NEW = '#123456';
const NEW_RGB = [0x12, 0x34, 0x56];

function fakeMap() {
  const layers = new Set<string>();
  const sources = new Set<string>();
  const paints: [string, string, unknown][] = [];
  const setData: [string, GeoJSON.FeatureCollection][] = [];
  const map = {
    paints,
    setData,
    getZoom: () => 8,
    getBounds: () => ({ getWest: () => 9, getEast: () => 11, getSouth: () => 49, getNorth: () => 51 }),
    getCenter: () => ({ lng: 10, lat: 50, wrap: () => ({ lng: 10, lat: 50 }) }),
    getProjection: () => ({ type: 'mercator' }),
    on: () => undefined,
    off: () => undefined,
    getStyle: () => ({ layers: [] }),
    getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
    getSource: (id: string) => (sources.has(id) ? { id, setData: (d: GeoJSON.FeatureCollection) => void setData.push([id, d]) } : undefined),
    addSource: (id: string) => void sources.add(id),
    removeSource: (id: string) => void sources.delete(id),
    addLayer: (l: { id: string }) => void layers.add(l.id),
    removeLayer: (id: string) => void layers.delete(id),
    setPaintProperty: (id: string, k: string, v: unknown) => void paints.push([id, k, v]),
    queryRenderedFeatures: () => [],
  };
  return map;
}

type Accessor<T> = (o: T) => number[];
interface DeckLayerLike {
  id: string;
  props: { data: unknown; getFillColor?: unknown; getLineColor?: unknown; updateTriggers?: Record<string, unknown> };
}
const deckLayer = (key: string, id: string) => (useDeckLayerStore.getState().entries[key]?.layers as unknown as DeckLayerLike[]).find((l) => l.id === id)!;

function mount(C: ComponentType) {
  const map = fakeMap();
  useMapInstanceStore.setState({ map: map as never, projection: 'mercator', ready: true });
  render(<C />);
  return map;
}

const restyle = (token: MapToken) =>
  act(() => {
    document.documentElement.style.setProperty(token, NEW);
    window.dispatchEvent(new CustomEvent(MAP_STYLE_EVENT));
  });

beforeEach(() => {
  bodies.set('earthquakes', { items: quakes });
  bodies.set('fires', { rows: fireRows, wildfireEvents: wildfires });
  bodies.set('weather', { items: weather });
  bodies.set('air_quality', { items: air });
  bodies.set('gps_jam', { items: cells, suspect: null });
  bodies.set('sentinel', { items: [] });
  useDeckLayerStore.setState({ entries: {}, version: 0 });
});
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('style');
  useMapInstanceStore.setState({ map: null, projection: 'globe', ready: false });
});

/** Same data, a new trigger, and an accessor that now returns the restyled colour. */
function expectRecoloured<T>(before: DeckLayerLike, after: DeckLayerLike, sample: T, accessors: ('getFillColor' | 'getLineColor')[]) {
  expect(after.props.data).toBe(before.props.data);
  for (const a of accessors) {
    expect(after.props.updateTriggers?.[a]).not.toEqual(before.props.updateTriggers?.[a]);
    expect((after.props[a] as Accessor<T>)(sample).slice(0, 3)).toEqual(NEW_RGB);
  }
}

describe('hazards colours follow Style Studio / Ghost Protocol (style version)', () => {
  it('earthquakes: re-runs the point colour accessors and rebuilds the ring colours', () => {
    const map = mount(EarthquakeLayer);
    const before = deckLayer('hazards:earthquakes', 'hazards-quakes');
    const q = (before.props.data as Earthquake[]).find((x) => x.magnitude >= 4.5)!;
    map.setData.length = 0;
    restyle(quakeToken(q.magnitude));
    expectRecoloured(before, deckLayer('hazards:earthquakes', 'hazards-quakes'), q, ['getFillColor', 'getLineColor']);
    const rings = map.setData.find(([id]) => id === 'hazards-quake-rings')?.[1];
    expect(rings?.features.find((f) => f.properties?.id === q.id)?.properties?.color).toBe('rgba(18,52,86,0.549)');
  });

  it('weather: re-runs the point colour accessors', () => {
    mount(WeatherLayer);
    const before = deckLayer('hazards:weather', 'hazards-weather-points');
    const e = (before.props.data as WeatherEvent[])[0]!;
    restyle(weatherToken(e));
    expectRecoloured(before, deckLayer('hazards:weather', 'hazards-weather-points'), e, ['getFillColor', 'getLineColor']);
  });

  it('weather: repaints the NWS / NHC footprints in place', () => {
    const map = mount(WeatherLayer);
    map.paints.length = 0;
    restyle('--map-weather');
    for (const [id, k] of [
      ['hazards-weather-fill', 'fill-color'],
      ['hazards-weather-line', 'line-color'],
    ] as const) {
      expect(JSON.stringify(map.paints.find(([i, key]) => i === id && key === k)?.[2])).toContain('rgba(18,52,86,1.000)');
    }
  });

  it('air quality: re-runs the colour accessors', () => {
    mount(AirQualityLayer);
    const before = deckLayer('hazards:air_quality', 'hazards-air-quality');
    const a = (before.props.data as AirQuality[])[0]!;
    act(() => document.documentElement.style.setProperty('--map-air-quality', NEW));
    restyle(aqiCategory(a.usAqi).token);
    const after = deckLayer('hazards:air_quality', 'hazards-air-quality');
    expect(after.props.updateTriggers?.getLineColor).not.toEqual(before.props.updateTriggers?.getLineColor);
    expect((after.props.getLineColor as number[]).slice(0, 3)).toEqual(NEW_RGB);
    expect(after.props.data).toBe(before.props.data);
    expect((after.props.getFillColor as Accessor<AirQuality>)(a).slice(0, 3)).toEqual(NEW_RGB);
    expect(after.props.updateTriggers?.getFillColor).not.toEqual(before.props.updateTriggers?.getFillColor);
  });

  it('gps interference: re-runs the cell colour accessors', () => {
    mount(GpsJamLayer);
    const before = deckLayer('hazards:gps_jam', 'hazards-gps-jam');
    const c = (before.props.data as GpsJamCell[])[0]!;
    restyle(jamLevel(c).token);
    expectRecoloured(before, deckLayer('hazards:gps_jam', 'hazards-gps-jam'), c, ['getFillColor', 'getLineColor']);
  });

  it('fires: rebuilds the baked FIRMS colour column and recolours the wildfire rings', () => {
    mount(FireLayer);
    const col = () => (deckLayer('hazards:fires', 'hazards-fires').props.data as { attributes: { getFillColor: { value: Uint8Array } } }).attributes.getFillColor.value;
    const before = col();
    const ringsBefore = deckLayer('hazards:fires', 'hazards-wildfire-events');
    expect(Array.from(before.subarray(0, 3))).not.toEqual(NEW_RGB);
    restyle('--map-fire');
    const after = col();
    expect(after).not.toBe(before);
    expect(Array.from(after.subarray(0, 3))).toEqual(NEW_RGB);
    expect(after[3]).toBe(before[3]); // confidence alpha unchanged
    restyle('--map-volcano');
    const ringsAfter = deckLayer('hazards:fires', 'hazards-wildfire-events');
    expect(ringsAfter.props.updateTriggers?.getLineColor).not.toEqual(ringsBefore.props.updateTriggers?.getLineColor);
    expect((ringsAfter.props.getLineColor as number[]).slice(0, 3)).toEqual(NEW_RGB);
  });

  it('sentinel: repaints the scene outlines in place', () => {
    const map = mount(SentinelLayer);
    map.paints.length = 0;
    restyle('--map-directions');
    expect(map.paints).toContainEqual(['hazards-sentinel-line', 'line-color', 'rgb(18,52,86)']);
    expect(map.paints).toContainEqual(['hazards-sentinel-fill', 'fill-color', 'rgb(18,52,86)']);
  });
});
