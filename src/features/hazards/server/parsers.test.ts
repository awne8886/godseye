import { describe, expect, it } from 'vitest';
import { AirQuality, Earthquake, FiresResponse, GpsJamCell, SentinelScene, WeatherEvent } from '@/lib/schemas';
import { FX, fixtureBuffer, fixtureJson, fixtureText } from './__fixtures__';
import { normalizeUsgs, type UsgsCollection } from './usgs-parse';
import { normalizeEonet, windSeverity, type EonetResponse } from './eonet-parse';
import {
  FIRE_SAMPLING_RULE,
  MAX_FIRE_ROWS,
  compareFire,
  modisConfidence,
  overpassSeconds,
  parseFirmsCsv,
  sampleByFrp,
  viirsConfidence,
  type FireRow,
} from './firms-parse';
import {
  NWS_ALERTS_URL,
  GDACS_URL,
  coneLayerId,
  coneQueryUrl,
  decodeXml,
  geometryCentroid,
  normalizeGdacs,
  normalizeGvp,
  normalizeNhc,
  normalizeNws,
  nwsSeverity,
  nwsType,
  parseCone,
  parseZone,
  simplifyGeometry,
  zonesNeeded,
  type NwsCollection,
  type ZoneGeom,
} from './weather-parse';
import { aqUrl, gridPoints, normalizeOpenMeteo, quantiseBbox, AQ_CITIES } from './air-quality';
import { binLiveNacp, parseGpsJamDay, parseManifest } from './gpsjam';
import { browserUrl, mapStac, quicklookUrl, stacSearchUrl } from './sentinel';
import { normalizeRainViewer } from './radar';
import { firesBody } from './fires-response';
import { dedupeStorms } from './weather';

describe('USGS normalisation (fixture 2026-09-30)', () => {
  const items = normalizeUsgs(fixtureJson<UsgsCollection>(FX.usgs));
  it('maps every feature to a valid Earthquake', () => {
    expect(items.length).toBe(33);
    for (const q of items) expect(Earthquake.safeParse(q).success).toBe(true);
  });
  it('takes depth from coordinates[2], origin time as observedAt, tsunami as boolean', () => {
    const q = items.find((x) => x.id === 'us6000tyke')!;
    expect(q).toMatchObject({ magnitude: 4.4, magType: 'mb', depthKm: 10, lat: -0.7769, lng: 122.3906, tsunami: false, alert: null, significance: 298, source: 'usgs' });
    expect(q.observedAt).toBe(new Date(1790785772799).toISOString());
  });
  it('lower-cases alert levels, drops invalid ones and dedupes ids', () => {
    const fc: UsgsCollection = {
      features: [
        { id: 'a', properties: { mag: 5, time: 1, alert: 'YELLOW', tsunami: 1 }, geometry: { coordinates: [1, 2, 3] } },
        { id: 'a', properties: { mag: 5, time: 1 }, geometry: { coordinates: [1, 2, 3] } },
        { id: 'b', properties: { mag: 5, time: 1, alert: 'purple' }, geometry: { coordinates: [1, 2] } },
        { id: 'c', properties: { mag: null }, geometry: { coordinates: [1, 2] } },
      ],
    };
    const out = normalizeUsgs(fc);
    expect(out.map((q) => q.id)).toEqual(['a', 'b']);
    expect(out[0]).toMatchObject({ alert: 'yellow', tsunami: true, depthKm: 3 });
    expect(out[1]).toMatchObject({ alert: null, depthKm: null });
  });
});

