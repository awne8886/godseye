import { describe, expect, it } from 'vitest';
import { API_CATALOG, upstreamsReceivingUserInput, type ApiEndpoint } from '@/lib/api-catalog';
import { CAPABILITIES, evaluateCapability, type CapabilityId, type CapabilitySpec } from '@/lib/capabilities';
import { cacheControl } from '@/lib/respond';
import {
  GROUP_META,
  anchorId,
  capabilityCondition,
  describeSent,
  exampleHref,
  formatCache,
  formatDuration,
  formatParamType,
  formatRateLimit,
  formatStream,
  groupEndpoints,
  userInputDisclosures,
} from './format';

const CATALOG = API_CATALOG as readonly ApiEndpoint[];
const DEFAULT = { limit: 120, windowS: 60 };
const byPath = (path: string, method: 'GET' | 'POST' = 'GET') => CATALOG.find((e) => e.path === path && e.method === method)!;

describe('formatDuration', () => {
  it('uses the largest whole unit', () => {
    expect(formatDuration(5)).toBe('5 s');
    expect(formatDuration(90)).toBe('90 s');
    expect(formatDuration(60)).toBe('1 min');
    expect(formatDuration(900)).toBe('15 min');
    expect(formatDuration(5400)).toBe('90 min');
    expect(formatDuration(7200)).toBe('2 h');
    expect(formatDuration(86_400)).toBe('1 d');
  });
});

describe('formatCache', () => {
  it('matches cacheControl() for every cached GET', () => {
    for (const e of CATALOG.filter((x) => x.ttlSeconds !== null && !x.stream)) {
      const header = cacheControl(e.ttlSeconds!);
      const [, s, swr] = /s-maxage=(\d+), stale-while-revalidate=(\d+)/.exec(header)!;
      expect(formatCache(e)).toBe(`s-maxage ${formatDuration(Number(s))}, stale-while-revalidate ${formatDuration(Number(swr))}`);
    }
  });
  it('labels streams and POSTs as not cached', () => {
    expect(formatCache(byPath('/api/flights/stream'))).toMatch(/event-stream/);
    expect(formatCache(byPath('/api/ai/chat', 'POST'))).toMatch(/streamed text/);
    expect(formatCache(byPath('/api/ai/overview', 'POST'))).toBe('Not cached (POST)');
    expect(formatCache(byPath('/api/geo'))).toBe('Not cached (no-store)');
  });
});

describe('formatRateLimit', () => {
  it('shows the default limit when the catalogue has none', () => {
    expect(formatRateLimit(byPath('/api/health'), DEFAULT)).toBe('120 requests per 1 min per client IP; default');
  });
  it('shows shared buckets and fail-closed routes', () => {
    const text = formatRateLimit(byPath('/api/ai/overview', 'POST'), DEFAULT);
    expect(text).toContain('5 requests per 1 min');
    expect(text).toContain('shared bucket "ai"');
    expect(text).toContain('fail-closed');
    expect(text).not.toContain('default');
  });
});

describe('exampleHref', () => {
  it('fills path parameters from the catalogue example', () => {
    expect(exampleHref(byPath('/api/airports/{code}'))).toBe('/api/airports/EGLL');
    expect(exampleHref(byPath('/api/flight/{ident}'))).toBe('/api/flight/BA117');
  });
  it('appends query examples and builds from required parameter examples', () => {
    expect(exampleHref(byPath('/api/earthquakes'))).toBe('/api/earthquakes?feed=4.5_day');
    expect(exampleHref(byPath('/api/health'))).toBe('/api/health');
    expect(exampleHref(byPath('/api/cctv/proxy'))).toBe('/api/cctv/proxy?id=tfl-00001.06514');
  });
  it('never links POSTs, streams or endpoints missing an example', () => {
    expect(exampleHref(byPath('/api/ai/overview', 'POST'))).toBeNull();
    expect(exampleHref(byPath('/api/malware/stream'))).toBeNull();
    expect(exampleHref(byPath('/api/cctv/resolve'))).toBeNull();
    expect(exampleHref({ method: 'GET', path: '/api/x/{a}/{b}', params: [{ name: 'a', in: 'path', type: 'string', required: true, description: '', example: '1' }, { name: 'b', in: 'path', type: 'string', required: true, description: '' }] })).toBeNull();
  });
  it('only produces same-origin /api paths', () => {
    for (const e of CATALOG) {
      const href = exampleHref(e);
      if (href) expect(href.startsWith(e.path.split('{')[0]!)).toBe(true);
    }
  });
});

