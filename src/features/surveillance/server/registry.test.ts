import { describe, expect, it } from 'vitest';
import { CameraProvider } from '@/lib/schemas/surveillance';
import { matchesAllowList } from '@/lib/ssrf';
import { CCTV_REGIONS } from '../shared';
import { EXCLUDED_SOURCES, isRemoved, linkOutSet, PROVIDERS, providerRow, providersIn } from './registry';

describe('camera provider registry (§5)', () => {
  it('every row is complete: licence, attribution, terms, poll interval, stream type', () => {
    expect(PROVIDERS.length).toBeGreaterThanOrEqual(18);
    for (const p of PROVIDERS) {
      const row = providerRow(p, {});
      expect(CameraProvider.safeParse(row).success, p.row.id).toBe(true);
      expect(row.licence.length, p.row.id).toBeGreaterThan(5);
      expect(row.attribution_string.length, p.row.id).toBeGreaterThan(5);
      expect(row.terms_url, p.row.id).toMatch(/^https:\/\//);
      expect(row.max_poll_interval, p.row.id).toBeGreaterThanOrEqual(30);
      expect(row.list_endpoint, p.row.id).toMatch(/^https:\/\//);
      // A provider that serves frames must have an exact allow-list; link-out ones need none.
      if (row.proxy_allowed) expect(p.rules.length, p.row.id).toBeGreaterThan(0);
      for (const r of p.rules) expect(r.host.startsWith('*.') || !r.host.includes('*'), p.row.id).toBe(true);
    }
    expect(new Set(PROVIDERS.map((p) => p.row.id)).size).toBe(PROVIDERS.length);
  });

  it('TfL is keyed with "Powered by TfL Open Data"; Trafikverket is keyed CC0', () => {
    const tfl = PROVIDERS.find((p) => p.row.id === 'tfl')!;
    expect(tfl.capability).toBe('tfl');
    expect(tfl.row.key_required).toBe(true);
    expect(tfl.row.attribution_string).toMatch(/^Powered by TfL Open Data/);
    const tv = PROVIDERS.find((p) => p.row.id === 'trafikverket')!;
    expect(tv.capability).toBe('trafikverket');
    expect(tv.row.licence).toMatch(/CC0/);
    for (const p of PROVIDERS.filter((x) => !x.capability)) expect(p.row.key_required, p.row.id).toBe(false);
  });

  it('excluded sources appear nowhere (endpoints, frame templates, allow-lists)', () => {
    for (const p of PROVIDERS) {
      const hosts = [p.row.list_endpoint, p.row.frame_url_template ?? '', ...p.rules.map((r) => `https://${r.host}/`)].map((u) => u.toLowerCase());
      for (const ex of EXCLUDED_SOURCES) for (const h of hosts) expect(h.includes(ex.host), `${p.row.id} → ${ex.host}`).toBe(false);
    }
    expect(EXCLUDED_SOURCES.map((e) => e.host)).toEqual(expect.arrayContaining(['opencctv.org', 'images.opentopia.com', 'insecam.org', 'earthcam.com', 'skylinewebcams.com', 'imgproxy.windy.com', 'odo.asfinag.at', 'kollatrafiken.se', 'twipcam.com']));
  });

  it('every region has providers and every provider belongs to a region', () => {
    for (const r of CCTV_REGIONS) expect(providersIn(r).length, r).toBeGreaterThan(0);
    expect(CCTV_REGIONS.flatMap((r) => providersIn(r)).length).toBe(PROVIDERS.length);
  });

  it('allow-list rules are exact: prefix escapes, look-alike paths, ports and http are refused', () => {
    const caltrans = PROVIDERS.find((p) => p.row.id === 'caltrans')!.rules;
    const ok = 'https://cwwp2.dot.ca.gov/data/d7/cctv/image/i110196avenue26offramp/i110196avenue26offramp.jpg';
    expect(matchesAllowList(new URL(ok), caltrans)).toBe(true);
    for (const bad of [
      'https://cwwp2.dot.ca.gov/data/d7/cctv/image/../../../documentation/cctv/cctv.htm',
      'https://cwwp2.dot.ca.gov/data/d7/cctv/image%2f..%2f..%2fsecret',
      'https://cwwp2.dot.ca.gov/data/d7/cctv/imagery/x.jpg',
      'https://cwwp2.dot.ca.gov/data/d13/cctv/image/x.jpg',
      'https://cwwp2.dot.ca.gov:8443/data/d7/cctv/image/x.jpg',
      'http://cwwp2.dot.ca.gov/data/d7/cctv/image/x.jpg',
      'https://cwwp2.dot.ca.gov.evil.example/data/d7/cctv/image/x.jpg',
      'https://user:pw@cwwp2.dot.ca.gov/data/d7/cctv/image/x.jpg',
    ]) {
      expect(matchesAllowList(new URL(bad), caltrans), bad).toBe(false);
    }
    const txdot = PROVIDERS.find((p) => p.row.id === 'txdot')!.rules;
    expect(matchesAllowList(new URL('https://its.txdot.gov/its/DistrictIts/GetCctvSnapshotByIcdId?districtCode=AUS&icdId=X'), txdot)).toBe(true);
    expect(matchesAllowList(new URL('https://its.txdot.gov/its/DistrictIts/GetCctvStatusListByDistrict?districtCode=AUS'), txdot)).toBe(false);
    const thb = PROVIDERS.find((p) => p.row.id === 'thb')!.rules;
    expect(matchesAllowList(new URL('https://cctv-ss03.thb.gov.tw:443/T1-123K+850/snapshot'), thb)).toBe(true);
    expect(matchesAllowList(new URL('https://cctvc.freeway.gov.tw/abs2jpg/bmjpg?camera=1'), thb)).toBe(false);
  });

  it('link-out-only mode by region or country disables frames', () => {
    expect([...linkOutSet({ CCTV_LINK_OUT_ONLY: ' uk, nl ,Europe' })]).toEqual(['uk', 'nl', 'europe']);
    const dgt = PROVIDERS.find((p) => p.row.id === 'dgt')!;
    expect(providerRow(dgt, {})).toMatchObject({ link_out_only: false, proxy_allowed: true });
    expect(providerRow(dgt, { CCTV_LINK_OUT_ONLY: 'europe' })).toMatchObject({ link_out_only: true, proxy_allowed: false });
    expect(providerRow(dgt, { CCTV_LINK_OUT_ONLY: 'ES' })).toMatchObject({ link_out_only: true, proxy_allowed: false });
    expect(providerRow(PROVIDERS.find((p) => p.row.id === 'rws')!, {})).toMatchObject({ link_out_only: true, proxy_allowed: false });
  });

  it('removal requests take cameras out of the catalogue', () => {
    expect(isRemoved('dgt-2', {})).toBe(false);
    expect(isRemoved('dgt-2', { CCTV_REMOVED_IDS: 'x, dgt-2' })).toBe(true);
  });
});
