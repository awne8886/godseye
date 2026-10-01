import type * as Http from '@/lib/http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FX, type Route } from '@/features/threats/server/__fixtures__';
import { freshCache, req, resetCache } from '@/features/threats/server/__fixtures__/routes';
import { conflictsFeed, resetConflictBuffer } from '@/features/threats/server/conflicts';
import { gdeltFeed, resetGdeltBatches } from '@/features/threats/server/gdelt';
import { GET } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/features/threats/server/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError) };
});
beforeEach(() => { freshCache(); resetGdeltBatches(); resetConflictBuffer(); vi.useFakeTimers({ now: Date.parse('2026-09-30T20:10:00Z'), toFake: ['Date'] }); });
afterEach(() => { vi.useRealTimers(); gdeltFeed.stop(); conflictsFeed.stop(); resetCache(); });

// Phase 3 round 3 R3-M1: last-good GDELT data is not a live success.
it('conflicts is not LIVE (and gdelt not ok) after GDELT has been down for 3 h', async () => {
  state.routes = [['lastupdate.txt', FX.gdeltLast], ['20260930200000.export', FX.gdeltZip], ['.export.CSV.zip', 404]];
  const first = await (await GET(req('/api/conflicts'), undefined)).json();
  expect(first.events.length).toBeGreaterThan(0);
  state.routes = [['lastupdate.txt', 503]];
  vi.setSystemTime(Date.parse('2026-09-30T23:10:00Z'));
  await gdeltFeed.refresh().catch(() => {});
  await conflictsFeed.refresh().catch(() => {});
  const body = await (await GET(req('/api/conflicts'), undefined)).json();
  expect(body.providers.gdelt.ok).toBe(false);
  expect(body.meta.state).not.toBe('live');
});