describe('small formatters', () => {
  it('anchors are unique and URL-safe', () => {
    const ids = CATALOG.map(anchorId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });
  it('lists enum values and stream types', () => {
    expect(formatParamType({ type: 'enum', enum: ['a', 'b'] })).toBe('enum (a | b)');
    expect(formatParamType({ type: 'number' })).toBe('number');
    expect(formatStream({ stream: 'sse' })).toMatch(/Server-Sent Events/);
    expect(formatStream({})).toBeNull();
  });
  it('has copy for every group in catalogue order', () => {
    const groups = groupEndpoints(CATALOG);
    expect(groups.reduce((n, [, l]) => n + l.length, 0)).toBe(CATALOG.length);
    for (const [g] of groups) expect(GROUP_META[g].title).toBeTruthy();
  });
});

describe('capabilityCondition', () => {
  const ids = Object.keys(CAPABILITIES) as CapabilityId[];
  /** An environment that satisfies the described condition. */
  const envFor = (spec: CapabilitySpec) => Object.fromEntries([...spec.env.map((k) => [k, 'x']), ...(spec.flag ? [[spec.flag, 'true']] : [])]);

  it('describes every capability in terms of its variables', () => {
    for (const id of ids) {
      const spec: CapabilitySpec = CAPABILITIES[id];
      const text = capabilityCondition(id, spec);
      for (const v of [...spec.env, spec.flag, spec.invertFlag].filter(Boolean) as string[]) expect(text, id).toContain(v);
    }
  });
  it('agrees with evaluateCapability(): on when described, off when the inverted flag is set', () => {
    for (const id of ids) {
      const spec: CapabilitySpec = CAPABILITIES[id];
      expect(evaluateCapability(id, envFor(spec)).enabled, id).toBe(true);
      if (spec.invertFlag) expect(evaluateCapability(id, { ...envFor(spec), [spec.invertFlag]: 'true' }).enabled, id).toBe(false);
    }
  });
  it('mentions the commercial gate on DeepState, which evaluateCapability() applies', () => {
    expect(evaluateCapability('deepstate', { NONCOMMERCIAL: 'true', COMMERCIAL_DEPLOYMENT: 'true' }).enabled).toBe(false);
    expect(capabilityCondition('deepstate', CAPABILITIES.deepstate)).toContain('COMMERCIAL_DEPLOYMENT');
  });
  it('phrases default-on gates as opt-out', () => {
    expect(capabilityCondition('nc_sources', CAPABILITIES.nc_sources)).toBe('On by default; off when COMMERCIAL_DEPLOYMENT=true');
    expect(capabilityCondition('tfl', CAPABILITIES.tfl)).toBe('On when TFL_APP_KEY set');
    expect(capabilityCondition('adsblol_reapi', CAPABILITIES.adsblol_reapi)).toBe('On when ADSBLOL_REAPI=true');
  });
});

describe('userInputDisclosures', () => {
  it('covers exactly upstreamsReceivingUserInput(), each with at least one forwarding endpoint', () => {
    const hosts = upstreamsReceivingUserInput();
    const d = userInputDisclosures(CATALOG, hosts);
    expect(d.map((x) => x.host)).toEqual(hosts);
    for (const x of d) {
      expect(x.uses.length, x.host).toBeGreaterThan(0);
      for (const u of x.uses) expect(u.sent.length).toBeGreaterThan(0);
    }
  });
  it('says what is sent: parameters, the AI key header, and the visitor IP for /api/geo', () => {
    expect(describeSent(byPath('/api/geo'))[0]).toMatch(/IP address/);
    const ai = describeSent(byPath('/api/ai/overview', 'POST'));
    expect(ai.some((s) => s.startsWith('x-ai-key header'))).toBe(true);
    expect(ai.some((s) => s.startsWith('JSON request body'))).toBe(true);
    expect(describeSent(byPath('/api/osint/dns'))[0]).toBe('domain (query): domain');
  });
});
