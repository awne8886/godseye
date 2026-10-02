/**
 * Round 6: Edmonton's conditions of use are non-commercial only, so the provider runs behind the
 * `nc_sources` capability. On a commercial deployment it is reported as skipped for its licence —
 * never "not configured" (it needs no key) and never silently absent — and nothing is requested.
 */
import { describe, expect, it, vi } from 'vitest';
import type { FeedResult } from '@/lib/feeds';
import type { Camera, FeedMeta } from '@/lib/types';
import { fixtureLoaders } from './__fixtures__/loaders';
import { gateRegion, runRegion } from './catalog';
import { providersIn } from './registry';

const signal = () => new AbortController().signal;

describe('licence-gated camera providers', () => {
  it('COMMERCIAL_DEPLOYMENT=true: edmonton is skipped as licence, not fetched; the rest of canada still runs', async () => {
    const loaders = fixtureLoaders();
    const edmonton = vi.fn(loaders.edmonton!);
    const r = await runRegion(providersIn('canada'), null, signal(), { ...loaders, edmonton }, { COMMERCIAL_DEPLOYMENT: 'true' });
    expect(edmonton).not.toHaveBeenCalled();
    expect(r.providers.edmonton!.status).toEqual({ ok: false, count: 0, ms: 0, age_s: null, skipped: 'licence' });
    expect(r.providers.ottawa!.status.ok).toBe(true);
    expect(r.data.some((c) => c.providerId === 'edmonton')).toBe(false);
    expect(r.data.length).toBeGreaterThan(0);
  });

  it('non-commercial (default): edmonton cameras are listed as link-out rows', async () => {
    const r = await runRegion(providersIn('canada'), null, signal(), fixtureLoaders(), {});
    expect(r.providers.edmonton!.status).toMatchObject({ ok: true, count: 6 });
    const edm = r.data.filter((c) => c.providerId === 'edmonton');
    expect(edm).toHaveLength(6);
    expect(edm.every((c) => c.streamType === 'link' && c.stillUrl === null && c.streamUrl === null)).toBe(true);
  });

  it('japan: MLIT runs keyless from its recorded master, as link-out rows only', async () => {
    const r = await runRegion(providersIn('japan'), null, signal(), fixtureLoaders(), {});
    expect(r.providers.mlit!.status).toMatchObject({ ok: true, count: 4 });
    const m = r.data.filter((c) => c.providerId === 'mlit');
    expect(m).toHaveLength(4);
    expect(m.every((c) => c.streamType === 'link' && c.stillUrl === null && c.streamUrl === null)).toBe(true);
  });
});

/**
 * Round 8 (BLOCKING): the gate also runs on every read, because a stored region snapshot outlives a
 * configuration change (src/app/api/cctv/licence-gate.test.ts replays the restart scenario).
 */
describe('gateRegion (read-side gate)', () => {
  const COMMERCIAL = { COMMERCIAL_DEPLOYMENT: 'true' };
  const canada = providersIn('canada');
  const EDMONTON = 'Traffic cameras: City of Edmonton';
  const meta = (attribution: FeedMeta['attribution'], observedAt: string | null = null): FeedMeta => ({
    feed: 'cctv:canada',
    kind: 'live',
    state: 'live',
    fetchedAt: '2026-10-02T08:00:00.000Z',
    observedAt,
    lastGoodAt: '2026-10-02T08:00:00.000Z',
    stale: false,
    ttlSeconds: 1800,
    attribution,
  });
  const allAttribution = canada.map((d) => ({ text: d.row.attribution_string, url: d.row.terms_url, licence: d.row.licence }));

  async function storedNonCommercial(): Promise<FeedResult<Camera[]>> {
    const r = await runRegion(canada, null, signal(), fixtureLoaders(), {});
    const providers = Object.fromEntries(Object.entries(r.providers).map(([k, v]) => [k, v.status]));
    return { data: r.data, meta: meta(allAttribution), providers };
  }

  it('withholds a licence-gated provider stored before the gate closed: rows, status and attribution', async () => {
    const stored = await storedNonCommercial();
    expect(stored.data!.some((c) => c.providerId === 'edmonton')).toBe(true);
    const g = gateRegion(stored, canada, COMMERCIAL);
    expect(g.data!.some((c) => c.providerId === 'edmonton')).toBe(false);
    expect(g.data!.length).toBe(stored.data!.length - 6);
    expect(g.providers.edmonton).toEqual({ ok: false, count: 0, ms: 0, age_s: null, skipped: 'licence' });
    expect(g.providers.ottawa).toEqual(stored.providers.ottawa);
    expect(g.meta.attribution.map((a) => a.text)).not.toContain(EDMONTON);
    expect(g.meta.attribution).toHaveLength(allAttribution.length - 1);
    expect(g.meta.state).toBe('live');
    // Memoised per stored array, so findCamera's id index is built once per snapshot.
    expect(gateRegion(stored, canada, COMMERCIAL).data).toBe(g.data);
  });

  it('passes a result through untouched when nothing is withheld', async () => {
    const stored = await storedNonCommercial();
    expect(gateRegion(stored, canada, {})).toBe(stored);
  });

  it('a snapshot left with no row from an enabled provider is SOURCE OFFLINE, never an empty catalogue', async () => {
    const edm = (await runRegion(canada, null, signal(), { edmonton: fixtureLoaders().edmonton! }, {})).data;
    expect(edm).toHaveLength(6);
    const stored: FeedResult<Camera[]> = { data: edm, meta: meta(allAttribution), providers: {} };
    const g = gateRegion(stored, canada, COMMERCIAL);
    expect(g.data).toBeNull();
    expect(g.meta.state).toBe('offline');
    expect(g.meta.lastGoodAt).toBe(stored.meta.lastGoodAt);
  });

  it('re-derives observedAt from the rows that remain', async () => {
    const stored = await storedNonCommercial();
    const first = stored.data!.find((c) => c.providerId === 'edmonton')!;
    const planted = stored.data!.map((c) => (c === first ? { ...c, observedAt: '2030-01-01T00:00:00.000Z' } : c));
    const g = gateRegion({ ...stored, data: planted, meta: meta(allAttribution, '2030-01-01T00:00:00.000Z') }, canada, COMMERCIAL);
    const newest = g.data!.reduce((m, c) => (c.observedAt && Date.parse(c.observedAt) > m ? Date.parse(c.observedAt) : m), 0);
    expect(g.meta.observedAt).toBe(newest ? new Date(newest).toISOString() : null);
    expect(g.meta.observedAt).not.toBe('2030-01-01T00:00:00.000Z');
  });

  it("runRegion: a removed camera does not come back through a failed provider's last-good rows", async () => {
    const previous = (await runRegion(canada, null, signal(), fixtureLoaders(), {})).data;
    const failing = { ...fixtureLoaders(), edmonton: () => Promise.reject(new Error('HTTP 502')) };
    const r = await runRegion(canada, previous, signal(), failing, { CCTV_REMOVED_IDS: 'edmonton-12' });
    expect(r.providers.edmonton!.status.ok).toBe(false);
    const edm = r.data.filter((c) => c.providerId === 'edmonton');
    expect(edm).toHaveLength(5);
    expect(edm.some((c) => c.id === 'edmonton-12')).toBe(false);
  });
});
