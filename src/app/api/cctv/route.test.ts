import zlib from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { done, fixtureLoaders, fresh, req } from '@/features/surveillance/server/__fixtures__/helpers';
import { CCTV_REGIONS } from '@/features/surveillance/shared';
import { MAX_RESPONSE_BYTES } from '@/lib/respond';
import { CAMERA_FIELDS, CctvResponse } from '@/lib/schemas/surveillance';

const state = vi.hoisted(() => ({ fail: new Set<string>() }));
vi.mock('@/features/surveillance/server/loaders', async () => {
  const { fixtureLoaders: fx } = await import('@/features/surveillance/server/__fixtures__/loaders');
  const base = fx();
  const LOADERS = Object.fromEntries(
    Object.entries(base).map(([id, fn]) => [
      id,
      async (s: AbortSignal) => {
        if (state.fail.has(id) || state.fail.has('*')) throw Object.assign(new Error('HTTP 503'), { name: 'HttpError', code: 'http', status: 503 });
        return fn(s);
      },
    ]),
  );
  return { LOADERS, settledRows: vi.fn() };
});

const { GET } = await import('./route');

beforeEach(() => {
  fresh();
  state.fail.clear();
});
afterEach(done);

async function body(res: Response) {
  const buf = Buffer.from(await res.arrayBuffer());
  const enc = res.headers.get('content-encoding');
  const raw = enc === 'br' ? zlib.brotliDecompressSync(buf) : enc === 'gzip' ? zlib.gunzipSync(buf) : buf;
  return { json: JSON.parse(raw.toString('utf8')), bytes: raw.length };
}

describe('GET /api/cctv', () => {
  it('serves one region as columnar CAMERA_FIELDS with meta, providers, counts and an ETag', async () => {
    const res = await GET(req('/api/cctv?region=us-west', { 'accept-encoding': 'gzip' }), undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBe('gzip');
    const { json: b } = await body(res);
    expect(CctvResponse.safeParse(b).success).toBe(true);
    expect(b.fields).toEqual([...CAMERA_FIELDS]);
    expect(b.regions).toEqual(['us-west']);
    expect(b.pendingRegions).toEqual([]);
    expect(b.counts['us-west']).toBe(b.rows.length);
    expect(b.meta).toMatchObject({ feed: 'cctv', kind: 'live', state: 'live' });
    expect(b.meta.attribution.map((a: { text: string }) => a.text)).toContain('Camera images and video: Caltrans CWWP2');
    expect(Object.keys(b.providers).sort()).toEqual(['caltrans', 'odot', 'wsdot']);
    expect(b.providers.caltrans).toMatchObject({ ok: true, count: 3 });
    const etag = res.headers.get('etag')!;
    expect(etag).toMatch(/^W\//);
    const again = await GET(req('/api/cctv?region=us-west', { 'if-none-match': etag }), undefined);
    expect(again.status).toBe(304);
  });

  it('defaults to one region and stays under the 4 MB cap', async () => {
    const res = await GET(req('/api/cctv'), undefined);
    expect(res.status).toBe(200);
    const { json: b, bytes } = await body(res);
    expect(b.regions).toEqual(['us-west']);
    expect(bytes).toBeLessThan(MAX_RESPONSE_BYTES);
  });

  it('projects the largest region (probed counts) well under 4 MB per response', async () => {
    // Largest live inventory seen 2026-09-30: us-west = Caltrans 2,936 + WSDOT 1,706 + ODOT 1,160.
    const { json: b, bytes } = await body(await GET(req('/api/cctv?region=us-west'), undefined));
    const perRow = bytes / b.rows.length;
    expect(perRow * 5802 * 1.5).toBeLessThan(MAX_RESPONSE_BYTES);
  });

  it('keyed providers report skipped (never silently absent)', async () => {
    const { json: b } = await body(await GET(req('/api/cctv?region=uk,nordics'), undefined));
    expect(b.providers.tfl).toMatchObject({ ok: false, skipped: 'not-configured' });
    expect(b.providers.trafikverket).toMatchObject({ ok: false, skipped: 'not-configured' });
    expect(b.regions).toEqual(['nordics']);
    expect(b.rows.every((r: unknown[]) => r[CAMERA_FIELDS.indexOf('providerId')] !== 'tfl')).toBe(true);
  });

  it('selects regions by lat/lng', async () => {
    const { json: b } = await body(await GET(req('/api/cctv?lat=22.3&lng=114.2'), undefined));
    expect(b.regions).toEqual(['asia']);
    expect(b.rows.some((r: unknown[]) => r[CAMERA_FIELDS.indexOf('providerId')] === 'hktd')).toBe(true);
  });

  it('link-out-only providers publish no frame or stream URLs', async () => {
    const { json: b } = await body(await GET(req('/api/cctv?region=europe'), undefined));
    const rws = b.rows.filter((r: unknown[]) => r[CAMERA_FIELDS.indexOf('providerId')] === 'rws');
    expect(rws.length).toBeGreaterThan(0);
    for (const r of rws) {
      expect(r[CAMERA_FIELDS.indexOf('streamType')]).toBe('link');
      expect(r[CAMERA_FIELDS.indexOf('stillUrl')]).toBeNull();
    }
  });

  it('keeps serving the other providers when one fails, and reports it', async () => {
    state.fail.add('wsdot');
    const { json: b } = await body(await GET(req('/api/cctv?region=us-west'), undefined));
    expect(b.providers.wsdot).toMatchObject({ ok: false, count: 0 });
    expect(b.providers.caltrans.ok).toBe(true);
  });

  it('answers 503 SOURCE OFFLINE when every provider fails (never an empty list)', async () => {
    state.fail.add('*');
    const res = await GET(req('/api/cctv?region=asia'), undefined);
    expect(res.status).toBe(503);
    const b = await res.json();
    expect(b.error).toBe('source_offline');
    expect(b.meta.state).toBe('offline');
    expect(b.providers.hktd).toMatchObject({ ok: false });
  });

  it('rejects unknown regions and half coordinates', async () => {
    expect((await GET(req('/api/cctv?region=mars'), undefined)).status).toBe(400);
    expect((await GET(req('/api/cctv?lat=10'), undefined)).status).toBe(400);
    expect((await GET(req('/api/cctv?region=US;DROP'), undefined)).status).toBe(400);
  });

  it('every region loads from its fixtures', async () => {
    for (const r of CCTV_REGIONS.filter((x) => x !== 'uk')) {
      const res = await GET(req(`/api/cctv?region=${r}`), undefined);
      expect(res.status, r).toBe(200);
    }
    expect(Object.keys(fixtureLoaders()).length).toBeGreaterThanOrEqual(19);
  });
});
