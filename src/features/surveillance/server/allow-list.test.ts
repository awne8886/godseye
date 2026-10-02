/**
 * MAJOR-B (round 2): every catalogued still must pass its provider's allow-list, and nothing
 * outside the catalogued directories/files may. The URL lists are what the adapters produced from
 * the full upstream camera lists recorded 2026-10-01 (catalogue-stills fixture); the trimmed
 * per-adapter fixtures are checked too.
 * surveillance.live.test.ts re-checks every row a running /api/cctv serves.
 */
import { describe, expect, it } from 'vitest';
import { matchesAllowList } from '@/lib/ssrf';
import { catalogueStills, FX, json, text } from './__fixtures__';
import { fixtureLoaders } from './__fixtures__/loaders';
import * as A from './adapters';
import { PROVIDERS, providerDef, rulesFor } from './registry';

const allowed = (id: string, url: string) => matchesAllowList(new URL(url), rulesFor(providerDef(id)!, url));

describe('camera still allow-lists cover the catalogue (fixtures 2026-10-01)', () => {
  const stills = catalogueStills();

  it('every catalogued still URL of every keyless frame provider matches its rules', () => {
    const frameProviders = PROVIDERS.filter((p) => !p.capability && p.row.proxy_allowed).map((p) => p.row.id);
    expect(Object.keys(stills).sort()).toEqual([...frameProviders].sort());
    const misses: Record<string, string[]> = {};
    let total = 0;
    for (const [id, urls] of Object.entries(stills)) {
      expect(urls.length, id).toBeGreaterThan(0);
      total += urls.length;
      const miss = urls.filter((u) => !allowed(id, u));
      if (miss.length) misses[id] = miss.slice(0, 3);
    }
    expect(misses).toEqual({});
    expect(total).toBeGreaterThan(14_000);
  });

  it('the round-2 regressions are covered: HK long keys, THB bracketed stakes, WSDOT /traffic/ files, NSW data host', () => {
    expect(allowed('hktd', 'https://tdcctv.data.one.gov.hk/TDSCPRHSK10001.JPG')).toBe(true);
    expect(allowed('thb', 'https://cctv-ss03.thb.gov.tw/T9-109K+286(N)/snapshot')).toBe(true);
    expect(allowed('wsdot', 'https://images.wsdot.wa.gov/traffic/HarveyAirfield.jpg')).toBe(true);
    expect(allowed('nsw', 'https://data.livetraffic.com/cameras/victoriapass_3.jpg')).toBe(true);
    expect(stills.hktd).toContain('https://tdcctv.data.one.gov.hk/TDSCPRHSK10001.JPG');
    expect(stills.thb!.some((u) => u.includes('('))).toBe(true);
  });

  it('nothing outside the catalogued directories or file patterns passes', () => {
    const outside: [string, string][] = [
      ['hktd', 'https://tdcctv.data.one.gov.hk/'],
      ['hktd', 'https://tdcctv.data.one.gov.hk/admin/AID01101.JPG'],
      ['hktd', 'https://tdcctv.data.one.gov.hk/AID01101.png'],
      ['thb', 'https://cctv-ss03.thb.gov.tw/T9-109K+286(N)/config'],
      ['thb', 'https://cctv-ss03.thb.gov.tw/a/b/snapshot'],
      ['thb', 'https://cctv-ss09.thb.gov.tw/T9-1/snapshot'],
      ['thb', 'https://thb.gov.tw/T9-1/snapshot'],
      ['wsdot', 'https://images.wsdot.wa.gov/traffic/icons/cam.jpg'],
      ['wsdot', 'https://images.wsdot.wa.gov/traffic/map.png'],
      ['wsdot', 'https://images.wsdot.wa.gov/secret.jpg'],
      ['nsw', 'https://data.livetraffic.com/datajson/all-feeds-web.json'],
      ['nsw', 'https://data.livetraffic.com/'],
      ['indot', 'https://public.carsprogram.org/cameras/CO/x.png'],
      ['indot', 'https://public.carsprogram.org/'],
      ['vialietuva', 'https://eismoinfo.lt/eismoinfo-backend/camera-info-table'],
      ['vialietuva', 'https://eismoinfo.lt/eismoinfo-backend/image-provider/camera/lastx?id=1'],
      ['vialietuva', 'https://eismoinfo.lt/'],
    ];
    for (const [id, u] of outside) expect(allowed(id, u), `${id} ${u}`).toBe(false);
  });

  it('every still produced from the trimmed adapter fixtures matches too', async () => {
    const loaders = fixtureLoaders();
    // Trafikverket (keyed) has no recorded list fixture.
    for (const p of PROVIDERS.filter((d) => d.row.proxy_allowed && loaders[d.row.id])) {
      const rows = await loaders[p.row.id]!(AbortSignal.timeout(5_000));
      for (const r of rows) if (r.stillUrl) expect(allowed(p.row.id, r.stillUrl), `${p.row.id} ${r.stillUrl}`).toBe(true);
    }
  });
});

describe('new keyless providers (fixtures 2026-10-01)', () => {
  it('INDOT 511 GraphQL: active cameras with a poster frame only (closed icons and inactive skipped)', () => {
    const rows = A.parseIndot(json(FX.indot));
    expect(rows.length).toBe(4);
    expect(rows[0]).toMatchObject({ providerId: 'indot', country: 'US', streamType: 'jpg', observedAt: null });
    expect(rows[0]!.id).toMatch(/^indot-\d+$/);
    expect(rows.every((r) => /^https:\/\/public\.carsprogram\.org\/cameras\/IN\/(INDOT|InDOT)_/.test(r.stillUrl!))).toBe(true);
    expect(rows.every((r) => r.lat > 37 && r.lat < 42 && r.lng > -89 && r.lng < -84)).toBe(true);
    expect(A.parseIndot({ data: { mapFeaturesQuery: { mapFeatures: [{ uri: 'camera/1', active: true, features: [{ geometry: { type: 'Point', coordinates: [-86, 39] } }], views: [{ category: 'VIDEO', url: 'https://evil.example/cameras/IN/INDOT_1_abcd.flv.png' }] }] } } })).toEqual([]);
  });

  it('Via Lietuva: joins points and info on id, drops cameras with no frame for 6 h, never sets observedAt', () => {
    const vkr = json<Parameters<typeof A.parseViaLietuva>[0]>(FX.vialietuvaVkr);
    const info = json<Parameters<typeof A.parseViaLietuva>[1]>(FX.vialietuvaInfo);
    const at = Date.parse('2026-10-01T02:10:00Z');
    const rows = A.parseViaLietuva(vkr, info, at);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ id: 'vialietuva-5', providerId: 'vialietuva', country: 'LT', observedAt: null, stillUrl: 'https://eismoinfo.lt/eismoinfo-backend/image-provider/camera/last?id=5' });
    expect(rows.every((r) => r.lat > 53.8 && r.lat < 56.5)).toBe(true);
    expect(A.parseViaLietuva(vkr, info, at + 7 * 3600_000)).toEqual([]);
    expect(A.parseViaLietuva(vkr, [], at)).toEqual([]);
    expect(text(FX.vialietuvaInfo)).toContain('"date"');
  });
});
