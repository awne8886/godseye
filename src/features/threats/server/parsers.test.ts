import { describe, expect, it } from 'vitest';
import { ConflictEvent, CountryRisk, GdacsIncident, GdeltEvent, NuclearSite } from '@/lib/schemas';
import { fixture, FX } from './__fixtures__';
import { buildConflicts, loadZones, type toConflictEvent, zoneFor } from './conflicts';
import { joinRisk, latestWorkflow, RISK_METHOD } from './country-risk';
import { normalizeDeepState } from './frontlines';
import { normalizeGdacsIncidents } from './gdacs';
import { aggregate, batchObservedAt, batchUrl, gdeltTsToIso, parseExport, parseLastUpdate, previousBatch, toHttps } from './gdelt';
import { CONFLICT_METHOD, curatedStatus, flagSites, mergeNuclear, parseWikidata, SEISMIC_METHOD, wikidataStatus } from './nuclear';
import { unzipFirst } from './zip';

const json = <T>(name: string) => JSON.parse(fixture(name).toString('utf8')) as T;

describe('GDELT export (fixtures 2026-09-30)', () => {
  it('reads lastupdate.txt and upgrades the http:// URL to https', () => {
    const lu = parseLastUpdate(fixture(FX.gdeltLast).toString());
    expect(lu).toEqual({ ts: '20260930200000', url: 'https://data.gdeltproject.org/gdeltv2/20260930200000.export.CSV.zip' });
    expect(toHttps('http://data.gdeltproject.org/x')).toBe('https://data.gdeltproject.org/x');
    expect(batchUrl('20260930200000')).toMatch(/^https:\/\//);
  });

  it('steps back 15-minute windows across day boundaries', () => {
    expect(previousBatch('20260930200000', 1)).toBe('20260930194500');
    expect(previousBatch('20261001000000', 1)).toBe('20260930234500');
    expect(gdeltTsToIso('20260930200000')).toBe('2026-09-30T20:00:00.000Z');
  });

  it('unzips and parses the export at each row’s own ActionGeo coordinates', () => {
    const { data, name } = unzipFirst(fixture(FX.gdeltZip));
    expect(name).toBe('20260930200000.export.CSV');
    const tsv = data.toString('utf8');
    const { events, scanned } = parseExport(tsv);
    expect(scanned).toBe(1233);
    // Rows with ActionGeo_Type 0 (28 in this batch) are dropped, never placed at 0,0.
    expect(events.length).toBeGreaterThan(1100);
    expect(events.length).toBeLessThan(scanned);
    const first = tsv.split('\n')[0]!.split('\t');
    const e = events.find((x) => x.globalEventId === first[0])!;
    expect(e.lat).toBe(Number(first[56]));
    expect(e.lng).toBe(Number(first[57]));
    expect(e.dateAdded).toBe('2026-09-30T20:00:00.000Z');
    expect(e.quadClass).toBe(Number(first[29]));
    expect(e.rootCode).toBe(first[28]);
    expect(e.sourceUrl).toMatch(/^https?:\/\//);
    for (const ev of events.slice(0, 200)) expect(GdeltEvent.safeParse(ev).success).toBe(true);
  });

  it('aggregates windows newest first, de-duplicated and bounded', () => {
    const { events } = parseExport(unzipFirst(fixture(FX.gdeltZip)).data.toString('utf8'));
    const older = events.slice(0, 50).map((e) => ({ ...e, dateAdded: '2026-09-30T19:45:00.000Z' }));
    const agg = aggregate([
      { ts: '20260930200000', batch: { events, scanned: 1233, observedAt: Date.parse('2026-09-30T19:49:20Z') } },
      { ts: '20260930194500', batch: { events: older, scanned: 50, observedAt: Date.parse('2026-09-30T19:34:10Z') } },
    ]);
    // The window ends at the newest batch's observed publish time, never at a future label.
    expect(agg.window).toEqual({ from: '2026-09-30T19:19:10.000Z', to: '2026-09-30T19:49:20.000Z', batches: 2, latestLabel: '2026-09-30T20:00:00.000Z' });
    expect(agg.scanned).toBe(1283);
    expect(agg.items.length).toBe(events.length); // the 50 older copies share event ids
    expect(agg.items.length).toBeLessThanOrEqual(5000);
  });
});

describe('GDELT batch times (R3 round-4 MINOR-4: no future stamps)', () => {
  // Live probe 2026-10-01: lastupdate.txt (Last-Modified 05:35:25) named batch 20261001054500,
  // whose zip had Last-Modified 05:34:20 and every row DATEADDED 20261001054500.
  it('uses the observed publish time, never after the fetch', () => {
    const fetchedAt = Date.parse('2026-10-01T05:35:58Z');
    expect(new Date(batchObservedAt('20261001054500', 'Thu, 01 Oct 2026 05:34:20 GMT', fetchedAt)).toISOString()).toBe('2026-10-01T05:34:20.000Z');
    // No Last-Modified: the fetch time bounds it.
    expect(batchObservedAt('20261001054500', null, fetchedAt)).toBe(fetchedAt);
    // A bogus Last-Modified after the fetch is clamped to the fetch.
    expect(batchObservedAt('20261001054500', 'Thu, 01 Oct 2026 06:00:00 GMT', fetchedAt)).toBe(fetchedAt);
    // A batch published after its label keeps GDELT's (past) label.
    expect(new Date(batchObservedAt('20261001050000', 'Thu, 01 Oct 2026 05:04:00 GMT', fetchedAt)).toISOString()).toBe('2026-10-01T05:00:00.000Z');
  });

  it('caps every row’s DATEADDED at the batch’s observed time', () => {
    const tsv = unzipFirst(fixture(FX.gdeltZip)).data.toString('utf8');
    const cap = Date.parse('2026-09-30T19:49:20Z');
    const { events } = parseExport(tsv, cap);
    expect(events.length).toBeGreaterThan(1100);
    for (const e of events) expect(Date.parse(e.dateAdded)).toBeLessThanOrEqual(cap);
    expect(events[0]!.dateAdded).toBe('2026-09-30T19:49:20.000Z');
    for (const e of events.slice(0, 50)) expect(GdeltEvent.safeParse(e).success).toBe(true);
  });
});

describe('GDACS incidents', () => {
  it('lower-cases alert levels, keeps url.report and normalises zone-less UTC dates', () => {
    const items = normalizeGdacsIncidents(json(FX.gdacs));
    expect(items.length).toBe(25);
    for (const i of items) expect(GdacsIncident.safeParse(i).success).toBe(true);
    const dr = items.find((i) => i.id === 'gdacs-DR-1027465')!;
    expect(dr.alertLevel).toBe('orange');
    expect(dr.url).toBe('https://www.gdacs.org/report.aspx?eventid=1027465&episodeid=7&eventtype=DR');
    expect(dr.fromDate).toBe('2026-05-21T00:00:00.000Z');
    expect(dr.observedAt).toBe('2026-09-30T13:48:57.000Z');
    expect(new Set(items.map((i) => i.eventType)).has('EQ')).toBe(true);
  });
});

describe('conflict zones', () => {
  const zones = loadZones();
  it('bundles 15 REFERENCE polygons with references and label anchors', () => {
    expect(zones).toHaveLength(15);
    for (const z of zones) {
      expect(z.kind).toBe('reference');
      expect(z.references.length).toBeGreaterThan(0);
      expect(['Polygon', 'MultiPolygon']).toContain(z.polygon.type);
      expect(zoneFor(zones, z.anchor[0], z.anchor[1])).toBe(z.id);
    }
  });

  it('places events at their own coordinates (no jitter) and counts only in-zone, sub-country geocodes', () => {
    const base = parseExport(unzipFirst(fixture(FX.gdeltZip)).data.toString('utf8')).events[0]!;
    const now = Date.parse('2026-09-30T20:10:00Z');
    const mk = (id: string, lng: number, lat: number, quadClass: 1 | 2 | 3 | 4, geoPrecision: number) => ({ ...base, id, globalEventId: id, lng, lat, quadClass, geoPrecision, dateAdded: '2026-09-30T20:00:00.000Z' });
    const incoming = [
      mk('kyiv', 30.5234, 50.4501, 4, 4), // Ukraine, city
      mk('kharkiv', 36.2304, 49.9935, 3, 4),
      mk('ua-centroid', 32, 49, 4, 1), // country centroid → excluded
      mk('coop', 30.52, 50.45, 1, 4), // cooperation → excluded
      mk('paris', 2.35, 48.85, 4, 4), // outside every zone
      mk('khartoum', 32.53, 15.5, 4, 4),
    ];
    const buffer = new Map<string, ReturnType<typeof toConflictEvent>>();
    const out = buildConflicts(zones, buffer, incoming, now);
    expect(out.events.map((e) => e.id).sort()).toEqual(['kharkiv', 'khartoum', 'kyiv']);
    const kyiv = out.events.find((e) => e.id === 'kyiv')!;
    expect([kyiv.lng, kyiv.lat]).toEqual([30.5234, 50.4501]);
    expect(kyiv.zoneId).toBe('ukraine');
    expect(kyiv.precision).toBe('settlement');
    expect(out.zones.find((z) => z.id === 'ukraine')!.liveEventCount).toBe(2);
    expect(out.zones.find((z) => z.id === 'sudan')!.liveEventCount).toBe(1);
    expect(out.zones.find((z) => z.id === 'myanmar')!.liveEventCount).toBe(0);
    for (const e of out.events) expect(ConflictEvent.safeParse(e).success).toBe(true);
    // A day later the rolling buffer has aged them out.
    const later = buildConflicts(zones, buffer, [], now + 25 * 3600_000);
    expect(later.events).toHaveLength(0);
  });
});

describe('frontlines', () => {
  it('keeps geometry + plain-text names and takes asOf from the snapshot', () => {
    const out = normalizeDeepState({
      id: 1790798080,
      createdAt: '2026-09-30T19:54:40.000Z',
      map: {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[37, 48], [38, 48], [38, 49], [37, 48]]] }, properties: { name: '<b>Occupied</b>', description: '<a href=x>y</a>' } },
          { type: 'Feature', geometry: { type: 'Point', coordinates: [37, 48] }, properties: {} },
        ],
      },
    });
    expect(out.asOf).toBe('2026-09-30T19:54:40.000Z');
    expect(out.geojson.features).toHaveLength(1);
    expect(out.geojson.features[0]!.properties).toEqual({ id: 'ds-0', name: 'Occupied' });
  });
});

