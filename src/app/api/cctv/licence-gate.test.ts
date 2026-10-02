/**
 * Verification round 8 (BLOCKING): the nc_sources licence gate ran only inside runRegion(), when a
 * region refreshed. The region snapshot outlives a configuration change in the filesystem store
 * (docker-compose keeps it on /data), so after `COMMERCIAL_DEPLOYMENT=true` + restart the City of
 * Edmonton cameras (personal / non-commercial use only) were still served by /api/cctv, resolvable
 * through /api/cctv/resolve, reported `providers.edmonton {ok: true}` and attributed in
 * `meta.attribution` for up to the 30-min inventory TTL. Reproduced here with a real FileStore:
 * run 1 writes the canada snapshot non-commercially, the "restart" drops every in-process cache,
 * run 2 reads the same directory with the gate off. Fixtures: recorded 2026-09-30 / 2026-10-02.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { done, req } from '@/features/surveillance/server/__fixtures__/helpers';
import { resetRegionFeeds } from '@/features/surveillance/server/catalog';
import { resetFrameHealth } from '@/features/surveillance/server/frame-health';
import { clearL1, FileStore, setStore } from '@/lib/cache';
import { getFeed, resetFeeds } from '@/lib/feeds';
import { CAMERA_FIELDS, CctvResponse } from '@/lib/schemas/surveillance';

const calls = vi.hoisted(() => [] as string[]);
vi.mock('@/features/surveillance/server/loaders', async () => {
  const { fixtureLoaders } = await import('@/features/surveillance/server/__fixtures__/loaders');
  const base = fixtureLoaders();
  const LOADERS = Object.fromEntries(
    Object.entries(base).map(([id, fn]) => [
      id,
      (s: AbortSignal) => {
        calls.push(id);
        return fn(s);
      },
    ]),
  );
  return { LOADERS };
});

const { GET: cctv } = await import('./route');
const { GET: resolve } = await import('./resolve/route');
const { GET: providersRoute } = await import('./providers/route');

const EDMONTON = 'Traffic cameras: City of Edmonton';
const PROVIDER = CAMERA_FIELDS.indexOf('providerId');
let dir = '';

async function body(res: Response) {
  const buf = Buffer.from(await res.arrayBuffer());
  const enc = res.headers.get('content-encoding');
  const raw = enc === 'br' ? zlib.brotliDecompressSync(buf) : enc === 'gzip' ? zlib.gunzipSync(buf) : buf;
  return JSON.parse(raw.toString('utf8'));
}

/** A process restart: every in-process cache and feed is gone; only the store directory remains. */
function restart(store: string) {
  resetFeeds();
  resetRegionFeeds();
  resetFrameHealth();
  clearL1();
  setStore(new FileStore(store));
}

const edmontonRows = (b: { rows: unknown[][] }) => b.rows.filter((r) => r[PROVIDER] === 'edmonton');
const attributionTexts = (b: { meta: { attribution: { text: string }[] } }) => b.meta.attribution.map((a) => a.text);

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'godseye-cctv-gate-'));
});
afterEach(() => {
  vi.unstubAllEnvs();
  calls.length = 0;
});
afterAll(() => {
  done();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('nc_sources gate holds for snapshots written under another configuration', () => {
  it('run 1 (non-commercial): the canada snapshot holds the Edmonton link-out cameras', async () => {
    restart(dir);
    const b = await body(await cctv(req('/api/cctv?region=canada'), undefined));
    expect(CctvResponse.safeParse(b).success).toBe(true);
    expect(edmontonRows(b)).toHaveLength(6);
    expect(b.providers.edmonton).toMatchObject({ ok: true, count: 6 });
    expect(attributionTexts(b)).toContain(EDMONTON);
    expect((await resolve(req('/api/cctv/resolve?id=edmonton-12'), undefined)).status).toBe(200);
    expect(calls).toContain('edmonton');
  });

  it('run 2 (COMMERCIAL_DEPLOYMENT=true after a restart, same store): no Edmonton row, status, attribution or id', async () => {
    restart(dir);
    vi.stubEnv('COMMERCIAL_DEPLOYMENT', 'true');
    const res = await cctv(req('/api/cctv?region=canada'), undefined);
    expect(res.status).toBe(200);
    const b = await body(res);
    expect(CctvResponse.safeParse(b).success).toBe(true);
    // The stored snapshot is still fresh, so nothing was refetched: the gate ran on the read.
    expect(calls).toEqual([]);
    expect(edmontonRows(b)).toEqual([]);
    expect(b.rows.length).toBe(b.counts.canada);
    expect(b.rows.some((r: unknown[]) => r[PROVIDER] === 'ottawa')).toBe(true);
    expect(b.providers.edmonton).toEqual({ ok: false, count: 0, ms: 0, age_s: null, skipped: 'licence' });
    expect(b.providers.ottawa).toMatchObject({ ok: true });
    expect(attributionTexts(b)).not.toContain(EDMONTON);
    expect(attributionTexts(b).length).toBeGreaterThan(0);

    const r404 = await resolve(req('/api/cctv/resolve?id=edmonton-12'), undefined);
    expect(r404.status).toBe(404);
    const ottawa = b.rows.find((r: unknown[]) => r[PROVIDER] === 'ottawa')[0] as string;
    expect((await resolve(req(`/api/cctv/resolve?id=${encodeURIComponent(ottawa)}`), undefined)).status).toBe(200);

    // Registry readers (/api/health, /api/stats, region dossier) see the same gated feed.
    const health = getFeed('cctv:canada')!.health();
    expect(health.providers.edmonton).toMatchObject({ ok: false, skipped: 'licence' });
    expect(health.count).toBe(b.rows.length);
    const peek = getFeed('cctv:canada')!.peek() as { data: { providerId: string }[] | null };
    expect(peek.data!.some((c) => c.providerId === 'edmonton')).toBe(false);

    const reg = await (await providersRoute(req('/api/cctv/providers'), undefined)).json();
    expect(reg.providers.edmonton).toMatchObject({ ok: false, skipped: 'licence' });
  });

  it('run 3 (non-commercial again, same store): the gate re-opens without a refetch', async () => {
    restart(dir);
    const b = await body(await cctv(req('/api/cctv?region=canada'), undefined));
    expect(edmontonRows(b)).toHaveLength(6);
    expect(attributionTexts(b)).toContain(EDMONTON);
    expect(calls).toEqual([]);
  });

  it('empty store + commercial: Edmonton is skipped for its licence and not attributed', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'godseye-cctv-gate-empty-'));
    try {
      restart(empty);
      vi.stubEnv('COMMERCIAL_DEPLOYMENT', 'true');
      const b = await body(await cctv(req('/api/cctv?region=canada'), undefined));
      expect(calls).not.toContain('edmonton');
      expect(edmontonRows(b)).toEqual([]);
      expect(b.providers.edmonton).toMatchObject({ ok: false, skipped: 'licence' });
      expect(attributionTexts(b)).not.toContain(EDMONTON);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('a camera removed after the snapshot was written is neither listed nor resolvable', async () => {
    restart(dir);
    vi.stubEnv('CCTV_REMOVED_IDS', 'edmonton-12');
    const b = await body(await cctv(req('/api/cctv?region=canada'), undefined));
    expect(b.rows.some((r: unknown[]) => r[0] === 'edmonton-12')).toBe(false);
    expect(edmontonRows(b)).toHaveLength(5);
    expect((await resolve(req('/api/cctv/resolve?id=edmonton-12'), undefined)).status).toBe(404);
  });
});
