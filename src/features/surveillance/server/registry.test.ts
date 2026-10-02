import { describe, expect, it } from 'vitest';
import { CameraProvider } from '@/lib/schemas/surveillance';
import { matchesAllowList } from '@/lib/ssrf';
import { CCTV_REGIONS, KEYED_REGIONS, requestableRegions } from '../shared';
import { EXCLUDED_SOURCES, hasFrameRules, isRemoved, linkOutSet, NOT_WIRED_SOURCES, PROVIDERS, providerRow, providersIn, regionDisabled, rulesFor, skipReasonOf } from './registry';

const def = (id: string) => PROVIDERS.find((p) => p.row.id === id)!;
const allowed = (id: string, url: string) => matchesAllowList(new URL(url), rulesFor(def(id), url));

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
      if (row.proxy_allowed) expect(hasFrameRules(p), p.row.id).toBe(true);
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
    expect(allowed('thb', 'https://cctv-ss03.thb.gov.tw:443/T1-123K+850/snapshot')).toBe(true);
    expect(allowed('thb', 'https://cctvc.freeway.gov.tw/abs2jpg/bmjpg?camera=1')).toBe(false);
    expect(allowed('thb', 'https://cctv-ss03.thb.gov.tw/admin/config')).toBe(false);
    expect(allowed('thb', 'https://cctv-ss09.thb.gov.tw/T1-123K+850/snapshot')).toBe(false);
  });

  it('SEC-m5: no rule is a host-root prefix; every image directory was probed (2026-09-30)', () => {
    for (const p of PROVIDERS) for (const r of p.rules) expect(r.pathPrefix.length > 1 && r.pathPrefix !== '/', `${p.row.id} ${r.host}${r.pathPrefix}`).toBe(true);
    // Real still/playlist URLs from the probes pass …
    for (const [id, url] of [
      ['caltrans', 'https://wzmedia.dot.ca.gov/D7/CCTV-196.stream/playlist.m3u8'],
      ['wsdot', 'https://images.wsdot.wa.gov/nw/525vc00694.jpg'],
      ['wsdot', 'https://images.wsdot.wa.gov/ORFlow/005vc12750.jpg'],
      ['wsdot', 'https://images.wsdot.wa.gov/wsf/Keystone/terminal/keystone.jpg'],
      ['mdot', 'https://micamerasimages.net/thumbs/semtoc_cam_253.flv.jpg?item=1'],
      ['mdot', 'https://micamerasimages.net/image-000705102-00-04.jpg?bucket=ftp'],
      ['digitraffic', 'https://weathercam.digitraffic.fi/C0150200.jpg'],
      ['hktd', 'https://tdcctv.data.one.gov.hk/AID01101.JPG'],
    ] as const) expect(allowed(id, url), url).toBe(true);
    // … paths outside the image directories are refused.
    for (const [id, url] of [
      ['caltrans', 'https://wzmedia.dot.ca.gov/admin/index.html'],
      ['caltrans', 'https://wzmedia.dot.ca.gov/D13/x.stream/playlist.m3u8'],
      ['wsdot', 'https://images.wsdot.wa.gov/traffic/camera.gif'],
      ['wsdot', 'https://images.wsdot.wa.gov/private/x.jpg'],
      ['mdot', 'https://micamerasimages.net/admin.php'],
      ['mdot', 'https://micamerasimages.net/thumbs/../secret.jpg'],
      ['digitraffic', 'https://weathercam.digitraffic.fi/api/v1/secret'],
      ['digitraffic', 'https://weathercam.digitraffic.fi/C0150200.jpg/../x'],
      ['hktd', 'https://tdcctv.data.one.gov.hk/index.html'],
    ] as const) expect(allowed(id, url), url).toBe(false);
  });

  it('MDOT: a thumbnail allows exactly its own full-frame redirect target, nothing else at the root', () => {
    const thumb = 'https://micamerasimages.net/thumbs/semtoc_cam_253.flv.jpg?item=1';
    const rules = rulesFor(def('mdot'), thumb);
    expect(matchesAllowList(new URL('https://micamerasimages.net/semtoc_cam_253.jpg?item=1'), rules)).toBe(true);
    expect(matchesAllowList(new URL('https://micamerasimages.net/semtoc_cam_254.jpg'), rules)).toBe(false);
    expect(matchesAllowList(new URL('https://micamerasimages.net/index.html'), rules)).toBe(false);
    // A catalogue URL that does not look like a camera file earns no root rule.
    expect(rulesFor(def('mdot'), 'https://micamerasimages.net/thumbs/../../etc.jpg')).toEqual(def('mdot').rules);
    expect(rulesFor(def('digitraffic'), 'https://weathercam.digitraffic.fi/robots.txt')).toEqual([]);
  });

  it('keyed-only regions match the client list (KEYED_REGIONS) and are disabled without keys', () => {
    const keyless = () => false;
    const disabled = CCTV_REGIONS.filter((r) => regionDisabled(r, keyless));
    expect(disabled).toEqual(Object.keys(KEYED_REGIONS));
    for (const r of disabled) expect(KEYED_REGIONS[r]!.map((k) => k.capability).sort()).toEqual([...new Set(providersIn(r).map((p) => p.capability))].sort());
    expect(CCTV_REGIONS.filter((r) => regionDisabled(r, () => true))).toEqual([]);
    expect(requestableRegions(undefined)).toEqual({ active: CCTV_REGIONS.filter((r) => r !== 'uk'), needsKey: ['uk'] });
    expect(requestableRegions({ tfl: { enabled: true } }).needsKey).toEqual([]);
  });

  it('link-out-only mode by region or country disables frames', () => {
    expect([...linkOutSet({ CCTV_LINK_OUT_ONLY: ' uk, nl ,Europe' })]).toEqual(['uk', 'nl', 'europe']);
    const dgt = PROVIDERS.find((p) => p.row.id === 'dgt')!;
    expect(providerRow(dgt, {})).toMatchObject({ link_out_only: false, proxy_allowed: true });
    expect(providerRow(dgt, { CCTV_LINK_OUT_ONLY: 'europe' })).toMatchObject({ link_out_only: true, proxy_allowed: false });
    expect(providerRow(dgt, { CCTV_LINK_OUT_ONLY: 'ES' })).toMatchObject({ link_out_only: true, proxy_allowed: false });
    expect(providerRow(PROVIDERS.find((p) => p.row.id === 'rws')!, {})).toMatchObject({ link_out_only: true, proxy_allowed: false });
  });

  it('round 6: Windy is disclosed as not wired (keyed API only); Edmonton and MLIT are wired, not listed as missing', () => {
    const windy = NOT_WIRED_SOURCES.find((s) => s.id === 'windy');
    expect(windy).toMatchObject({ operator: 'Windy.com Webcams', region: 'Global', country: '—' });
    expect(windy!.reason).toMatch(/WINDY_WEBCAMS_KEY/);
    expect(windy!.probedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(NOT_WIRED_SOURCES.map((s) => s.id).sort()).toEqual(['ibi511', 'windy']);
    for (const s of NOT_WIRED_SOURCES) expect(PROVIDERS.some((p) => p.row.id === s.id), s.id).toBe(false);
  });

  it('Edmonton: non-commercial licence gate (nc_sources), link out only, nothing proxied or embedded', () => {
    const edm = def('edmonton');
    expect(edm.region).toBe('canada');
    expect(edm.capability).toBe('nc_sources');
    expect(skipReasonOf(edm)).toBe('licence');
    expect(skipReasonOf(def('tfl'))).toBe('not-configured');
    expect(providerRow(edm, {})).toMatchObject({ link_out_only: true, proxy_allowed: false, key_required: false, stream_type: 'link', frame_url_template: null, terms_url: 'https://www.edmonton.ca/conditionsofuse' });
    expect(edm.rules).toEqual([]);
    expect(hasFrameRules(edm)).toBe(false);
    expect(edm.row.licence).toMatch(/non-commercial/);
    // The canada region still runs keyless (Ottawa, Toronto, DriveBC…) with the gate off.
    expect(regionDisabled('canada', () => false)).toBe(false);
  });

  it('MLIT: link out only (no reuse terms; prefecture-owned frames), nothing proxied, embedded or in the CSP', () => {
    const m = def('mlit');
    expect(m.region).toBe('japan');
    expect(m.capability).toBeUndefined();
    expect(providerRow(m, {})).toMatchObject({ link_out_only: true, proxy_allowed: false, stream_type: 'link', frame_url_template: null, key_required: false });
    expect(m.rules).toEqual([]);
    expect(m.fileRules).toBeUndefined();
    expect(hasFrameRules(m)).toBe(false);
    expect(m.row.licence).toMatch(/prefecture-owned/);
    for (const u of ['https://cam.river.go.jp/cam/now/303329013.jpg', 'https://www.river.go.jp/kawabou/pc/tm?itmkndCd=200&scamId=303329013'])
      expect(allowed('mlit', u), u).toBe(false);
  });

  it('removal requests take cameras out of the catalogue', () => {
    expect(isRemoved('dgt-2', {})).toBe(false);
    expect(isRemoved('dgt-2', { CCTV_REMOVED_IDS: 'x, dgt-2' })).toBe(true);
  });
});
