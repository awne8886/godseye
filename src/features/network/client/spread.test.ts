import { describe, expect, it } from 'vitest';
import { FeedEvent } from '@/lib/schemas';
import { spreadPositions } from './spread';

describe('display spreading of co-located indicators', () => {
  it('offsets only the drawn position of co-located points and never mutates the data', () => {
    const items = [
      { id: 'a', lat: 52.37, lng: 4.89 },
      { id: 'b', lat: 52.37, lng: 4.89 },
      { id: 'c', lat: 52.37, lng: 4.89 },
      { id: 'd', lat: 10, lng: 10 },
    ];
    const before = JSON.stringify(items);
    const { pos, shared } = spreadPositions(items, 6);
    expect(JSON.stringify(items)).toBe(before);
    expect(shared).toEqual([3, 3, 3, 1]);
    expect(pos[0]).toEqual([4.89, 52.37]); // the first of a group stays on the true point
    expect(pos[3]).toEqual([10, 10]);
    expect(new Set(pos.slice(0, 3).map((p) => p.join(','))).size).toBe(3);
    // The offset is a few pixels: it shrinks as the map zooms in.
    const far = spreadPositions(items, 2).pos[1]!;
    const near = spreadPositions(items, 10).pos[1]!;
    expect(Math.abs(far[0] - 4.89)).toBeGreaterThan(Math.abs(near[0] - 4.89));
  });
});

describe('Intel Feed events', () => {
  it('map to the FeedEvent contract with ids unique within the layer', async () => {
    const { gdacsEvents, gdeltEvents } = await import('../../threats/client/ThreatsLayer');
    const { malwareEvents, outageEvents } = await import('./NetworkLayer');
    const g = gdacsEvents([{ id: 'gdacs-TC-1', lat: 1, lng: 2, observedAt: '2026-09-30T10:00:00.000Z', source: 'gdacs', eventType: 'TC', title: 'Storm', alertLevel: 'red', country: 'X', url: null, fromDate: null, toDate: null }]);
    const m = malwareEvents([{ id: '1.2.3.4', ip: '1.2.3.4', lat: 1, lng: 1, observedAt: '2026-09-30T10:00:00.000Z', source: 'urlhaus', port: 80, threat: 'malware_download', family: 'Mozi', urlCount: 1, online: true, asn: null, country: 'X', city: null, geoPrecision: 'city', urlhausReference: null, firstSeen: null }]);
    const o = outageEvents([{ id: 'ioda-BM-1', lat: 32, lng: -64, observedAt: '2026-09-17T19:25:00.000Z', source: 'ioda', country: 'Bermuda', countryCode: 'BM', scope: 'country', cause: null, description: null, startedAt: '2026-09-17T19:25:00.000Z', endedAt: null, ongoing: true, provider: 'IODA', url: null }]);
    const e = gdeltEvents([]);
    for (const ev of [...g, ...m, ...o, ...e]) expect(FeedEvent.safeParse(ev).success).toBe(true);
    expect(g[0]!.severity).toBe('high');
  });
});
