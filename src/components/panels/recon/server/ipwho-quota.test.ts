import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore, setStore } from '@/lib/cache';
import { IPWHO_DAILY_LIMIT, ipwhoProbe, resetIpwhoQuota, takeIpwhoQuota } from './geo';

describe('ipwho.is daily budget (1,000 requests/day)', () => {
  beforeEach(() => {
    resetIpwhoQuota();
    setStore(new MemoryStore());
  });

  it('allows the documented daily limit, refuses the next request and resets at the UTC day boundary', () => {
    const day = Date.parse('2026-10-02T08:00:00Z');
    for (let i = 0; i < IPWHO_DAILY_LIMIT; i++) expect(takeIpwhoQuota(day)).toBe(true);
    expect(takeIpwhoQuota(day + 3_600_000)).toBe(false);
    expect(takeIpwhoQuota(Date.parse('2026-10-03T00:00:01Z'))).toBe(true);
  });

  it('a spent budget reports skipped "budget" and sends no request', async () => {
    const now = Date.now();
    for (let i = 0; i < IPWHO_DAILY_LIMIT; i++) takeIpwhoQuota(now);
    let called = 0;
    const r = await ipwhoProbe('test:spent', 0, async () => {
      called++;
      return 1;
    }, { noCache: true });
    expect(called).toBe(0);
    expect(r.value).toBeNull();
    expect(r.status).toMatchObject({ ok: false, skipped: 'budget' });
  });

  it('a cached answer costs no budget', async () => {
    let called = 0;
    const fn = async () => {
      called++;
      return 7;
    };
    await ipwhoProbe('test:cached', 60_000, fn);
    for (let i = 0; i < IPWHO_DAILY_LIMIT - 1; i++) takeIpwhoQuota();
    const r = await ipwhoProbe('test:cached', 60_000, fn);
    expect(called).toBe(1);
    expect(r.value).toBe(7);
  });
});
