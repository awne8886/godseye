import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FX, type Route } from '@/features/hazards/server/__fixtures__';
import { freshCache, req, resetCache } from '@/features/hazards/server/__fixtures__/routes';
import { resetLookups } from '@/features/hazards/server/lookup';
import { defineFeed, getFeed, resetFeeds } from '@/lib/feeds';
import { GpsInterferenceResponse } from '@/lib/schemas';
import { GET } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/features/hazards/server/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError) };
});

beforeEach(() => {
  freshCache();
  resetLookups();
});
afterEach(() => {
  getFeed('flights')?.stop();
  resetFeeds();
  resetCache();
});

const ALL: Route[] = [
  ['gpsjam.org/data/manifest.csv', FX.gpsManifest],
  ['gpsjam.org/data/2026-09-29-h3_4.csv', FX.gpsDay],
];

describe('GET /api/gps-interference', () => {
  it('serves the latest gpsjam day: bad > 0 cells, totalCells and the suspect flag', async () => {
    state.routes = ALL;
    const res = await GET(req('/api/gps-interference'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(GpsInterferenceResponse.safeParse(body).success).toBe(true);
    expect(body.totalCells).toBe(399);
    expect(body.suspect).toBe(false);
    // gpsjam's (bad − 1) correction: only cells with ≥ 2 degraded aircraft have a share above zero.
    expect(body.items.every((c: { bad: number; date: string }) => c.bad >= 2 && c.date === '2026-09-29')).toBe(true);
    expect(body.providers.gpsjam_manifest.ok).toBe(true);
    expect(body.providers.gpsjam).toMatchObject({ ok: true });
    // No flights feed in this process: live binning did not run, so it is reported as not available.
    expect(body.providers.live_nacp).toMatchObject({ ok: false, count: 0, error: 'flights_feed_not_running' });
    expect(body.items.some((c: { basis: string }) => c.basis === 'live-nacp')).toBe(false);
    expect(body.meta).toMatchObject({ feed: 'gps-interference', kind: 'live' });
    expect(body.meta.attribution[0].licence).toMatch(/unstated/i);
  });

  it('adds live NACp bins from the in-process flights feed (airborne ADS-B, ≤ 60 s old)', async () => {
    state.routes = ALL;
    const t = Math.floor(Date.now() / 1000) - 5;
    const old = t - 120;
    const flights = defineFeed({
      key: 'flights',
      ttlMs: 60_000,
      kind: 'live',
      attribution: [],
      count: (d: { rows: unknown[] }) => d.rows.length,
      run: async () => ({
        data: {
          fields: ['id', 'onGround', 'lat', 'lng', 'nacP', 'seenAt'],
          rows: [
            ['a', 0, 51.47, -0.45, 3, t],
            ['b', 0, 51.471, -0.452, 9, t],
            ['c', 0, 51.472, -0.451, 10, t],
            // Excluded: on the ground, TIS-B (`~` address), older than the 60 s window.
            ['d', 1, 51.4705, -0.4505, 0, t],
            ['~e', 0, 51.4706, -0.4506, 0, t],
            ['f', 0, 51.4707, -0.4507, 0, old],
          ],
        },
        providers: {},
      }),
    });
    await flights.get();
    const body = await (await GET(req('/api/gps-interference'), undefined)).json();
    expect(GpsInterferenceResponse.safeParse(body).success).toBe(true);
    const live = body.items.filter((c: { basis: string }) => c.basis === 'live-nacp');
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ aircraft: 3, bad: 1, date: null });
    expect(body.providers.live_nacp).toMatchObject({ ok: true, count: 1 });
    expect(body.meta.note).toMatch(/≤ 60 s old/);
    expect(body.meta.note).toMatch(/airborne ADS-B/);
    expect(body.meta.note).toMatch(/\(bad − 1\) \/ \(good \+ bad\)/);
  });

  it('validates the date', async () => {
    expect((await GET(req('/api/gps-interference?date=2021-01-01'), undefined)).status).toBe(400);
    expect((await GET(req('/api/gps-interference?date=yesterday'), undefined)).status).toBe(400);
  });

  it('serves a requested day without live bins', async () => {
    state.routes = [['gpsjam.org/data/manifest.csv', FX.gpsManifest], ['gpsjam.org/data/2026-09-28-h3_4.csv', FX.gpsDay]];
    const body = await (await GET(req('/api/gps-interference?date=2026-09-28'), undefined)).json();
    expect(body.items[0].date).toBe('2026-09-28');
    expect(body.suspect).toBe(false);
  });

  it('is SOURCE OFFLINE when gpsjam is unreachable', async () => {
    state.routes = [];
    const res = await GET(req('/api/gps-interference'), undefined);
    expect(res.status).toBe(503);
    expect((await res.json()).providers.gpsjam_manifest).toMatchObject({ ok: false, error: 'network' });
  });
});
