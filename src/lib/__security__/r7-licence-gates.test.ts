/**
 * Round-7 security audit: licence gates hold for every combination the contract names (§0 rule 2),
 * and gated upstreams are never contacted (winds aloft / Open-Meteo, Edmonton cameras).
 */
import { describe, expect, it, vi } from 'vitest';
import { evaluateCapability } from '@/lib/capabilities';
import { resetWinds, windsAloft } from '@/features/flight-paths/server/winds';
import { runRegion } from '@/features/surveillance/server/catalog';
import { PROVIDERS } from '@/features/surveillance/server/registry';

const COMMERCIAL = { COMMERCIAL_DEPLOYMENT: 'true' };

describe('capability licence gates', () => {
  it('OpenSky needs OPENSKY_LICENSED=true even with OAuth credentials', () => {
    const creds = { OPENSKY_CLIENT_ID: 'id', OPENSKY_CLIENT_SECRET: 'secret' };
    expect(evaluateCapability('opensky', creds).enabled).toBe(false);
    expect(evaluateCapability('opensky', { ...creds, OPENSKY_LICENSED: 'yes' }).enabled).toBe(false);
    expect(evaluateCapability('opensky', { ...creds, OPENSKY_LICENSED: 'true' }).enabled).toBe(true);
  });

  it('adsb.fi needs ADSBFI_PERSONAL_USE=true exactly', () => {
    expect(evaluateCapability('adsbfi', {}).enabled).toBe(false);
    expect(evaluateCapability('adsbfi', { ADSBFI_PERSONAL_USE: '1' }).enabled).toBe(false);
    expect(evaluateCapability('adsbfi', { ADSBFI_PERSONAL_USE: 'true' }).enabled).toBe(true);
  });

  it('DeepState needs NONCOMMERCIAL=true and is off on a commercial deployment', () => {
    expect(evaluateCapability('deepstate', {}).enabled).toBe(false);
    expect(evaluateCapability('deepstate', { NONCOMMERCIAL: 'true' }).enabled).toBe(true);
    expect(evaluateCapability('deepstate', { NONCOMMERCIAL: 'true', ...COMMERCIAL }).enabled).toBe(false);
  });

  it('every non-commercial capability is off when COMMERCIAL_DEPLOYMENT=true, even when keyed', () => {
    const keyed = { AEROAPI_KEY: 'k', CLOUDFLARE_API_TOKEN: 't', ...COMMERCIAL };
    for (const id of ['nc_sources', 'openmeteo', 'aeroapi', 'cloudflare'] as const) {
      expect(evaluateCapability(id, keyed).enabled, id).toBe(false);
      expect(evaluateCapability(id, { AEROAPI_KEY: 'k', CLOUDFLARE_API_TOKEN: 't' }).enabled, id).toBe(true);
    }
  });
});

describe('gated upstreams are never contacted', () => {
  it('winds aloft (Open-Meteo) makes no request on a commercial deployment', async () => {
    resetWinds();
    const fetcher = vi.fn(async () => []);
    const r = await windsAloft([{ fraction: 0, point: [0, 51] }], { fetcher, env: COMMERCIAL });
    expect(fetcher).not.toHaveBeenCalled();
    expect(r.winds).toEqual([]);
    expect(r.run.status.ok).toBe(false);
  });

  it('Edmonton cameras (nc_sources) are skipped as licence and never loaded on a commercial deployment', async () => {
    const def = PROVIDERS.find((d) => d.row.id === 'edmonton');
    expect(def?.capability).toBe('nc_sources');
    const load = vi.fn(async () => []);
    const r = await runRegion([def!], null, new AbortController().signal, { edmonton: load }, COMMERCIAL);
    expect(load).not.toHaveBeenCalled();
    expect(r.data).toEqual([]);
    expect(r.providers.edmonton?.status.ok).toBe(false);
  });

  it('Edmonton is link-out only with no proxy rules', () => {
    const def = PROVIDERS.find((d) => d.row.id === 'edmonton')!;
    expect(def.row.proxy_allowed).toBe(false);
    expect(def.row.link_out_only).toBe(true);
    expect(def.rules).toEqual([]);
  });
});
