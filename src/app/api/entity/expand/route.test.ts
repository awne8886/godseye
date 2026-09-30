import type * as Http from '@/lib/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPTURED_AT, FX, fixtureJson, type Route } from '@/components/panels/intel/__fixtures__';
import { freshCache, req, resetCache } from '@/components/panels/intel/__fixtures__/routes';
import { clearLookups } from '@/components/panels/intel/server/lookup';
import { wikidataLinks } from '@/components/panels/intel/server/entity';
import { EntityGraphResponse } from '@/lib/schemas/intel';
import { GET } from './route';

const state = vi.hoisted(() => ({ routes: [] as Route[] }));
vi.mock('@/lib/http', async (importOriginal) => {
  const orig = await importOriginal<typeof Http>();
  const { httpMock } = await import('@/components/panels/intel/__fixtures__');
  return { ...orig, ...httpMock(() => state.routes, orig.HttpError) };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: CAPTURED_AT });
  freshCache();
  clearLookups();
});
afterEach(() => {
  resetCache();
  vi.useRealTimers();
});

describe('GET /api/entity/expand', () => {
  it('expands a company QID from Wikidata with provenance on every link', async () => {
    const q95 = fixtureJson<{ entities: { Q95: Parameters<typeof wikidataLinks>[0] } }>(FX.wdQ95).entities.Q95;
    const targets = [...new Set(wikidataLinks(q95, 'company').map((l) => l.target))];
    // Label lookups are answered with synthetic labels (test-only) for the real target QIDs.
    const labels = Buffer.from(JSON.stringify({ entities: Object.fromEntries(targets.map((t) => [t, { id: t, labels: { en: { value: `Label ${t}` } } }])) }));
    state.routes = [
      ['props=labels|claims', FX.wdQ95],
      ['props=labels&', labels],
    ];
    const res = await GET(req('/api/entity/expand?type=company&id=Q95'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(EntityGraphResponse.safeParse(body).success).toBe(true);
    expect(body.root).toBe('Q95');
    expect(body.nodes[0]).toMatchObject({ id: 'Q95', type: 'company', source: 'wikidata' });
    expect(body.links.length).toBeGreaterThan(3);
    expect(body.links.every((l: { provenance: string }) => /^wikidata:Q95#P\d+$/.test(l.provenance))).toBe(true);
    expect(body.providers.wikidata).toMatchObject({ ok: true });
    expect(body.providers.opensanctions).toMatchObject({ ok: false, skipped: 'not-configured' });
  });

  it('expands an IP through RIPEstat', async () => {
    state.routes = [
      ['network-info', FX.ripeNetInfo],
      ['as-overview', FX.ripeAsOverview],
    ];
    const body = await (await GET(req('/api/entity/expand?type=ip&id=8.8.8.8'), undefined)).json();
    expect(EntityGraphResponse.safeParse(body).success).toBe(true);
    expect(body.nodes.map((n: { id: string }) => n.id)).toEqual(['8.8.8.8', 'AS15169']);
    expect(body.links[0]).toMatchObject({ source: '8.8.8.8', target: 'AS15169', provenance: 'ripestat:network-info' });
    expect(body.nodes[1].label).toContain('GOOGLE');
  });

  it('refuses free-text people search and answers 503 when upstreams fail', async () => {
    expect((await GET(req('/api/entity/expand?type=person&id=John%20Smith'), undefined)).status).toBe(400);
    state.routes = [];
    const res = await GET(req('/api/entity/expand?type=asn&id=AS64500'), undefined);
    expect(res.status).toBe(503);
    expect((await res.json()).providers.ripestat).toMatchObject({ ok: false });
  });
});
