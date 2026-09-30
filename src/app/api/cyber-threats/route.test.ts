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

  it('?limit=N serves the N newest additions and reports the full total; bad limits are 400', async () => {
    state.routes = [['known_exploited_vulnerabilities.json', FX.kev], ['services.nvd.nist.gov', FX.nvd]];
    const res = await GET(req('/api/cyber-threats?limit=3'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(KevResponse.safeParse(body).success).toBe(true);
    expect(body.items).toHaveLength(3);
    expect(body.total).toBe(30);
    expect(body.items[0].dateAdded >= body.items[2].dateAdded).toBe(true);
    expect((await GET(req('/api/cyber-threats?limit=0'), undefined)).status).toBe(400);
    expect((await GET(req('/api/cyber-threats?limit=abc'), undefined)).status).toBe(400);
  });

  it('still answers after another module registered the shared NVD bucket first (R3-B1)', async () => {
    const { nvdBucket } = await import('@/lib/ratelimit');
    nvdBucket(false); // what /api/chain/daily and /api/osint/cve register
    state.routes = [['known_exploited_vulnerabilities.json', FX.kev], ['services.nvd.nist.gov', FX.nvd]];
    const res = await GET(req('/api/cyber-threats'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.providers.cisa_kev.ok).toBe(true);
    expect(body.providers.nvd).toBeDefined();
  });

  it('answers 503 when CISA is unreachable', async () => {
    state.routes = [['known_exploited_vulnerabilities.json', 503]];
    expect((await GET(req('/api/cyber-threats'), undefined)).status).toBe(503);
  });
});