describe('FIRMS CSV parsing and FRP sampling', () => {
  it('parses VIIRS words and MODIS 0–100 confidence', () => {
    expect(viirsConfidence('nominal')).toBe('nominal');
    expect(viirsConfidence('h')).toBe('high');
    expect(viirsConfidence('x')).toBeNull();
    expect(modisConfidence('29')).toBe('low');
    expect(modisConfidence('30')).toBe('nominal');
    expect(modisConfidence('80')).toBe('high');
    expect(modisConfidence('')).toBeNull();
    expect(modisConfidence('101')).toBeNull();
  });
  it('turns acq_date + HHMM into UTC epoch seconds', () => {
    expect(overpassSeconds('2026-09-29', '0003')).toBe(Date.parse('2026-09-29T00:03:00Z') / 1000);
    expect(overpassSeconds('2026-09-29', '54')).toBe(Date.parse('2026-09-29T00:54:00Z') / 1000);
    expect(overpassSeconds('bad', '0003')).toBeNull();
  });
  it('parses the recorded VIIRS and MODIS files', () => {
    const j1 = parseFirmsCsv(fixtureText(FX.j1), 'NOAA20');
    expect(j1.total).toBe(150);
    expect(j1.top[0]!.satellite).toBe('NOAA20');
    expect(j1.top.every((r) => ['low', 'nominal', 'high'].includes(r.confidence))).toBe(true);
    const first = j1.top.find((r) => r.lat === 9.46221 && r.lng === 29.58401)!;
    expect(first).toMatchObject({ frpMw: 2.34, brightnessK: 325.6, confidence: 'nominal', dayNight: 'N', seenAt: Date.parse('2026-09-29T00:03:00Z') / 1000 });
    const modis = parseFirmsCsv(fixtureText(FX.modis), 'MODIS');
    expect(modis.total).toBe(150);
    const m = modis.top.find((r) => r.lat === -28.86483)!;
    expect(m).toMatchObject({ confidence: 'low', brightnessK: 300.38, frpMw: 6.22 }); // MODIS confidence 20 → low
    expect(new Set([...j1.top, ...modis.top].map((r) => r.id)).size).toBe(300);
  });
  it('keeps the highest-FRP pixels, deterministically, never every k-th row', () => {
    const snpp = parseFirmsCsv(fixtureText(FX.snpp), 'SNPP', 10);
    const all = parseFirmsCsv(fixtureText(FX.snpp), 'SNPP');
    const byFrp = [...all.top].sort(compareFire).slice(0, 10);
    expect(snpp.top).toEqual(byFrp);
    expect(snpp.total).toBe(all.total);
    // A stride sample (every 15th row) is a different set: FRP ranking is what is served.
    const stride = all.top.filter((_, i) => i % 15 === 0).map((r) => r.id);
    expect(snpp.top.map((r) => r.id)).not.toEqual(stride);
    const maxFrp = Math.max(...all.top.map((r) => r.frpMw ?? -1));
    expect(snpp.top[0]!.frpMw).toBe(maxFrp);
    // Same input → same output.
    expect(parseFirmsCsv(fixtureText(FX.snpp), 'SNPP', 10).top).toEqual(snpp.top);
  });
  it('merges per-file tops into the global top-N', () => {
    const files = [FX.snpp, FX.j1, FX.j2].map((f, i) => parseFirmsCsv(fixtureText(f), (['SNPP', 'NOAA20', 'NOAA21'] as const)[i]!, 25));
    const full = [FX.snpp, FX.j1, FX.j2].flatMap((f, i) => parseFirmsCsv(fixtureText(f), (['SNPP', 'NOAA20', 'NOAA21'] as const)[i]!).top);
    expect(sampleByFrp(files.map((f) => f.top), 25)).toEqual([...full].sort(compareFire).slice(0, 25));
  });
  it('orders ties by newer overpass then id, and null FRP last', () => {
    const base: FireRow = { id: 'b', lat: 0, lng: 0, frpMw: 5, brightnessK: null, confidence: 'high', dayNight: 'D', satellite: 'SNPP', seenAt: 10 };
    const rows = [{ ...base, id: 'z', frpMw: null }, { ...base, id: 'c' }, { ...base, id: 'a' }, { ...base, id: 'n', seenAt: 20 }];
    expect(rows.sort(compareFire).map((r) => r.id)).toEqual(['n', 'a', 'c', 'z']);
  });
  it('keeps a 30k-row FIRE_FIELDS payload under 4 MB and valid', () => {
    const rows: FireRow[] = Array.from({ length: MAX_FIRE_ROWS }, (_, i) => ({
      id: `N20-202609291234-${(-89.12345 + i * 0.001).toFixed(5)}-${(-179.12345 + i * 0.01).toFixed(5)}`,
      lat: -89.12345 + i * 0.001,
      lng: -179.12345 + i * 0.01,
      frpMw: 1234.56,
      brightnessK: 367.89,
      confidence: 'nominal',
      dayNight: 'D',
      satellite: 'NOAA20',
      seenAt: 1790720580,
    }));
    const body = { ...firesBody({ rows, totalDetections: 245_000, perSatellite: { NOAA20: 245_000 }, wildfireEvents: [] }) };
    expect(JSON.stringify(body).length).toBeLessThan(4 * 1024 * 1024);
    expect(body.sampling).toBe(FIRE_SAMPLING_RULE);
    const meta = { feed: 'fires', kind: 'live', state: 'live', fetchedAt: null, observedAt: null, lastGoodAt: null, stale: false, ttlSeconds: 900, attribution: [] };
    expect(FiresResponse.safeParse({ ...body, meta, providers: {} }).success).toBe(true);
  });
});

