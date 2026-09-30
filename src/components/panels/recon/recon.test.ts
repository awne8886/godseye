import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { planLookups } from './plan';
import { detectChain, iocKind, looksPersonal, parseAsn, parseDomain, parseMac } from './targets';
import { TYPEAHEAD_DEBOUNCE_MS, debounce, normalizeQuery, zoomForPlace } from '../search/debounce';
import { directionsQuery, formatDuration, parseLatLngText } from '../directions/format';
import { zoomForBbox } from './overlay-store';

const ROOT = path.join(process.cwd(), 'src/components/panels');
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return f === '__fixtures__' ? [] : sources(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
}

describe('World Remote has no covert probing (static check)', () => {
  const files = sources(path.join(ROOT, 'remote'));
  it('uses Web Bluetooth only', () => {
    expect(files.length).toBeGreaterThan(0);
    const src = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(src).toContain('requestDevice');
    for (const banned of [/RTCPeerConnection/i, /createDataChannel/, /onicecandidate/i, /\blocalhost\b/i, /127\.0\.0\.1/, /\b0\.0\.0\.0\b/, /192\.168\./, /\bfetch\(/, /XMLHttpRequest/, /new WebSocket/, /new Image\(/, /performance\.now/]) {
      expect(src, String(banned)).not.toMatch(banned);
    }
  });

  it('no RECON-family source uses WebRTC address harvesting', () => {
    const all = ['recon', 'search', 'directions', 'draw', 'arcgis', 'remote'].flatMap((d) => sources(path.join(ROOT, d)));
    for (const f of all) expect(readFileSync(f, 'utf8'), f).not.toMatch(/RTCPeerConnection|onicecandidate/);
  });
});

describe('RECON target planning', () => {
  it('fans a domain out to the passive domain lookups', () => {
    const p = planLookups('Example.com');
    expect(p.ok && p.kind).toBe('domain');
    expect(p.ok && p.lookups.map((l) => l.tool)).toEqual(['dns', 'whois', 'certs', 'headers', 'threats', 'leaks']);
  });

  it('classifies IPs, ASNs, CVEs, MACs, wallets, URLs and hashes', () => {
    const kind = (s: string) => {
      const p = planLookups(s);
      return p.ok ? p.kind : p.reason;
    };
    expect(kind('1.1.1.1')).toBe('ip');
    expect(kind('2606:4700::1111')).toBe('ip');
    expect(kind('AS15169')).toBe('asn');
    expect(kind('cve-2024-3400')).toBe('cve');
    expect(kind('00:1A:2B:3C:4D:5E')).toBe('mac');
    expect(kind('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh')).toBe('wallet');
    expect(kind('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe('wallet');
    expect(kind('https://example.com/login')).toBe('url');
    expect(kind('44d88612fea8a8f36de82e1278abb02f')).toBe('hash');
  });

  it('refuses people-search inputs', () => {
    for (const s of ['alice@example.com', '+1 202 555 0143', '@someone', '(202) 555-0143']) {
      const p = planLookups(s);
      expect(p.ok, s).toBe(false);
      expect(!p.ok && p.reason).toMatch(/not looked up/);
      expect(looksPersonal(s)).toBe(true);
    }
    expect(looksPersonal('001122334455')).toBe(false);
    expect(looksPersonal('8.8.8.8')).toBe(false);
  });

  it('validates targets', () => {
    expect(parseDomain('bücher.de')).toEqual({ ok: true, domain: 'xn--bcher-kva.de' });
    expect(parseDomain('localhost').ok).toBe(false);
    expect(parseDomain('printer.local').ok).toBe(false);
    expect(parseDomain('1.2.3.4').ok).toBe(false);
    expect(parseMac('00-1a-2b')).toBe('001A2B');
    expect(parseAsn('as15169')).toBe(15169);
    expect(parseAsn('AS0')).toBeNull();
    expect(detectChain('Vote111111111111111111111111111111111111111')).toBe('sol');
    expect(iocKind('https://x.example/a')).toBe('url');
  });
});

describe('SEARCH type-ahead', () => {
  afterEach(() => vi.useRealTimers());

  it('debounces keystrokes to one call 300 ms after the last', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn);
    d('k');
    d('ky');
    vi.advanceTimersByTime(TYPEAHEAD_DEBOUNCE_MS - 1);
    d('kyi');
    vi.advanceTimersByTime(TYPEAHEAD_DEBOUNCE_MS - 1);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledExactlyOnceWith('kyi');
    d('x');
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('normalises cache keys and picks zooms', () => {
    expect(normalizeQuery('  New   York ')).toBe('new york');
    expect(zoomForPlace('country', null)).toBe(4.5);
    expect(zoomForPlace('house', null)).toBe(14);
    expect(zoomForPlace('city', [30, 50, 31, 51])).toBeCloseTo(Math.log2(360) + 0.5, 5);
    expect(zoomForBbox([0, 0, 360, 10])).toBe(1.5);
  });
});

describe('ROUTE helpers', () => {
  it('parses lat,lng and builds the directions query', () => {
    expect(parseLatLngText('51.5, -0.12')).toEqual({ lat: 51.5, lng: -0.12 });
    expect(parseLatLngText('London')).toBeNull();
    expect(parseLatLngText('95, 0')).toBeNull();
    const q = new URLSearchParams(directionsQuery({ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, [{ lat: 5, lng: 6 }], 'bike', { tolls: true, highways: false, ferries: true }));
    expect(Object.fromEntries(q)).toEqual({ from: '1.000000,2.000000', to: '3.000000,4.000000', mode: 'bike', via: '5.000000,6.000000', avoid: 'tolls,ferries' });
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(3720)).toBe('1 h 02 min');
  });
});
