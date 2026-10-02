import { afterEach, describe, expect, it } from 'vitest';
import { AttackOrigin, C2Server, KevEntry, MalwareHost, Outage, SdkEntity, SubmarineCable, ThreatIndicator } from '@/lib/schemas';
import { fixture, FX } from '../../threats/server/__fixtures__';
import { flattenThreatFox, iocIp, toC2, toIndicator, type FeodoRow, type ThreatFoxIoc } from './abusech';
import { loadCables } from './cables';
import { isLookupableIp, toIpGeo, type IpGeo } from './ipgeo';
import { nvdScore, parseKev } from './kev';
import { mapCloudflareOutages, mapIoda, mapOrigins } from './outages';
import { authorized, ingest, readCapped, resetSdk, sdkSnapshot } from './sdk';
import { diffHosts, groupHosts, ipHostOf, parseUrlhausCsv, toMalwareHost } from './urlhaus';

const json = <T>(name: string) => JSON.parse(fixture(name).toString('utf8')) as T;
const geo = (lat: number, lng: number): IpGeo => ({ lat, lng, precision: 'city', country: 'Testland', countryCode: 'TL', city: 'Town', asn: 'AS1' });

describe('URLhaus csv_recent (fixture 2026-09-30)', () => {
  const rows = parseUrlhausCsv(fixture(FX.urlhaus).toString('utf8'));

  it('skips the # header block and parses zone-less UTC dates', () => {
    expect(rows).toHaveLength(400);
    expect(rows[0]).toMatchObject({ id: '3925757', url: 'http://112.82.137.139:39661/i', online: true, threat: 'malware_download', dateAdded: '2026-09-30T19:54:23.000Z' });
    expect(rows[0]!.tags).toContain('Mozi');
  });

  it('keys hosts by literal IP only (domains are never resolved)', () => {
    expect(ipHostOf('http://112.82.137.139:39661/i')).toEqual({ ip: '112.82.137.139', port: 39661 });
    expect(ipHostOf('https://evil.example.com/x.exe')).toBeNull();
    expect(ipHostOf('http://192.168.1.10/x')).toBeNull();
    const hosts = groupHosts(rows);
    expect(hosts.length).toBeGreaterThan(50);
    expect(new Set(hosts.map((h) => h.ip)).size).toBe(hosts.length);
    const h = hosts.find((x) => x.ip === '112.82.137.139')!;
    expect(h.family).toBe('Mozi');
    const host = toMalwareHost(h, geo(31, 120));
    expect(MalwareHost.safeParse(host).success).toBe(true);
    expect(host.geoPrecision).toBe('city');
  });

  it('beacons only NEW IPs and reports retired ones', () => {
    const a = toMalwareHost(groupHosts(rows)[0]!, geo(1, 1));
    const b = toMalwareHost(groupHosts(rows)[1]!, geo(2, 2));
    const c = toMalwareHost(groupHosts(rows)[2]!, geo(3, 3));
    expect(diffHosts(null, [a, b])).toEqual({ added: [], retired: [] }); // first snapshot: no beacons
    const d = diffHosts([a, b], [{ ...b, urlCount: 9 }, c]);
    expect(d.added.map((x) => x.ip)).toEqual([c.ip]); // b changed but is not new
    expect(d.retired).toEqual([a.ip]);
  });
});

describe('ip-api geolocation', () => {
  it('maps batch rows with precision and never looks up private or non-IP hosts', () => {
    const [google] = json<Parameters<typeof toIpGeo>[0][]>(FX.ipapi);
    expect(toIpGeo(google!)).toMatchObject({ lat: 39.03, lng: -77.5, precision: 'city', asn: 'AS15169' });
    expect(toIpGeo({ status: 'fail' })).toBeNull();
    expect(isLookupableIp('8.8.8.8')).toBe(true);
    expect(isLookupableIp('10.0.0.1')).toBe(false);
    expect(isLookupableIp('example.com')).toBe(false);
  });
});