describe('country risk (INFORM + WGI)', () => {
  it('picks the latest INFORM Risk workflow and joins WGI by ISO3 with the method stated', () => {
    const wf = latestWorkflow(json(FX.informWf));
    expect(wf).toMatchObject({ WorkflowId: 515, Name: 'INFORM Risk Mid 2026' });
    const wgi = json<[unknown, { countryiso3code: string; value: number | null }[]]>(FX.wgi)[1];
    const rows = joinRisk(json(FX.inform), wgi, wf!.Name, 2023);
    const afg = rows.find((r) => r.iso3 === 'AFG')!;
    expect(afg.score).toBe(7.8);
    expect(afg.components.inform).toBe(7.8);
    expect(typeof afg.components.wgi_pv).toBe('number');
    expect(afg.method).toBe(RISK_METHOD);
    expect(afg.sources).toEqual(['INFORM (INFORM Risk Mid 2026)', 'World Bank WGI PV.EST 2023']);
    // WGI rows without an ISO3 (e.g. Anguilla in this sample) are not joined by name.
    expect(rows.every((r) => /^[A-Z]{3}$/.test(r.iso3))).toBe(true);
    for (const r of rows) expect(CountryRisk.safeParse(r).success).toBe(true);
  });
});

describe('nuclear facilities', () => {
  const wd = parseWikidata(json<{ results: { bindings: Parameters<typeof parseWikidata>[0] } }>(FX.wikidata).results.bindings);

  it('maps Wikidata statuses and drops cancelled projects', () => {
    expect(wikidataStatus('in use')).toBe('operational');
    expect(wikidataStatus('building or structure under construction')).toBe('under_construction');
    expect(wikidataStatus('decommissioned')).toBe('decommissioned');
    expect(wikidataStatus('cancelled')).toBe('cancelled');
    expect(curatedStatus('Operational (Extended)')).toBe('operational');
    expect(curatedStatus('Active Conflict Zone')).toBe('unknown');
    expect(wd.length).toBeGreaterThan(40);
    expect(wd.some((s) => s.id === 'wd-Q1566977')).toBe(false); // cancelled in the fixture
    for (const s of wd) expect(NuclearSite.safeParse(s).success).toBe(true);
  });

  it('merges curated sites within 10 km into the Wikidata record instead of duplicating', () => {
    const a = wd[0]!;
    const merged = mergeNuclear([a], [
      { id: 'nuc-x', name: 'Same Plant', city: 'Town', country: 'C', lat: a.lat + 0.01, lng: a.lng, status: 'Operational', reactors: 2, capacityMW: 1800, owner: 'Op' },
      { id: 'nuc-y', name: 'Elsewhere', city: 'Far', country: 'C', lat: -33.6769, lng: 18.4344, status: 'Operational', reactors: 2, capacityMW: 1860, owner: 'Eskom' },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.reactors).toBe(2);
    expect(merged[0]!.city).toBe('Town');
    expect(merged[1]).toMatchObject({ id: 'nuc-y', source: 'curated', wikidataId: null, observedAt: null });
  });

  it('flags seismic (M≥4.5, 150 km, 24 h) and conflict (settlement events, 50 km) with the method', () => {
    const now = Date.parse('2026-09-30T20:00:00Z');
    const site = { ...wd[0]!, lat: 47.5113, lng: 34.5861 };
    const flagged = flagSites(
      [site],
      [
        { id: 'q1', lat: 47.0, lng: 35.0, magnitude: 5.1, observedAt: '2026-09-30T10:00:00.000Z' },
        { id: 'q2', lat: 47.0, lng: 35.0, magnitude: 4.0, observedAt: '2026-09-30T11:00:00.000Z' },
        { id: 'q3', lat: 47.0, lng: 35.0, magnitude: 6.0, observedAt: '2026-09-28T10:00:00.000Z' },
      ],
      [{ id: 'e1', lat: 47.6, lng: 34.4, title: 't', source: 'gdelt', zoneId: 'ukraine', observedAt: '2026-09-30T19:00:00.000Z', url: null, precision: 'settlement' }],
      now,
    )[0]!;
    expect(flagged.flags.map((f) => f.kind)).toEqual(['seismic', 'conflict']);
    expect(flagged.flags[0]).toMatchObject({ method: SEISMIC_METHOD, observedAt: '2026-09-30T10:00:00.000Z' });
    expect(flagged.flags[0]!.label).toMatch(/^M5\.1 earthquake \d+ km away$/);
    expect(flagged.flags[1]).toMatchObject({ method: CONFLICT_METHOD, observedAt: '2026-09-30T19:00:00.000Z' });
    expect(NuclearSite.safeParse(flagged).success).toBe(true);
  });
});
