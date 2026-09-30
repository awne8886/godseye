import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpJson } from '@/lib/http';
import type { FeedContext } from '@/lib/feeds';
import { celestrakRoutes, netError, upstreamRouter } from '../__fixtures__/upstreams';
import { fx } from '../__fixtures__';
import { COL } from '../lib/catalog';
import { CELESTRAK_GROUPS } from '../lib/catalog';
import { ERROR_BUDGET, celestrakErrorCount, recordCelestrakError, resetCelestrakErrors, runSatellites, type SatCatalogue } from './satellites';

vi.mock('@/lib/http', async (orig) => ({ ...(await orig<Record<string, unknown>>()), httpJson: vi.fn() }));

const ctx = (previous: SatCatalogue | null = null): FeedContext<SatCatalogue> => ({ previous, etag: null, lastModified: null, signal: new AbortController().signal });

beforeEach(() => {
  resetCelestrakErrors();
  vi.mocked(httpJson).mockReset();
});
afterEach(() => resetCelestrakErrors());

describe('satellites feed run', () => {
  it('builds the catalogue from active + classification groups (FORMAT=json only)', async () => {
    const r = upstreamRouter(celestrakRoutes());
    vi.mocked(httpJson).mockImplementation(r.impl as never);
    const out = await runSatellites(ctx());
    expect(out.data.source).toBe('celestrak');
    expect(out.data.rows.length).toBe(fx.active.length);
    expect(out.providers.celestrak!.status).toMatchObject({ ok: true, count: fx.active.length });
    expect(out.providers['celestrak-groups']!.status.ok).toBe(true);
    expect(r.calls.length).toBe(1 + CELESTRAK_GROUPS.length);
    expect(r.calls.every((u) => u.startsWith('https://celestrak.org/NORAD/elements/gp.php?GROUP=') && u.endsWith('&FORMAT=json'))).toBe(true);
    const iss = out.data.rows.find((row) => row[COL.noradId] === 25544)!;
    expect(iss[COL.category]).toBe('science');
    expect(iss[COL.group]).toBe('stations');
    expect(iss[COL.epoch]).toMatch(/Z$/);
    expect(out.observedAt).toBeGreaterThan(Date.parse('2026-09-29T00:00:00Z'));
  });

  it('stops at the first failing group (never hammers) and keeps the previous membership', async () => {
    const first = upstreamRouter(celestrakRoutes());
    vi.mocked(httpJson).mockImplementation(first.impl as never);
    const prev = (await runSatellites(ctx())).data;
    const routes = celestrakRoutes();
    routes['GROUP=gps-ops&'] = netError();
    const r = upstreamRouter(routes);
    vi.mocked(httpJson).mockImplementation(r.impl as never);
    const out = await runSatellites(ctx(prev));
    const gpsIdx = CELESTRAK_GROUPS.findIndex((g) => g.group === 'gps-ops');
    expect(r.calls.length).toBe(1 + gpsIdx + 1);
    expect(celestrakErrorCount()).toBe(1);
    expect(out.providers['celestrak-groups']!.status).toMatchObject({ ok: false, error: `groups ${gpsIdx}/${CELESTRAK_GROUPS.length}` });
    expect(out.data.groupMembers['gps-ops']).toEqual(prev.groupMembers['gps-ops']);
  });

  it('keeps the last-good CelesTrak catalogue (throws → stale) when active fails and it is < 24 h old', async () => {
    const ok = upstreamRouter(celestrakRoutes());
    vi.mocked(httpJson).mockImplementation(ok.impl as never);
    const prev = (await runSatellites(ctx())).data;
    const r = upstreamRouter({ 'GROUP=active&': netError(), 'db.satnogs.org': fx.satnogs });
    vi.mocked(httpJson).mockImplementation(r.impl as never);
    await expect(runSatellites(ctx(prev))).rejects.toThrow(/last-good/);
    expect(r.calls.some((u) => u.includes('satnogs'))).toBe(false);
  });

  it('falls back to SatNOGS, labelled, when there is no CelesTrak catalogue', async () => {
    const r = upstreamRouter({ 'GROUP=active&': netError(), 'db.satnogs.org': fx.satnogs });
    vi.mocked(httpJson).mockImplementation(r.impl as never);
    const out = await runSatellites(ctx());
    expect(out.data.source).toBe('satnogs');
    expect(out.data.rows.length).toBe(fx.satnogs.length);
    expect(out.providers.celestrak!.status.ok).toBe(false);
    expect(out.providers.satnogs!.status).toMatchObject({ ok: true, count: fx.satnogs.length });
    expect(out.data.rows.every((row) => row[COL.group] === 'satnogs')).toBe(true);
  });

  it('stops calling CelesTrak once the error budget is spent', async () => {
    for (let i = 0; i < ERROR_BUDGET; i++) recordCelestrakError();
    const r = upstreamRouter({ 'db.satnogs.org': fx.satnogs });
    vi.mocked(httpJson).mockImplementation(r.impl as never);
    const out = await runSatellites(ctx());
    expect(out.providers.celestrak!.status).toMatchObject({ ok: false, skipped: 'budget' });
    expect(r.calls.some((u) => u.includes('celestrak'))).toBe(false);
  });

  it('errors age out of the 2 h window', () => {
    recordCelestrakError(Date.now() - 3 * 3600_000);
    expect(celestrakErrorCount()).toBe(0);
  });

  it('fails the refresh when no source answers', async () => {
    const r = upstreamRouter({ 'GROUP=active&': netError(), 'db.satnogs.org': netError() });
    vi.mocked(httpJson).mockImplementation(r.impl as never);
    await expect(runSatellites(ctx())).rejects.toThrow(/no satellite catalogue/);
  });
});
