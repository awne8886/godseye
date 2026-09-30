import { afterAll, describe, expect, it, vi } from 'vitest';
import type * as RateLimitModule from '@/lib/ratelimit';
import type * as HttpModule from '@/lib/http';
import { FlightsResponse } from '@/lib/schemas';
import { MemoryStore, clearL1, setStore } from '@/lib/cache';
import point from '@/features/aviation/__fixtures__/adsblol-point.json';
import mil from '@/features/aviation/__fixtures__/adsblol-mil.json';

// Upstream fixtures recorded from adsb.lol on 2026-09-30 (see `_captured`).
vi.mock('@/lib/ratelimit', async (orig) => {
  const actual = await orig<typeof RateLimitModule>();
  return { ...actual, providerBucket: () => ({ take: async () => undefined }) };
});

vi.mock('@/lib/http', async (orig) => {
  const actual = await orig<typeof HttpModule>();
  return {
    ...actual,
    httpJson: vi.fn(async (url: string) => {
      const body = url.includes('/v2/point/') ? point : url.includes('/v2/') ? mil : null;
      if (!body) throw new actual.HttpError('HTTP 404', 'http', url, 404);
      return { data: structuredClone(body), status: 200, ok: true, notModified: false, headers: {}, body: Buffer.alloc(0), url, etag: null, lastModified: null, ms: 1, attempts: 1 };
    }),
  };
});

const { GET } = await import('./route');
const { diffRows } = await import('@/features/aviation/server/stream');

describe('GET /api/flights/stream', () => {
  afterAll(() => {
    vi.useRealTimers();
  });

  it('sends an SSE snapshot (FlightsResponse with meta + providers) on connect', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(point.now + 5_000);
    clearL1();
    setStore(new MemoryStore());
    const ac = new AbortController();
    const res = await GET(new Request('http://localhost/api/flights/stream', { signal: ac.signal }), undefined);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    const reader = res.body!.getReader();
    let text = '';
    while (!text.includes('event: snapshot') || !text.endsWith('\n\n')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    ac.abort();
    const frame = text.split('\n\n').find((f) => f.includes('event: snapshot'))!;
    const data = JSON.parse(frame.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n'));
    expect(FlightsResponse.safeParse(data).success).toBe(true);
    expect(data.meta.feed).toBe('flights');
    expect(data.providers.adsblol_tiles.ok).toBe(true);
    expect(data.rows.length).toBeGreaterThan(0);
  });

  it('diffs rows by observation time and reports retired ids', () => {
    const seen = new Map<string, number>();
    const row = (id: string, at: number) => [id, null, null, null, 0, 0, 0, 1, 1, null, null, null, null, null, null, null, null, null, at, 0];
    expect(diffRows([row('aaaaaa', 1), row('bbbbbb', 1)], seen).rows).toHaveLength(2);
    const d = diffRows([row('aaaaaa', 2)], seen);
    expect(d.rows.map((r) => r[0])).toEqual(['aaaaaa']);
    expect(d.retired).toEqual(['bbbbbb']);
    expect(diffRows([row('aaaaaa', 2)], seen)).toEqual({ rows: [], retired: [] });
  });
});
