/**
 * Round 5 (R2 MAJOR-1 follow-up), route level: when every operator of a region answers its camera
 * list with `null` (the body TxDOT sends for a camera without a snapshot), with a bare string or
 * with an HTML page, /api/cctv answers SOURCE OFFLINE (503, per-provider `parse`/`empty`) — never a
 * 500 and never an empty catalogue presented as truth.
 */
import zlib from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Http from '@/lib/http';
import { done, fresh, req } from '@/features/surveillance/server/__fixtures__/helpers';
import { ApiError, FeedMeta, Providers } from '@/lib/schemas/common';

const state = vi.hoisted(() => ({ data: null as unknown, text: 'null' }));

vi.mock('@/lib/http', async (orig) => {
  const real = await orig<typeof Http>();
  return {
    ...real,
    httpJson: vi.fn(async (url: string) => ({ status: 200, ok: true, headers: {}, url, data: state.data })),
    httpText: vi.fn(async (url: string) => ({ status: 200, ok: true, headers: {}, url, text: state.text })),
  };
});

const { GET } = await import('./route');

beforeEach(fresh);
afterEach(done);

async function read(res: Response): Promise<Record<string, unknown>> {
  const buf = Buffer.from(await res.arrayBuffer());
  const enc = res.headers.get('content-encoding');
  const raw = enc === 'br' ? zlib.brotliDecompressSync(buf) : enc === 'gzip' ? zlib.gunzipSync(buf) : buf;
  return JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
}

describe('GET /api/cctv with hostile operator lists', () => {
  it.each([
    ['null', null, 'null'],
    ['a string', 'Service Unavailable', '<html><body>Service Unavailable</body></html>'],
    ['a number', 0, '0'],
  ])('every asia operator answers %s → 503 SOURCE OFFLINE with per-provider reasons, never 500', async (_, data, text) => {
    state.data = data;
    state.text = text;
    const res = await GET(req('/api/cctv?region=asia'), undefined);
    expect(res.status).toBe(503);
    const b = await read(res);
    expect(ApiError.safeParse(b).success).toBe(true);
    expect(b.error).toBe('source_offline');
    expect(FeedMeta.safeParse(b.meta).success).toBe(true);
    expect(b.meta).toMatchObject({ state: 'offline' });
    expect(Providers.safeParse(b.providers).success).toBe(true);
    const providers = b.providers as Record<string, { ok: boolean; error?: string }>;
    expect(providers.lta).toMatchObject({ ok: false, error: 'parse' });
    expect(providers.thb).toMatchObject({ ok: false, error: 'parse' });
    expect(providers.hktd).toMatchObject({ ok: false, error: 'empty' });
    expect(b).not.toHaveProperty('rows');
  });
});
