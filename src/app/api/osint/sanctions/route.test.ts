import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HttpModule from '@/lib/http';
import type * as RateLimitModule from '@/lib/ratelimit';
import { fixtureText, upstream } from '@/components/panels/recon/__fixtures__/mock-http';
import { error, freshState, get, osint } from '@/components/panels/recon/__fixtures__/route-helpers';
import { identifierHits, parseSdn, sdnCache, searchSdn } from '@/components/panels/recon/server/sanctions';

// Fixture: first rows of OpenSanctions us_ofac_sdn targets.simple.csv (organisations only), 2026-09-30.
vi.mock('@/lib/http', async (orig) => (await import('@/components/panels/recon/__fixtures__/mock-http')).mockHttp(await orig<typeof HttpModule>()));
vi.mock('@/lib/ratelimit', async (orig) => ({ ...(await orig<typeof RateLimitModule>()), providerBucket: () => ({ take: async () => undefined }) }));

const { GET } = await import('./route');
const call = (qs: string) => get(GET, `http://localhost/api/osint/sanctions${qs}`);
const CSV = fixtureText('opensanctions-ofac-sample.csv');

describe('GET /api/osint/sanctions', () => {
  beforeEach(async () => {
    freshState();
    await sdnCache.clear();
    upstream.on('data.opensanctions.org', { text: CSV });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('keeps screening fields only (no addresses, birth dates, phones or emails)', () => {
    const rows = parseSdn(CSV);
    expect(rows.length).toBeGreaterThan(3);
    expect(Object.keys(rows[0]!).sort()).toEqual(['aliases', 'countries', 'firstSeen', 'id', 'identifiers', 'lastChange', 'name', 'sanctions', 'schema']);
  });

  it('matches names and aliases accent/case-insensitively, exact first', async () => {
    const body = await osint(await call('?q=yatai'), 'sanctions');
    expect(body.data.matches.length).toBeGreaterThan(0);
    expect(body.data.matches[0].name).toMatch(/Yatai/);
    expect(body.findings[0].label).toMatch(/SDN match/);
    expect(body.providers.opensanctions).toMatchObject({ ok: true });
    expect(body.data.attribution).toContain('CC BY-NC');
    // The list is downloaded once; the query never goes upstream.
    await call('?q=alabuga');
    expect(upstream.calls).toHaveLength(1);
    expect(upstream.calls[0]!.url).not.toContain('yatai');
  });

  it('reports "no match" as a finding, not silence', async () => {
    const body = await osint(await call('?q=zzzz%20nothing'), 'sanctions');
    expect(body.data.matches).toEqual([]);
    expect(body.findings[0].label).toBe('No SDN match');
  });

  it('finds wallet identifiers exactly and searches tokens', () => {
    const rows = parseSdn(CSV);
    expect(searchSdn(rows, '')).toEqual([]);
    const withId = rows.find((r) => r.identifiers.length)!;
    expect(identifierHits(rows, withId.identifiers[0]!)[0]!.id).toBe(withId.id);
  });

  it('is skipped (CC BY-NC) on commercial deployments', async () => {
    vi.stubEnv('COMMERCIAL_DEPLOYMENT', 'true');
    const body = await error(await call('?q=rosneft'), 503);
    expect(body.providers.opensanctions).toMatchObject({ skipped: 'licence' });
  });
});