describe('EONET', () => {
  const res = fixtureJson<EonetResponse>(FX.eonet);
  it('maps open events at their newest geometry and skips categories', () => {
    const all = normalizeEonet(res);
    for (const e of all) expect(WeatherEvent.safeParse(e).success).toBe(true);
    const noFires = normalizeEonet(res, { skip: ['wildfires'] });
    expect(noFires.some((e) => e.type === 'wildfire')).toBe(false);
    const fires = normalizeEonet(res, { only: ['wildfires'] });
    expect(fires.length).toBeGreaterThan(0);
    expect(fires.every((e) => e.type === 'wildfire' && e.provider === 'NASA EONET')).toBe(true);
    const storm = all.find((e) => e.type === 'severe_storm')!;
    const raw = res.events!.find((e) => `eonet-${e.id}` === storm.id)!;
    const newest = raw.geometry!.map((g) => g.date!).sort().at(-1)!;
    expect(storm.observedAt).toBe(new Date(newest).toISOString());
  });
  it('grades storm severity by wind', () => {
    expect(windSeverity(70)).toBe('high');
    expect(windSeverity(40)).toBe('medium');
    expect(windSeverity(25)).toBe('low');
    expect(windSeverity(null)).toBe('medium');
  });
});

describe('NWS alerts + zone geometry', () => {
  const fc = fixtureJson<NwsCollection>(FX.nws);
  it('never sends a limit parameter (§6.2: NWS rejects it)', () => {
    expect(NWS_ALERTS_URL).not.toMatch(/limit/);
    expect(NWS_ALERTS_URL).toContain('status=actual');
  });
  it('lists zones only for alerts without geometry', () => {
    const z = zonesNeeded(fc);
    expect(z).toContain('https://api.weather.gov/zones/county/ILC007');
    expect(z.every((u) => u.startsWith('https://api.weather.gov/zones/'))).toBe(true);
  });
  it('places polygon alerts on their polygon and zone alerts on cached zone centroids', () => {
    const zone = parseZone('https://api.weather.gov/zones/county/ILC007', fixtureJson(FX.zone))!;
    expect(zone.id).toBe('ILC007');
    expect(zone.name).toBe('Boone');
    const zones = new Map<string, ZoneGeom>([['https://api.weather.gov/zones/county/ILC007', zone]]);
    const { items, unplaced, zones: shapes } = normalizeNws(fc, zones);
    for (const e of items) expect(WeatherEvent.safeParse(e).success).toBe(true);
    const poly = items.filter((e) => e.positionBasis === 'geometry');
    expect(poly.length).toBe(2);
    const zoned = items.filter((e) => e.positionBasis === 'zone-centroid');
    expect(zoned.length).toBeGreaterThan(0);
    expect(zoned[0]!.lat).toBeCloseTo(zone.centroid[1], 4);
    expect(zoned[0]!.zones).toContain('ILC007');
    // The outline is sent once in the shared map; the alert references it by UGC.
    expect(zoned[0]!.geometry).toBeNull();
    expect(zoned[0]!.zoneRefs).toEqual(['ILC007']);
    expect(Object.keys(shapes)).toEqual(['ILC007']);
    expect(unplaced).toBe(fc.features!.length - items.length);
    // Offsets are converted to UTC.
    expect(zoned[0]!.observedAt).toMatch(/Z$/);
  });
  it('maps event names and severities', () => {
    expect(nwsType('Flood Warning')).toBe('flood');
    expect(nwsType('Tornado Warning')).toBe('severe_storm');
    expect(nwsType('Hurricane Watch')).toBe('tropical_cyclone');
    expect(nwsType('Winter Storm Warning')).toBe('winter_storm');
    expect(nwsType('Extreme Heat Watch')).toBe('heat');
    expect(nwsType('Red Flag Warning')).toBe('wildfire');
    expect(nwsType('Small Craft Advisory')).toBe('weather_alert');
    expect(nwsSeverity('Extreme')).toBe('high');
    expect(nwsSeverity('Moderate')).toBe('medium');
    expect(nwsSeverity('Unknown')).toBe('low');
  });
  it('simplifies outlines without collapsing rings', () => {
    const g: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[0, 0], [0.001, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
    const s = simplifyGeometry(g) as GeoJSON.Polygon;
    expect(s.coordinates[0]!.length).toBe(5);
    const tiny: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0]]] };
    expect((simplifyGeometry(tiny) as GeoJSON.Polygon).coordinates[0]!.length).toBe(4);
    expect(geometryCentroid({ type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] })).toEqual([1, 1]);
  });
});

