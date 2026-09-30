import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FX, type Route } from '@/features/threats/server/__fixtures__';
import { freshCache, req, resetCache } from '@/features/threats/server/__fixtures__/routes';
import { kevFeed } from '@/features/network/server/kev';
import { KevResponse } from '@/lib/schemas';
import { GET } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/features/threats/server/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError) };
});

beforeEach(freshCache);
afterEach(() => {
  kevFeed.stop();
  resetCache();
});

describe('GET /api/cyber-threats', () => {
  it('serves KEV newest first with NVD CVSS for the enriched CVEs', async () => {
    state.routes = [['known_exploited_vulnerabilities.json', FX.kev], ['services.nvd.nist.gov', FX.nvd]];
    const res = await GET(req('/api/cyber-threats'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(KevResponse.safeParse(body).success).toBe(true);
    expect(body.items).toHaveLength(30);
    expect(body.catalogVersion).toBe('2026.09.30');
    expect(body.enriched).toBeGreaterThan(0);
    expect(body.items[0]).toMatchObject({ cvssScore: 10, cvssSeverity: 'CRITICAL' });
    expect(body.providers.cisa_kev).toMatchObject({ ok: true, count: 30 });
    expect(body.providers.nvd.ok).toBe(true);
    expect(body.meta.observedAt).toBe('2026-09-30T16:59:23.068Z');
  });

  it('answers 503 when CISA is unreachable', async () => {
    state.routes = [['known_exploited_vulnerabilities.json', 503]];
    expect((await GET(req('/api/cyber-threats'), undefined)).status).toBe(503);
  });
});
