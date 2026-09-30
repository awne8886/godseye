import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HttpModule from '@/lib/http';
import type * as RateLimitModule from '@/lib/ratelimit';
import { fixture, fixtureText, upstream } from '@/components/panels/recon/__fixtures__/mock-http';
import { error, freshState, get, osint } from '@/components/panels/recon/__fixtures__/route-helpers';

// Fixtures: Tor bulk exit list (first 3 KB) and Feodo Tracker ipblocklist.json, recorded 2026-09-30.
// ThreatFox/URLhaus answered 401 without an Auth-Key on 2026-09-30 → keyed only.
vi.mock('@/lib/http', async (orig) => (await import('@/components/panels/recon/__fixtures__/mock-http')).mockHttp(await orig<typeof HttpModule>()));
vi.mock('@/lib/ratelimit', async (orig) => ({ ...(await orig<typeof RateLimitModule>()), providerBucket: () => ({ take: async () => undefined }) }));

const { GET } = await import('./route');
const call = (qs: string) => get(GET, `http://localhost/api/osint/threats${qs}`);

describe('GET /api/osint/threats', () => {
  beforeEach(() => {
    freshState();
    upstream.on('check.torproject.org', { text: fixtureText('tor-exit-sample.txt') });
    upstream.on('feodotracker.abuse.ch', { json: fixture('feodo-ipblocklist.json') });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('matches a Tor exit exactly and lists keyed providers as not configured', async () => {
    const body = await osint(await call('?ioc=171.25.193.25'), 'threats');
    expect(body.data.matches).toEqual([expect.objectContaining({ source: 'tor', type: 'tor_exit' })]);
    expect(body.providers.tor).toMatchObject({ ok: true, count: 1 });
    expect(body.providers.threatfox).toMatchObject({ skipped: 'not-configured' });
    expect(body.providers.otx).toMatchObject({ skipped: 'not-configured' });
  });

  it('matches Feodo Tracker C2 entries with first/last seen in UTC', async () => {
    const body = await osint(await call('?ioc=162.243.103.246'), 'threats');
    const m = body.data.matches.find((x: { source: string }) => x.source === 'feodotracker');
    expect(m).toMatchObject({ type: 'botnet_c2', malware: 'Emotet', firstSeen: '2022-06-04T21:24:53.000Z' });
  });

  it('says "no matches" honestly without claiming the indicator is safe', async () => {
    const body = await osint(await call('?ioc=8.8.8.8'), 'threats');
    expect(body.findings[0].detail).toMatch(/not proof of safety/);
  });

  it('sends domains and hashes only to intel APIs (never resolves them)', async () => {
    vi.stubEnv('ABUSECH_AUTH_KEY', 'test-key');
    upstream.on('threatfox-api.abuse.ch', { json: { query_status: 'no_result', data: 'Your search did not yield any results' } });
    await osint(await call('?ioc=evil.example.net'), 'threats');
    const tf = upstream.calls.find((c) => c.url.includes('threatfox'))!;
    expect(tf.opts.headers).toMatchObject({ 'Auth-Key': 'test-key' });
    expect(tf.url).not.toContain('test-key');
    expect(upstream.calls.every((c) => !c.url.includes('evil.example.net'))).toBe(true);
  });

  it('refuses emails, private IPs and junk', async () => {
    const p = await error(await call(`?ioc=${encodeURIComponent('person@example.com')}`), 400);
    expect(p.code).toBe('personal_identifier');
    for (const bad of ['10.0.0.1', 'not a thing']) await error(await call(`?ioc=${encodeURIComponent(bad)}`), 400);
  });
});