describe('GDACS', () => {
  it('uses the SEARCH event list (MAP answers 400)', () => {
    expect(GDACS_URL).toContain('/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF');
  });
  it('normalises types, lower-case alert levels, url.report and zone-less dates', () => {
    const items = normalizeGdacs(fixtureJson(FX.gdacs));
    for (const e of items) expect(WeatherEvent.safeParse(e).success).toBe(true);
    // EQ is the USGS layer's; the other five types map.
    expect(items.some((e) => e.id.startsWith('gdacs-EQ'))).toBe(false);
    expect(new Set(items.map((e) => e.type))).toEqual(new Set(['tropical_cyclone', 'flood', 'volcano', 'drought', 'wildfire']));
    const dr = items.find((e) => e.id === 'gdacs-DR-1027465')!;
    expect(dr).toMatchObject({ alertLevel: 'orange', severity: 'medium', observedAt: '2026-09-30T13:48:57.000Z', provider: 'GDACS' });
    expect(dr.url).toBe('https://www.gdacs.org/report.aspx?eventid=1027465&episodeid=7&eventtype=DR');
  });
});

describe('NHC storms and cones', () => {
  it('computes cone layer ids per bin from the MapServer listing', () => {
    expect(coneLayerId('AT1')).toBe(8);
    expect(coneLayerId('AT3')).toBe(60);
    expect(coneLayerId('EP2')).toBe(164);
    expect(coneLayerId('CP5')).toBe(372);
    expect(coneLayerId('XX1')).toBeNull();
    expect(coneQueryUrl('AT3')).toBe('https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer/60/query?where=1%3D1&outFields=*&f=geojson');
  });
  it('parses the recorded cone and attaches it to the storm', () => {
    const cone = parseCone(fixtureJson(FX.cone))!;
    expect(cone.type).toBe('Polygon');
    const items = normalizeNhc(fixtureJson(FX.nhc), new Map([['AT3', cone]]));
    for (const e of items) expect(WeatherEvent.safeParse(e).success).toBe(true);
    const hanna = items.find((e) => e.id === 'nhc-al082026')!;
    expect(hanna).toMatchObject({ lat: 33.4, lng: -43.6, type: 'tropical_cyclone', provider: 'NHC', observedAt: '2026-09-30T15:00:00.000Z', area: 'AT3', severity: 'low' });
    expect(hanna.title).toBe('Post-Tropical Cyclone Hanna');
    expect(hanna.geometry).toEqual(cone);
  });
  it('treats no active storms as an empty list', () => {
    expect(normalizeNhc({ activeStorms: [] })).toEqual([]);
  });
  it('drops EONET storms NHC already reports', () => {
    const nhc = normalizeNhc(fixtureJson(FX.nhc));
    const eonet = normalizeEonet(fixtureJson(FX.eonet));
    const kept = dedupeStorms(eonet, nhc);
    expect(kept.some((e) => /hanna/i.test(e.title))).toBe(false);
    expect(dedupeStorms(eonet, [])).toEqual(eonet);
  });
});

