import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HttpModule from '@/lib/http';
import type * as RateLimitModule from '@/lib/ratelimit';
import { fixture, upstream } from '@/components/panels/recon/__fixtures__/mock-http';
import { error, freshState, get, osint } from '@/components/panels/recon/__fixtures__/route-helpers';

// Fixtures: mempool.space address, Blockscout address + counters, recorded 2026-09-30.
// The public Solana RPC answered 403 "Access forbidden" from the probe host that day.
vi.mock('@/lib/http', async (orig) => (await import('@/components/panels/recon/__fixtures__/mock-http')).mockHttp(await orig<typeof HttpModule>()));
vi.mock('@/lib/ratelimit', async (orig) => ({ ...(await orig<typeof RateLimitModule>()), providerBucket: () => ({ take: async () => undefined }) }));

const { GET } = await import('./route');
const call = (qs: string) => get(GET, `http://localhost/api/osint/crypto${qs}`);
const BTC = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const ETH = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

describe('GET /api/osint/crypto', () => {
  beforeEach(() => freshState());

  it('BTC: balance and activity from mempool.space', async () => {
    upstream.on('mempool.space/api/address', { json: fixture('mempool-address.json') });
    const body = await osint(await call(`?address=${BTC}`), 'crypto');
    expect(body.data).toMatchObject({ chain: 'btc', unit: 'BTC', txCount: 1138 });
    expect(body.data.balance).toBeCloseTo((1679253616 - 1287005839) / 1e8, 8);
    expect(body.findings[0].label).toBe('High activity');
  });

  it('ETH: Blockscout balance, counters and transparent tags', async () => {
    upstream.on('/counters', { json: fixture('blockscout-counters.json') });
    upstream.on('eth.blockscout.com/api/v2/addresses/', { json: fixture('blockscout-address.json') });
    const body = await osint(await call(`?address=${ETH}&chain=eth`), 'crypto');
    expect(body.data).toMatchObject({ chain: 'eth', unit: 'ETH', txCount: 78371 });
    expect(body.providers.blockscout.ok).toBe(true);
  });

  it('SOL: an RPC refusal is reported, not hidden', async () => {
    upstream.on('api.mainnet-beta.solana.com', { status: 403, json: { jsonrpc: '2.0', error: { code: 403, message: 'Access forbidden' }, id: 1 } });
    const body = await error(await call('?address=Vote111111111111111111111111111111111111111'), 503);
    expect(body.providers['solana-rpc']).toMatchObject({ ok: false, error: 'http_403' });
  });

  it('rejects addresses that do not match the chain', async () => {
    for (const qs of [`?address=${BTC}&chain=eth`, '?address=0x123&chain=eth', '?address=not-a-wallet-address-at-all-zzzz']) await error(await call(qs), 400);
  });
});
