/**
 * Round 6: Edmonton's conditions of use are non-commercial only, so the provider runs behind the
 * `nc_sources` capability. On a commercial deployment it is reported as skipped for its licence —
 * never "not configured" (it needs no key) and never silently absent — and nothing is requested.
 */
import { describe, expect, it, vi } from 'vitest';
import { fixtureLoaders } from './__fixtures__/loaders';
import { runRegion } from './catalog';
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