describe('Smithsonian GVP weekly RSS (ISO-8859-1)', () => {
  it('decodes Latin-1 bytes and maps georss points', () => {
    const buf = fixtureBuffer(FX.gvp);
    expect(buf.includes(0xe9) || buf.includes(0xed) || buf.includes(0xf3)).toBe(true);
    const xml = decodeXml(buf);
    expect(xml).not.toContain('�');
    const items = normalizeGvp(xml);
    expect(items.length).toBeGreaterThan(10);
    for (const e of items) expect(WeatherEvent.safeParse(e).success).toBe(true);
    const k = items.find((e) => e.title.startsWith('Krakatau'))!;
    expect(k).toMatchObject({ id: 'gvp-vn_262000', lat: -6.1009, lng: 105.4233, severity: 'high', area: 'Indonesia', observedAt: '2026-09-17T05:20:04.000Z' });
    expect(k.detail).not.toMatch(/<p>/);
    const utf8 = normalizeGvp(buf.toString('utf8'));
    expect(utf8.some((e) => (e.detail ?? '').includes('�'))).toBe(true);
  });
});

describe('Open-Meteo air quality', () => {
  it('maps a single-point answer and zone-less GMT hours', () => {
    const items = normalizeOpenMeteo(fixtureJson(FX.aq), [['London', 51.5, -0.12]]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ pm25: 4.8, usAqi: 32, station: 'London', observedAt: '2026-09-30T18:00:00.000Z', provider: 'Open-Meteo' });
    expect(AirQuality.safeParse(items[0]).success).toBe(true);
  });
  it('builds multi-location URLs and grids', () => {
    expect(aqUrl([[51.5, -0.12], [48.85, 2.35]])).toContain('latitude=51.500,48.850&longitude=-0.120,2.350&current=pm2_5,us_aqi');
    expect(gridPoints([-10, 40, 10, 60])).toHaveLength(36);
    const am = gridPoints([170, -10, -170, 10]);
    expect(am.every(([, , lng]) => lng >= -180 && lng <= 180)).toBe(true);
    expect(quantiseBbox([-0.4, 51.2, 0.3, 51.7])).toEqual([-1, 51, 1, 52]);
    expect(AQ_CITIES.length).toBeLessThanOrEqual(60);
  });
});

