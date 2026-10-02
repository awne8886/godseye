// @vitest-environment jsdom
/**
 * Verification round 7 (MINOR): on a live → 503 transition useHazardData returns null. The deck
 * points cleared, but WeatherLayer / EarthquakeLayer passed `null` to useGeoJsonLayers, which keeps
 * the previous data on null, so the last-good NWS/NHC footprints and M4.5+ rings stayed drawn (and
 * unclickable: the hit tester had no items) while the rail said SOURCE OFFLINE. Every hazards layer
 * now clears consistently: no deck layers AND every native GeoJSON source holds 0 features. The
 * rail keeps the last-good time (useHazardData), so nothing unattributable stays on the map.
 *
 * Data: the recorded upstream fixtures through the real parsers (as style-version.test.tsx).
 */
import { act, cleanup, render } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeckLayerStore, useMapInstanceStore } from '@/lib/layer-host';
import type { Earthquake, WeatherEvent } from '@/lib/types';
import { FX, fixtureJson, fixtureText } from '../server/__fixtures__';
import { normalizeOpenMeteo } from '../server/air-quality';
import { normalizeEonet, type EonetResponse } from '../server/eonet-parse';
import { parseFirmsCsv, sampleByFrp } from '../server/firms-parse';
import { parseGpsJamDay } from '../server/gpsjam';
import { mapStac } from '../server/sentinel';
import { normalizeUsgs, type UsgsCollection } from '../server/usgs-parse';
import { normalizeNhc, normalizeNws, parseCone, parseZone, type NwsCollection, type ZoneGeom } from '../server/weather-parse';
import { FIRE_ROW_FIELDS } from '../shared';

const bodies = vi.hoisted(() => new Map<string, unknown>());
vi.mock('./useHazardData', () => ({ useHazardData: (layer: string) => bodies.get(layer) ?? null }));

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
const zoneUrl = 'https://api.weather.gov/zones/county/ILC007';
const zones = new Map<string, ZoneGeom>([[zoneUrl, parseZone(zoneUrl, fixtureJson(FX.zone))!]]);
// Recorded NWS alerts (polygon + zone areas) and the recorded NHC storm with its recorded cone.
const weather: WeatherEvent[] = [
  ...normalizeNws(fixtureJson<NwsCollection>(FX.nws), zones).items,
  ...normalizeNhc(fixtureJson(FX.nhc), new Map([['AT3', parseCone(fixtureJson(FX.cone))!]])),
];
const scenes = mapStac(fixtureJson(FX.stac), [-0.1, 51.5]);

function fakeMap() {
  const layers = new Set<string>();
  const sources = new Map<string, GeoJSON.FeatureCollection | null>();
  return {
    sources,
    getZoom: () => 8,
    getBounds: () => ({ getWest: () => 9, getEast: () => 11, getSouth: () => 49, getNorth: () => 51 }),
    getCenter: () => ({ lng: -0.1, lat: 51.5, wrap: () => ({ lng: -0.1, lat: 51.5 }) }),
    getProjection: () => ({ type: 'mercator' }),
    on: () => undefined,
    off: () => undefined,
    getStyle: () => ({ layers: [] }),
    getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
    getSource: (id: string) => (sources.has(id) ? { id, setData: (d: GeoJSON.FeatureCollection) => void sources.set(id, d) } : undefined),
    addSource: (id: string, spec: { data?: GeoJSON.FeatureCollection }) => void sources.set(id, spec?.data ?? null),
    removeSource: (id: string) => void sources.delete(id),
    addLayer: (l: { id: string }) => void layers.add(l.id),
    removeLayer: (id: string) => void layers.delete(id),
    setPaintProperty: () => undefined,
    queryRenderedFeatures: () => [],
  };
}

const deckKeys = () => Object.keys(useDeckLayerStore.getState().entries);
const features = (map: ReturnType<typeof fakeMap>, id: string) => map.sources.get(id)?.features.length ?? 0;

/** Mounts with a live body, records what is drawn, then flips to a 503 (useHazardData → null). */
function liveThenOffline(C: ComponentType, layer: string, live: unknown, sourceId?: string) {
  const map = fakeMap();
  useMapInstanceStore.setState({ map: map as never, projection: 'mercator', ready: true });
  bodies.set(layer, live);
  const view = render(<C />);
  const before = { deck: deckKeys(), features: sourceId ? features(map, sourceId) : 0 };
  bodies.set(layer, null);
  act(() => view.rerender(<C />));
  return { before, after: { deck: deckKeys(), features: sourceId ? features(map, sourceId) : 0, hasSource: sourceId ? map.sources.has(sourceId) : false } };
}

beforeEach(() => {
  bodies.clear();
  useDeckLayerStore.setState({ entries: {}, version: 0 });
});
afterEach(() => {
  cleanup();
  useMapInstanceStore.setState({ map: null, projection: 'globe', ready: false });
});

describe('hazards layers clear consistently on a live → 503 transition (round 7)', () => {
  it('earthquakes: points AND magnitude rings clear', () => {
    const { before, after } = liveThenOffline(EarthquakeLayer, 'earthquakes', { items: quakes }, 'hazards-quake-rings');
    expect(before.deck).toContain('hazards:earthquakes');
    expect(before.features).toBe(quakes.filter((q) => q.magnitude >= 4.5).length);
    expect(before.features).toBeGreaterThan(0);
    expect(after.deck).not.toContain('hazards:earthquakes');
    expect(after.hasSource).toBe(true);
    expect(after.features).toBe(0);
  });

  it('weather: markers AND NWS / NHC footprints clear', () => {
    const { before, after } = liveThenOffline(WeatherLayer, 'weather', { items: weather }, 'hazards-weather-areas');
    expect(before.deck).toContain('hazards:weather');
    expect(before.features).toBe(weather.filter((e) => e.geometry).length);
    expect(before.features).toBeGreaterThan(0);
    expect(after.deck).not.toContain('hazards:weather');
    expect(after.hasSource).toBe(true);
    expect(after.features).toBe(0);
  });

  it('sentinel: scene footprints clear', () => {
    const { before, after } = liveThenOffline(SentinelLayer, 'sentinel', { items: scenes }, 'hazards-sentinel');
    expect(before.features).toBe(scenes.length);
    expect(before.features).toBeGreaterThan(0);
    expect(after.features).toBe(0);
  });

  it('fires: FIRMS points and wildfire rings clear', () => {
    const { before, after } = liveThenOffline(FireLayer, 'fires', { rows: fireRows, wildfireEvents: wildfires });
    expect(before.deck).toContain('hazards:fires');
    expect(after.deck).not.toContain('hazards:fires');
  });

  it('air quality: stations clear', () => {
    const { before, after } = liveThenOffline(AirQualityLayer, 'air_quality', { items: normalizeOpenMeteo(fixtureJson(FX.aq), [['London', 51.5, -0.12]]) });
    expect(before.deck).toContain('hazards:air_quality');
    expect(after.deck).not.toContain('hazards:air_quality');
  });

  it('gps interference: cells clear', () => {
    const { before, after } = liveThenOffline(GpsJamLayer, 'gps_jam', { items: parseGpsJamDay(fixtureText(FX.gpsDay), '2026-09-29').items, suspect: null });
    expect(before.deck).toContain('hazards:gps_jam');
    expect(after.deck).not.toContain('hazards:gps_jam');
  });
});
