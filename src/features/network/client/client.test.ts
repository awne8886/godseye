import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FeedEvent } from '@/lib/schemas';
import type { MalwareHost } from '@/lib/types';
import { fixture, FX } from '../../threats/server/__fixtures__';
import type { IpGeo } from '../server/ipgeo';
import { parseKev } from '../server/kev';
import { groupHosts, parseUrlhausCsv, toMalwareHost } from '../server/urlhaus';
import { colocatedRadiusPx, groupColocated } from './colocate';
import { KEV_FEED_LAYER, kevEvents } from './kev-events';
import { malwareCount, needsResync, reduceMalware } from './malware-state';

const geo = (lat: number, lng: number): IpGeo => ({ lat, lng, precision: 'city', country: 'Testland', countryCode: 'TL', city: 'Town', asn: 'AS1' });
/** Real URLhaus hosts (fixture 2026-09-30); positions assigned per test. */
const HOSTS = groupHosts(parseUrlhausCsv(fixture(FX.urlhaus).toString('utf8')));
const host = (i: number, lat = i, lng = i): MalwareHost => toMalwareHost(HOSTS[i]!, geo(lat, lng));

describe('co-located indicators (visual-qa M10)', () => {
  it('groups by exact coordinate without moving, dropping or duplicating any indicator', () => {
    const items = [host(0, 52.37, 4.89), host(1, 52.37, 4.89), host(2, 52.37, 4.89), host(3, 10, 10), host(4, 52.37001, 4.89)];
    const before = JSON.stringify(items);
    const groups = groupColocated(items);
    expect(JSON.stringify(items)).toBe(before);
    expect(groups.map((g) => g.items.length)).toEqual([3, 1, 1]);
    // Every group sits exactly on its members' served coordinate.
    for (const g of groups) for (const m of g.items) expect([m.lng, m.lat]).toEqual([g.lng, g.lat]);
    // Total count is preserved (the rail count equals what is served).
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(items.length);
    expect(new Set(groups.flatMap((g) => g.items.map((m) => m.ip))).size).toBe(items.length);
  });

  it('sizes the single point by √n with a 28 px cap', () => {
    expect(colocatedRadiusPx(1, 4)).toBe(4);
    expect(colocatedRadiusPx(4, 4)).toBe(8);
    expect(colocatedRadiusPx(300, 4)).toBe(28);
  });
});

describe('Live Malware count (R3-M2)', () => {
  it('snapshot → detections → status: the count always equals the host set', () => {
    const [a, b, c, d] = [host(0), host(1), host(2), host(3)];
    let hosts = reduceMalware(null, { type: 'snapshot', items: [a!, b!] });
    expect(malwareCount(hosts)).toBe(2);
    // The server sends detections (new IPs), then status retiring the old ones with its own total.
    hosts = reduceMalware(hosts, { type: 'detections', items: [c!, d!] });
    expect(malwareCount(hosts)).toBe(4);
    const status = { type: 'status' as const, retired: [a!.ip, b!.ip], total: 2 };
    hosts = reduceMalware(hosts, status);
    expect(malwareCount(hosts)).toBe(2);
    expect(hosts.map((h) => h.ip)).toEqual([c!.ip, d!.ip]);
    expect(needsResync(hosts, status)).toBe(false);
  });

  it('re-sent detections never inflate the count; a mismatch with the server total asks for a resync', () => {
    const [a, b] = [host(0), host(1)];
    let hosts = reduceMalware(null, { type: 'snapshot', items: [a!, a!, b!] });
    expect(malwareCount(hosts)).toBe(2);
    hosts = reduceMalware(hosts, { type: 'detections', items: [b!] });
    expect(malwareCount(hosts)).toBe(2);
    expect(needsResync(hosts, { type: 'status', retired: [], total: 5 })).toBe(true);
    expect(malwareCount(null)).toBeNull();
  });
});

describe('CISA KEV → Intel Feed (R3-m1)', () => {
  const items = parseKev(JSON.parse(fixture(FX.kev).toString('utf8')) as Parameters<typeof parseKev>[0]);

  it('maps newest additions to coordinate-less FeedEvents with the date-only CISA date', () => {
    const ev = kevEvents(items.slice(0, 5));
    expect(ev).toHaveLength(5);
    for (const [i, e] of ev.entries()) {
      expect(FeedEvent.safeParse(e).success).toBe(true);
      expect(e.lat).toBeUndefined();
      expect(e.lng).toBeUndefined();
      expect(e.layer).toBe(KEV_FEED_LAYER);
      expect(e.id).toBe(items[i]!.cveId);
      expect(e.observedAt).toBe(`${items[i]!.dateAdded}T00:00:00.000Z`);
      expect(e.detail).toContain(`added ${items[i]!.dateAdded} (date only)`);
    }
  });

  it('marks known ransomware use as high severity', () => {
    const r = items.find((k) => k.ransomware === 'Known');
    if (r) expect(kevEvents([r])[0]!.severity).toBe('high');
    const plain = items.find((k) => k.ransomware === 'Unknown' && k.cvssScore == null);
    if (plain) expect(kevEvents([plain])[0]!.severity).toBe('medium');
  });
});

describe('Intel Feed events', () => {
  it('map to the FeedEvent contract with ids unique within the layer', async () => {
    const { gdacsEvents, gdeltEvents } = await import('../../threats/client/ThreatsLayer');
    const { malwareEvents, outageEvents } = await import('./NetworkLayer');
    const g = gdacsEvents([{ id: 'gdacs-TC-1', lat: 1, lng: 2, observedAt: '2026-09-30T10:00:00.000Z', source: 'gdacs', eventType: 'TC', title: 'Storm', alertLevel: 'red', country: 'X', url: null, fromDate: null, toDate: null }]);
    const m = malwareEvents([host(0)], '2026-09-30T20:00:00.000Z');
    const o = outageEvents([{ id: 'ioda-BM-1', lat: 32, lng: -64, observedAt: '2026-09-17T19:25:00.000Z', source: 'ioda', country: 'Bermuda', countryCode: 'BM', scope: 'country', cause: null, description: null, startedAt: '2026-09-17T19:25:00.000Z', endedAt: null, ongoing: true, provider: 'IODA', url: null }]);
    const e = gdeltEvents([]);
    for (const ev of [...g, ...m, ...o, ...e]) expect(FeedEvent.safeParse(ev).success).toBe(true);
    expect(g[0]!.severity).toBe('high');
  });
});

describe('initial bundle (perf B1)', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  it.each(['src/features/threats/index.ts', 'src/features/network/index.ts', 'src/features/maritime/index.ts', 'src/features/threats/client/lazy.ts'])('%s imports no deck.gl / layer / card module statically', (file) => {
    const src = read(file);
    const statics = [...src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]!);
    for (const s of statics) {
      expect(s).not.toMatch(/@deck\.gl|@luma\.gl|maplibre-gl|zod|\/client\/(ThreatsLayer|NetworkLayer|MaritimeLayer|cards)|\/schemas/);
    }
    expect(statics.every((s) => ['next/dynamic', 'react', '@/lib/feature-module', './client/lazy', '../threats/client/lazy'].includes(s))).toBe(true);
  });
});