describe('gpsjam', () => {
  it('reads the manifest suspect flag and sorts days', () => {
    const rows = parseManifest(fixtureText(FX.gpsManifest));
    expect(rows[0]).toEqual({ date: '2022-02-14', suspect: true });
    expect(rows.at(-1)).toEqual({ date: '2026-09-29', suspect: false });
  });
  it('keeps only cells with a gpsjam share > 0 (bad ≥ 2) and counts the whole grid', () => {
    const { items, totalCells } = parseGpsJamDay(fixtureText(FX.gpsDay), '2026-09-29');
    expect(totalCells).toBe(399);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((c) => c.bad >= 2 && c.aircraft >= c.bad && c.basis === 'gpsjam-daily' && c.date === '2026-09-29')).toBe(true);
    for (const c of items) expect(GpsJamCell.safeParse(c).success).toBe(true);
    // 4 cells in the recorded day have bad > 0; 3 of them have a single bad aircraft (share 0 by gpsjam's formula).
    expect(items.find((x) => x.h3 === '8400ec3ffffffff')).toBeUndefined();
    // 840135dffffffff: good 11, bad 2 → (2 − 1) / 13 = 0.076923 → 0.0769 (MEDIUM: > 2 %, ≤ 10 %).
    expect(items.find((x) => x.h3 === '840135dffffffff')).toMatchObject({ aircraft: 13, bad: 2, badRatio: 0.0769 });
    const capped = parseGpsJamDay(fixtureText(FX.gpsDay), '2026-09-29', 3);
    expect(capped.items.map((x) => x.bad)).toEqual([...items].slice(0, 3).map((x) => x.bad));
  });
  it('bins live NACp (≤ 4 bad, ≥ 3 aircraft per r4 cell) from columnar or object flights', () => {
    const rows = [
      [51.47, -0.45, 3],
      [51.471, -0.452, 9],
      [51.472, -0.451, 10],
      [10, 10, 2],
      [10.001, 10.001, 2],
    ];
    const cells = binLiveNacp({ fields: ['id', 'lat', 'lng', 'nacP'], rows: rows.map((r, i) => [`h${i}`, ...r]) });
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ aircraft: 3, bad: 1, basis: 'live-nacp', date: null });
    expect(GpsJamCell.safeParse(cells[0]).success).toBe(true);
    expect(binLiveNacp({ items: rows.map(([lat, lng, nacP]) => ({ lat, lng, nacP })) })).toHaveLength(1);
    expect(binLiveNacp(null)).toEqual([]);
  });
});

describe('CDSE STAC → SentinelScene', () => {
  it('maps items with the final quicklook URL (no redirect for next/image)', () => {
    const items = mapStac(fixtureJson(FX.stac), [-0.1, 51.5]);
    expect(items).toHaveLength(1);
    expect(SentinelScene.safeParse(items[0]).success).toBe(true);
    expect(items[0]).toMatchObject({ collection: 'sentinel-2-l2a', datetime: '2026-09-29T10:58:31.024Z', cloudCover: 47.35, platform: 'sentinel-2c', tile: 'MGRS-30UYC' });
    expect(items[0]!.thumbnailUrl).toBe('https://zipper.creodias.eu/odata/v1/Assets(7204166e-8277-4e79-843e-2f9b0d497ad7)/$value');
    expect(quicklookUrl('https://evil.example/x.jpg')).toBeNull();
    expect(quicklookUrl('http://datahub.creodias.eu/x')).toBeNull();
    expect(browserUrl(51.5, -0.1, '2026-09-29T10:58:31.024Z')).toContain('fromTime=2026-09-29T00%3A00%3A00.000Z');
  });
  it('builds a bounded search URL', () => {
    const u = new URL(stacSearchUrl(51.5, -0.1, 25, 10, Date.parse('2026-09-30T18:00:00Z')));
    expect(u.host).toBe('stac.dataspace.copernicus.eu');
    expect(u.searchParams.get('datetime')).toBe('2026-09-20T18:00:00Z/2026-09-30T18:00:00Z');
    expect(u.searchParams.get('sortby')).toBe('-properties.datetime');
    const [w, s, e, n] = u.searchParams.get('bbox')!.split(',').map(Number);
    expect(w).toBeLessThan(-0.1);
    expect(e).toBeGreaterThan(-0.1);
    expect(n! - s!).toBeCloseTo(0.45, 1);
  });
});

describe('RainViewer', () => {
  it('lists past frames as ISO times with tile paths', () => {
    const r = normalizeRainViewer(fixtureJson(FX.radar));
    expect(r.host).toBe('https://tilecache.rainviewer.com');
    expect(r.frames).toHaveLength(13);
    expect(r.frames[0]).toEqual({ time: new Date(1790784000 * 1000).toISOString(), path: '/v2/radar/b139afa071b9' });
    expect(normalizeRainViewer({ host: 'javascript:alert(1)', radar: { past: [{ time: 1, path: '../x' }] } })).toEqual({ host: 'https://tilecache.rainviewer.com', frames: [] });
  });
});
