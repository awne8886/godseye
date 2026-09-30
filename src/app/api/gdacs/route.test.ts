import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FX, type Route } from '@/features/threats/server/__fixtures__';
import { freshCache, req, resetCache } from '@/features/threats/server/__fixtures__/routes';
import { gdacsFeed } from '@/features/threats/server/gdacs';
import { GdacsResponse } from '@/lib/schemas';
import { GET as ALIAS } from '../gdelt/route';
import { GET } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/features/threats/server/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError) };
});

beforeEach(freshCache);
afterEach(() => {
  gdacsFeed.stop();
  resetCache();
});

describe('GET /api/gdacs (+ alias /api/gdelt)', () => {
  it('serves normalised GDACS incidents with meta + providers', async () => {
    state.routes = [['geteventlist/SEARCH', FX.gdacs]];
    const res = await GET(req('/api/gdacs'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(GdacsResponse.safeParse(body).success).toBe(true);
    expect(body.items).toHaveLength(25);
    expect(body.meta).toMatchObject({ feed: 'gdacs', kind: 'live' });
    expect(body.providers.gdacs).toMatchObject({ ok: true, count: 25 });
    expect(body.items.every((i: { alertLevel: string | null }) => i.alertLevel === null || i.alertLevel === i.alertLevel.toLowerCase())).toBe(true);
  });

  it('the alias serves the same handler and body', async () => {
    state.routes = [['geteventlist/SEARCH', FX.gdacs]];
    expect(ALIAS).toBe(GET);
    const a = await (await GET(req('/api/gdacs'), undefined)).json();
    const b = await (await ALIAS(req('/api/gdelt'), undefined)).json();
    expect(b.items).toEqual(a.items);
  });

  it('answers 503 SOURCE OFFLINE when GDACS fails', async () => {
    state.routes = [['geteventlist/SEARCH', 503]];
    const res = await GET(req('/api/gdacs'), undefined);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('source_offline');
    expect(body.providers.gdacs).toMatchObject({ ok: false, error: 'http_503' });
  });
});
