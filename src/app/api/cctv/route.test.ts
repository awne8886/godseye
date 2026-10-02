import zlib from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { done, fixtureLoaders, fresh, req } from '@/features/surveillance/server/__fixtures__/helpers';
import { CCTV_REGIONS } from '@/features/surveillance/shared';
import { MAX_RESPONSE_BYTES } from '@/lib/respond';
import { CAMERA_FIELDS, CctvResponse } from '@/lib/schemas/surveillance';

const state = vi.hoisted(() => ({ fail: new Set<string>(), spy: null as null | ((id: string) => void) }));
vi.mock('@/features/surveillance/server/loaders', async () => {
  const { fixtureLoaders: fx } = await import('@/features/surveillance/server/__fixtures__/loaders');
  const base = fx();
  const LOADERS = Object.fromEntries(
    Object.entries(base).map(([id, fn]) => [
      id,
      async (s: AbortSignal) => {
        state.spy?.(id);
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

  it('R2-M3: a keyless instance answers a key-only region 200 "not configured" (no 5xx, nothing fetched)', async () => {
    const calls = vi.fn();
    state.fail.clear();
    state.spy = calls;
    const res = await GET(req('/api/cctv?region=uk'), undefined);
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(CctvResponse.safeParse(b).success).toBe(true);
    expect(b.rows).toEqual([]);
    expect(b.regions).toEqual([]);
    expect(b.disabledRegions).toEqual(['uk']);
    expect(b.providers.tfl).toMatchObject({ ok: false, count: 0, skipped: 'not-configured' });
    expect(b.meta.note).toMatch(/Not configured on this instance/);
    expect(calls).not.toHaveBeenCalledWith('tfl');
    state.spy = null;
  });

  it('with TFL_APP_KEY the uk region is fetched and served', async () => {
    vi.stubEnv('TFL_APP_KEY', 'test-key');
    const res = await GET(req('/api/cctv?region=uk'), undefined);
    expect(res.status).toBe(200);
    const { json: b } = await body(res);
    expect(b.regions).toEqual(['uk']);
    expect(b.disabledRegions).toEqual([]);
    expect(b.providers.tfl).toMatchObject({ ok: true });
    expect(b.rows.length).toBeGreaterThan(0);
    vi.unstubAllEnvs();
  });

  it('503 stays reserved for configured providers that failed', async () => {
    vi.stubEnv('TFL_APP_KEY', 'test-key');
    state.fail.add('tfl');
    const res = await GET(req('/api/cctv?region=uk'), undefined);
    expect(res.status).toBe(503);
    expect((await res.json()).providers.tfl).toMatchObject({ ok: false });
    vi.unstubAllEnvs();
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

  it('R2 MINOR-2 (rounds 3–4): providers age_s follows the inventory fetch instead of freezing at the first request', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const t0 = Date.parse('2026-10-01T05:10:54Z');
      vi.setSystemTime(t0);
      const first = await GET(req('/api/cctv?region=us-west'), undefined);
      const a = (await body(first)).json;
      expect(a.providers.caltrans.age_s).toBe(0);
      // Reviewer's repro: 05:17:32 → fetchedAt 05:10:54 but providers {odot: 3, wsdot: 2, caltrans: 0}.
      vi.setSystemTime(Date.parse('2026-10-01T05:17:32Z'));
      const later = await GET(req('/api/cctv?region=us-west', { 'if-none-match': first.headers.get('etag')! }), undefined);
      expect(later.status).toBe(200); // a new minute is a new version, never a 304 with the old ages
      const b = (await body(later)).json;
      expect(b.meta.fetchedAt).toBe(a.meta.fetchedAt);
      const age = (Date.now() - Date.parse(b.meta.fetchedAt)) / 1000;
      for (const [name, p] of Object.entries(b.providers as Record<string, { age_s: number | null }>)) {
        if (p.age_s !== null) expect(p.age_s, name).toBeGreaterThanOrEqual(age - 60);
      }
      expect(b.providers.caltrans.age_s).toBe(398);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cctvVersion changes every minute and with the inventory, not within a minute', async () => {
    const { cctvVersion } = await import('@/features/surveillance/server/cctv-response');
    const s = [{ region: 'us-west', fetchedAt: '2026-10-01T05:10:54.000Z', state: 'live' }];
    const t = Date.parse('2026-10-01T05:17:02Z');
    expect(cctvVersion(s, [], [], '', t)).toBe(cctvVersion(s, [], [], '', t + 50_000));
    expect(cctvVersion(s, [], [], '', t)).not.toBe(cctvVersion(s, [], [], '', t + 60_000));
    expect(cctvVersion(s, [], [], '', t)).not.toBe(cctvVersion([{ ...s[0]!, fetchedAt: '2026-10-01T05:40:54.000Z' }], [], [], '', t));
  });

  it('every region loads from its fixtures', async () => {
    for (const r of CCTV_REGIONS.filter((x) => x !== 'uk')) {
      const res = await GET(req(`/api/cctv?region=${r}`), undefined);
      expect(res.status, r).toBe(200);
    }
    expect(Object.keys(fixtureLoaders()).length).toBeGreaterThanOrEqual(19);
  });
});
