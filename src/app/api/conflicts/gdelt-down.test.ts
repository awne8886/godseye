import type * as Http from '@/lib/http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FX, type Route } from '@/features/threats/server/__fixtures__';
import { freshCache, req, resetCache } from '@/features/threats/server/__fixtures__/routes';
import { conflictsFeed, resetConflictBuffer } from '@/features/threats/server/conflicts';
import { gdeltFeed, resetGdeltBatches } from '@/features/threats/server/gdelt';
import { ConflictsResponse } from '@/lib/schemas';
import { GET } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/features/threats/server/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError) };
});
beforeEach(() => {
  freshCache();
  resetGdeltBatches();
  resetConflictBuffer();
  vi.useFakeTimers({ now: Date.parse('2026-09-30T20:10:00Z'), toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
  gdeltFeed.stop();
  conflictsFeed.stop();
  resetCache();
});

const HEALTHY: Route[] = [['lastupdate.txt', FX.gdeltLast], ['20260930200000.export', FX.gdeltZip], ['.export.CSV.zip', 404]];

async function body() {
  const res = await GET(req('/api/conflicts'), undefined);
  expect(res.status).toBe(200);
  const b = await res.json();
  expect(ConflictsResponse.safeParse(b).success).toBe(true);
  return b;
}

/** Healthy pull at 20:10, then GDELT answers 503 from `at` on. */
async function outageAt(at: string, refreshConflicts: boolean) {
  state.routes = HEALTHY;
  const first = await body();
  expect(first.meta.state).toBe('live');
  expect(first.providers.gdelt).toMatchObject({ ok: true });
  expect(first.events.length).toBeGreaterThan(0);
  state.routes = [['lastupdate.txt', 503]];
  vi.setSystemTime(Date.parse(at));
  await gdeltFeed.refresh({ force: true }).catch(() => {});
  if (refreshConflicts) await conflictsFeed.refresh({ force: true }).catch(() => {});
  return body();
}

// Phase 3 round 3 R3-M1: last-good GDELT data is not a live success.
it('conflicts is STALE (and gdelt not ok) after GDELT has been down for 3 h', async () => {
  const b = await outageAt('2026-09-30T23:10:00Z', true);
  expect(b.providers.gdelt.ok).toBe(false);
  expect(b.meta.state).toBe('stale');
  expect(b.providers.zones).toMatchObject({ ok: true });
});

// Phase 3 round 4 R3 MINOR-1: 30 min into an outage the feed was still LIVE.
it('leaves LIVE as soon as GDELT is not live: RECENT by the age of the last good pull', async () => {
  const b = await outageAt('2026-09-30T20:40:00Z', true);
  expect(b.providers.gdelt).toMatchObject({ ok: false, age_s: 1800 });
  expect(b.providers.gdelt.error).toBeDefined();
  expect(b.meta.state).toBe('recent');
  expect(b.meta.lastGoodAt).toBe('2026-09-30T20:40:00.000Z');
  // Last-good events are still served at their own coordinates, with their own (past) times.
  expect(b.events.length).toBeGreaterThan(0);
  expect(b.events.every((e: { observedAt: string }) => Date.parse(e.observedAt) <= Date.parse('2026-09-30T20:10:00Z'))).toBe(true);
});

it('follows GDELT at response time, even before the conflicts snapshot is rebuilt', async () => {
  // Conflicts was built at 20:10 and is still within its TTL at 20:20; GDELT failed at 20:20.
  const b = await outageAt('2026-09-30T20:20:00Z', false);
  expect(b.meta.fetchedAt).toBe('2026-09-30T20:10:00.000Z');
  expect(b.providers.gdelt).toMatchObject({ ok: false, age_s: 600 });
  expect(b.meta.state).toBe('recent');
});

it('goes STALE once the last good GDELT pull is older than 6 × 15 min', async () => {
  const b = await outageAt('2026-09-30T21:45:00Z', true);
  expect(b.providers.gdelt).toMatchObject({ ok: false, age_s: 5700 });
  expect(b.meta.state).toBe('stale');
});
