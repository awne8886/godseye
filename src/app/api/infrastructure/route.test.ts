import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FX, type Route } from '@/features/threats/server/__fixtures__';
import { freshCache, req, resetCache } from '@/features/threats/server/__fixtures__/routes';
import { conflictsFeed, resetConflictBuffer } from '@/features/threats/server/conflicts';
import { gdeltFeed, resetGdeltBatches } from '@/features/threats/server/gdelt';
import { infrastructureFeed, wikidataFeed } from '@/features/threats/server/nuclear';
import { InfrastructureResponse } from '@/lib/schemas';
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
});
afterEach(() => {
  infrastructureFeed.stop();
  wikidataFeed.stop();
  conflictsFeed.stop();
  gdeltFeed.stop();
  resetCache();
});

describe('GET /api/infrastructure', () => {
  it('merges Wikidata plants with the curated list (REFERENCE, observedAt null)', async () => {
    state.routes = [['query.wikidata.org/sparql', FX.wikidata]];
    const res = await GET(req('/api/infrastructure'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(InfrastructureResponse.safeParse(body).success).toBe(true);
    expect(body.items.some((s: { source: string }) => s.source === 'wikidata')).toBe(true);
    expect(body.items.some((s: { source: string }) => s.source === 'curated')).toBe(true);
    expect(body.items.every((s: { observedAt: unknown }) => s.observedAt === null)).toBe(true);
    expect(body.meta).toMatchObject({ feed: 'infrastructure', kind: 'reference', state: 'reference' });
    expect(body.providers.wikidata.ok).toBe(true);
    expect(body.providers.curated).toMatchObject({ ok: true, count: 64 });
  });

  it('still serves the curated sites when Wikidata is down, reporting it', async () => {
    state.routes = [['query.wikidata.org/sparql', 503]];
    const body = await (await GET(req('/api/infrastructure'), undefined)).json();
    expect(body.items).toHaveLength(64);
    expect(body.providers.wikidata.ok).toBe(false);
  });
});
