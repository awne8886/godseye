import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FX, type Route } from '@/features/threats/server/__fixtures__';
import { freshCache, req, resetCache } from '@/features/threats/server/__fixtures__/routes';
import { newestSignal, outagesFeed } from '@/features/network/server/outages';
import { OutagesResponse } from '@/lib/schemas';
import { GET as ALIAS } from '../radar/route';
import { GET } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/features/threats/server/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError) };
});

beforeEach(() => {
  freshCache();
  delete process.env.CLOUDFLARE_API_TOKEN;
});
afterEach(() => {
  outagesFeed.stop();
  resetCache();
});

const EXPECTED_SIGNAL = '2026-09-30T09:10:00.000Z';

describe('GET /api/outages (+ alias /api/radar)', () => {
  it('serves IODA outages keyless and reports Cloudflare as not configured', async () => {
    state.routes = [['api.ioda.inetintel.cc.gatech.edu', FX.ioda]];
    const res = await GET(req('/api/outages'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(OutagesResponse.safeParse(body).success).toBe(true);
    expect(body.items).toHaveLength(18);
    expect(body.providers.ioda).toMatchObject({ ok: true, count: 18 });
    expect(body.providers.cloudflare).toMatchObject({ ok: false, skipped: 'not-configured' });
    expect(body.meta.feed).toBe('outages');
    const alias = await (await ALIAS(req('/api/radar'), undefined)).json();
    expect(alias.items).toEqual(body.items);
  });

  // R3 round-4 MINOR-6: meta.observedAt was null although every item carries an observed time.
  it('fills meta.observedAt from the newest IODA signal, never the fetch time', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-09-30T20:10:00Z'), toFake: ['Date'] });
    try {
      state.routes = [['api.ioda.inetintel.cc.gatech.edu', FX.ioda]];
      const body = await (await GET(req('/api/outages'), undefined)).json();
      expect(OutagesResponse.safeParse(body).success).toBe(true);
      expect(body.providers.ioda).toMatchObject({ ok: true, count: 18 });
      expect(body.providers.cloudflare).toMatchObject({ ok: false, skipped: 'not-configured' });
      // Newest observed signal in the recorded 2026-09-30 events (onset of ongoing ones, recovery of
      // ended ones), never the 20:10 fetch.
      expect(body.meta.observedAt).toBe(EXPECTED_SIGNAL);
      expect(body.meta.fetchedAt).toBe('2026-09-30T20:10:00.000Z');
      expect(body.meta.state).toBe('live');
      for (const o of body.items) expect(Date.parse(o.lastSignalAt)).toBeLessThanOrEqual(Date.parse(body.meta.fetchedAt));
    } finally {
      vi.useRealTimers();
    }
  });

  it('newestSignal: none reported is null; a signal after now is capped at now', () => {
    expect(newestSignal([])).toBeNull();
    const base = { startedAt: '2026-09-30T19:00:00.000Z', lastSignalAt: '2026-09-30T21:00:00.000Z' } as Parameters<typeof newestSignal>[0][number];
    expect(newestSignal([base], Date.parse('2026-09-30T20:00:00Z'))).toBe(Date.parse('2026-09-30T20:00:00Z'));
    expect(newestSignal([{ ...base, lastSignalAt: null }], Date.parse('2026-09-30T20:00:00Z'))).toBe(Date.parse('2026-09-30T19:00:00Z'));
  });

  it('treats "no outage" as truthful but a failed IODA as SOURCE OFFLINE', async () => {
    state.routes = [['api.ioda.inetintel.cc.gatech.edu', Buffer.from('{"data":[]}')]];
    const ok = await GET(req('/api/outages'), undefined);
    expect(ok.status).toBe(200);
    const none = await ok.json();
    expect(none.items).toEqual([]);
    // Nothing observed: no observation time is invented.
    expect(none.meta.observedAt).toBeNull();
    expect(none.providers.ioda).toMatchObject({ ok: true, count: 0 });
    outagesFeed.stop();
    resetCache();
    freshCache();
    state.routes = [['api.ioda.inetintel.cc.gatech.edu', 503]];
    expect((await GET(req('/api/outages'), undefined)).status).toBe(503);
  });
});