describe('Feodo C2 + ThreatFox as INDICATOR points', () => {
  it('labels every C2 INDICATOR, keeps Feodo’s status and marks date-only last-online', () => {
    const rows = json<FeodoRow[]>(FX.feodo);
    const { items, unlocated } = toC2(rows, new Map([['50.16.16.211', geo(39, -77)]]));
    expect(items.length + unlocated).toBe(rows.length);
    for (const c of items) {
      expect(C2Server.safeParse(c).success).toBe(true);
      expect(c.label).toBe('INDICATOR');
      expect('target' in c || 'targetLat' in c).toBe(false); // no arcs: a blocklist names one end only
    }
    const online = items.find((c) => c.ip === '50.16.16.211')!;
    expect(online).toMatchObject({ status: 'online', geoPrecision: 'city', lastOnline: '2026-03-12T00:00:00.000Z', lastOnlineDateOnly: true, asn: 'AS14618' });
    const fallback = items.find((c) => c.ip === '162.243.103.246')!;
    expect(fallback.geoPrecision).toBe('country-centroid');
  });

  it('lists every ThreatFox IOC but places only literal IPs', () => {
    const iocs = flattenThreatFox(json<Record<string, ThreatFoxIoc[]>>(FX.threatfox));
    expect(iocs.length).toBeGreaterThanOrEqual(150);
    expect(Number(iocs[0]!.id)).toBeGreaterThan(Number(iocs.at(-1)!.id));
    const dom = iocs.find((i) => i.ioc_type === 'domain');
    if (dom) expect(iocIp(dom)).toBeNull();
    const ipIoc = iocs.find((i) => i.ioc_type === 'ip:port')!;
    const ip = iocIp(ipIoc)!;
    expect(ipIoc.ioc_value.startsWith(`${ip}:`)).toBe(true);
    const placed = toIndicator(ipIoc, geo(10, 10));
    const listed = toIndicator(dom ?? ipIoc, undefined);
    for (const t of [placed, listed]) {
      expect(ThreatIndicator.safeParse(t).success).toBe(true);
      expect(t.label).toBe('INDICATOR');
    }
    expect(placed.geo).toMatchObject({ lat: 10, lng: 10, precision: 'city' });
    expect(listed.geo).toBeNull();
    expect(placed.reference).toMatch(/^https:\/\//);
  });
});

describe('CISA KEV + NVD', () => {
  it('parses KEV newest first and reads the NVD CVSS score', () => {
    const kev = parseKev(json(FX.kev));
    expect(kev).toHaveLength(30);
    expect(kev[0]!.dateAdded >= kev.at(-1)!.dateAdded).toBe(true);
    for (const k of kev) expect(KevEntry.safeParse(k).success).toBe(true);
    expect(nvdScore(json(FX.nvd))).toEqual({ score: 10, severity: 'CRITICAL', version: '3.1' });
    expect(nvdScore({ vulnerabilities: [] })).toBeNull();
  });
});

describe('outages + attack origins', () => {
  it('maps IODA country events to outages at the country label point, ongoing when they reach the window end', () => {
    const body = json<{ data: Parameters<typeof mapIoda>[0]; requestParameters: { until: string } }>(FX.ioda);
    const out = mapIoda(body.data, Number(body.requestParameters.until));
    expect(out.length).toBe(18);
    const bm = out.find((o) => o.countryCode === 'BM')!;
    expect(bm).toMatchObject({ provider: 'IODA', ongoing: true, endedAt: null, startedAt: '2026-09-17T19:25:00.000Z' });
    for (const o of out) expect(Outage.safeParse(o).success).toBe(true);
  });

  it('maps Cloudflare outage annotations per location', () => {
    const out = mapCloudflareOutages([{ id: 'a1', startDate: '2026-09-30T10:00:00Z', endDate: null, locations: ['IR', 'XX'], outage: { outageCause: 'GOVERNMENT_DIRECTED' }, scope: 'Nationwide' }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ countryCode: 'IR', cause: 'GOVERNMENT_DIRECTED', ongoing: true, provider: 'Cloudflare Radar' });
  });

  it('draws attack origins as points unless a target is reported', () => {
    const pts = mapOrigins([{ originCountryAlpha2: 'US', originCountryName: 'United States', value: '12.5' }, { originCountryAlpha2: 'ZZ', value: '1' }], '2026-09-30T20:00:00.000Z');
    expect(pts).toHaveLength(1);
    expect(pts[0]!.targetCountryCode).toBeUndefined();
    expect(AttackOrigin.safeParse(pts[0]).success).toBe(true);
    const arc = mapOrigins([{ originCountryAlpha2: 'CN', value: 3, targetCountryAlpha2: 'US' }], null)[0]!;
    expect(arc.targetCountryCode).toBe('US');
  });
});

describe('cables (bundled TeleGeography)', () => {
  it('serves cables as MultiLineStrings with unknown attributes left null', () => {
    const { cables, landingPoints } = loadCables();
    expect(cables.length).toBeGreaterThan(600);
    expect(landingPoints.length).toBeGreaterThan(1500);
    const c = cables[0]!;
    expect(SubmarineCable.safeParse(c).success).toBe(true);
    expect(c).toMatchObject({ rfsYear: null, lengthKm: null, owners: null });
    expect(landingPoints[0]!.observedAt).toBeNull();
  });
});

describe('SDK ingest', () => {
  afterEach(resetSdk);
  const entity = { id: 'trk-1', name: 'Test track', domain: 'SEA', entityType: 'TRACK', position: { lat: 10, lng: 20 }, timestamp: '2026-09-30T20:00:00Z', source: { system: 'unit' } };

  it('fails closed without a key and compares the Bearer in constant time', () => {
    expect(authorized('Bearer abc', undefined)).toBe(false);
    expect(authorized('Bearer abc', '')).toBe(false);
    expect(authorized('Bearer abc', 'abc')).toBe(true);
    expect(authorized('Bearer abd', 'abc')).toBe(false);
    expect(authorized('abc', 'abc')).toBe(false);
    expect(authorized(null, 'abc')).toBe(false);
  });

  it('caps the body size while reading', async () => {
    const small = new Request('http://x/', { method: 'POST', body: 'x'.repeat(10) });
    expect(await readCapped(small, 100)).toBe('x'.repeat(10));
    const big = new Request('http://x/', { method: 'POST', body: 'x'.repeat(1000) });
    expect(await readCapped(big, 100)).toBeNull();
  });

  it('validates each entity and labels accepted ones THIRD-PARTY', () => {
    const r = ingest({ entities: [entity, { ...entity, id: 'bad id!' }, { nope: 1 }] });
    expect(r).toMatchObject({ accepted: 1, rejected: 2 });
    expect(r.errors).toHaveLength(2);
    const snap = sdkSnapshot();
    expect(snap.entities).toHaveLength(1);
    expect(SdkEntity.safeParse(snap.entities[0]).success).toBe(true);
    expect(snap.entities[0]).toMatchObject({ thirdParty: true, label: 'THIRD-PARTY (SDK)' });
    expect(ingest({ entities: [] })).toMatchObject({ accepted: 0, rejected: 0 });
  });
});
