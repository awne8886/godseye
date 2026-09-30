import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore, clearL1, setStore } from '@/lib/cache';
import { defineFeed, resetFeeds } from '@/lib/feeds';
import { HealthResponse, StatsResponse } from '@/lib/schemas';
import { GET as health } from './route';
import { GET as stats } from '../stats/route';

const req = (path: string) => new Request(`http://localhost${path}`, { headers: { 'x-real-ip': '10.9.8.7' } });

beforeEach(() => {
  clearL1();
  resetFeeds();
  setStore(new MemoryStore());
});
afterEach(() => {
  resetFeeds();
  setStore(undefined);
});

describe('/api/health and /api/stats', () => {
  it('reports capabilities without secrets and validates against the contract', async () => {
    const res = await health(req('/api/health'), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(HealthResponse.safeParse(body).success).toBe(true);
    expect(body.capabilities.anthropic).toEqual({ enabled: false, reason: 'ANTHROPIC_API_KEY not set' });
    expect(body.geocoder.maxQueue).toBe(40);
    expect(JSON.stringify(body)).not.toMatch(/sk-|api[_-]?key=/i);
  });

  it('lists feeds with per-upstream status and counts only', async () => {
    const feed = defineFeed<number[]>({
      key: 'demo', ttlMs: 60_000, kind: 'live', attribution: [], count: (d) => d.length,
      run: async () => ({ data: [1, 2, 3], providers: { up: { status: { ok: true, count: 3, ms: 5, age_s: 0 }, okAt: Date.now() } } }),
    });
    const s0 = await (await stats(req('/api/stats'), undefined)).json();
    expect(s0.counts.demo).toBeNull();
    await feed.get();
    const h = await (await health(req('/api/health'), undefined)).json();
    expect(h.feeds.demo).toMatchObject({ state: 'live', count: 3, providers: { up: { ok: true, count: 3 } } });
    const s = await (await stats(req('/api/stats'), undefined)).json();
    expect(StatsResponse.safeParse(s).success).toBe(true);
    expect(s.counts.demo).toBe(3);
    feed.stop();
  });
});
