/**
 * Pure formatting helpers shared by the /docs page (server component) and tools/gen-api-docs.ts
 * (docs/API.md). Everything here is derived from the catalogue entry and the capability spec, so
 * the page, the Markdown reference and the running routes cannot drift apart.
 * Type-only imports: tools/gen-api-docs.ts loads this file with Node's type stripping.
 * Owner: pages-docs-privacy-ops.
 */
import type { ApiEndpoint, ApiGroup, ApiParam } from '@/lib/api-catalog';
import type { CapabilitySpec } from '@/lib/capabilities';

export interface GroupMeta {
  title: string;
  blurb: string;
}

/** Display order and copy for every catalogue group. */
export const GROUP_META: Record<ApiGroup, GroupMeta> = {
  system: { title: 'System', blurb: 'Capability flags, per-feed health and entity counts. No upstream calls.' },
  aviation: { title: 'Aviation', blurb: 'Live aircraft from community ADS-B networks, identity lookups and callsign routes.' },
  space: { title: 'Space', blurb: 'Satellite catalogue (OMM), orbit tracks, space weather and the ISS position.' },
  hazards: { title: 'Hazards', blurb: 'Earthquakes, fires, severe weather, air quality, GPS interference, Sentinel scenes and radar frames.' },
  surveillance: { title: 'Surveillance', blurb: 'Public, official camera catalogues (stills-only proxy, no storage) and 24/7 news channel embeds.' },
  maritime: { title: 'Maritime', blurb: 'Ports and chokepoints (REFERENCE) plus AIS vessels when a relay key is configured.' },
  threats: { title: 'Threats', blurb: 'Disaster alerts, GDELT events, conflict zones (REFERENCE), frontlines and country risk.' },
  network: { title: 'Network & cyber', blurb: 'Blocklist INDICATOR points, known exploited vulnerabilities, outages, cables and the SDK stream.' },
  intel: { title: 'Intel', blurb: 'Live Alerts, Region Dossier and Entity Graph expansion.' },
  markets: { title: 'Markets', blurb: 'Quotes, candles, crypto spot prices, the status-bar ticker and supply-chain proximity checks.' },
  ai: { title: 'AI analyst', blurb: 'Language-model summaries when a provider key is configured; otherwise the heuristic ANALYST, labelled as such.' },
  osint: { title: 'OSINT', blurb: 'Passive lookups on infrastructure only (domains, IPs, certificates, CVEs). No people search.' },
  geo: { title: 'Geo', blurb: 'Geocoding, consent-based visitor region, routing and ArcGIS service import.' },
  'flight-paths': { title: 'Flight paths', blurb: 'Airport resolution, planned great-circle routes, live aircraft on a route and specific flights.' },
};

/** Human duration for cache TTLs: 45 s, 15 min, 2 h, 1 d. */
export function formatDuration(seconds: number): string {
  if (seconds < 60 || seconds % 60 !== 0) return `${seconds} s`;
  if (seconds < 3600 || seconds % 3600 !== 0) return `${seconds / 60} min`;
  if (seconds < 86_400 || seconds % 86_400 !== 0) return `${seconds / 3600} h`;
  return `${seconds / 86_400} d`;
}

/** What a client and a CDN may cache (mirrors `cacheControl()` in src/lib/respond.ts). */
export function formatCache(e: Pick<ApiEndpoint, 'ttlSeconds' | 'stream' | 'method'>): string {
  if (e.stream === 'sse') return 'Not cached: text/event-stream';
  if (e.stream === 'text') return 'Not cached: streamed text';
  if (e.ttlSeconds === null) return e.method === 'POST' ? 'Not cached (POST)' : 'Not cached (no-store)';
  return `s-maxage ${formatDuration(e.ttlSeconds)}, stale-while-revalidate ${formatDuration(e.ttlSeconds * 2)}`;
}

export interface RateLimitSpec {
  limit: number;
  windowS: number;
  bucket?: string;
  failClosed?: boolean;
}

/** Per-IP rate limit text; `fallback` is DEFAULT_LIMIT from src/lib/ratelimit.ts. */
export function formatRateLimit(e: Pick<ApiEndpoint, 'rateLimit'>, fallback: RateLimitSpec): string {
  const r = e.rateLimit ?? fallback;
  const parts = [`${r.limit} requests per ${formatDuration(r.windowS)} per client IP`];
  if (!e.rateLimit) parts.push('default');
  if (r.bucket) parts.push(`shared bucket "${r.bucket}"`);
  if (r.failClosed) parts.push('fail-closed: denied while the limiter store is unavailable');
  return parts.join('; ');
}

/** Stream type label, or null for plain JSON/image responses. */
export function formatStream(e: Pick<ApiEndpoint, 'stream'>): string | null {
  if (e.stream === 'sse') return 'Server-Sent Events (text/event-stream)';
  if (e.stream === 'text') return 'Streamed text (chunked)';
  return null;
}

/** Stable, URL-safe anchor for an endpoint, e.g. `get-api-airports-code`. */
export function anchorId(e: Pick<ApiEndpoint, 'method' | 'path'>): string {
  return `${e.method}-${e.path}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Same-origin example URL for a GET endpoint, built only from catalogue examples; null for POST,
 * streams, and endpoints whose required parameters have no documented example.
 */
export function exampleHref(e: Pick<ApiEndpoint, 'method' | 'path' | 'params' | 'example' | 'stream'>): string | null {
  if (e.method !== 'GET' || e.stream) return null;
  const pathParams = e.params.filter((p) => p.in === 'path');
  if (pathParams.length) {
    let out = e.path;
    for (const p of pathParams) {
      const value = pathParams.length === 1 ? (e.example ?? p.example) : p.example;
      if (!value) return null;
      out = out.replace(`{${p.name}}`, encodeURIComponent(value));
    }
    return out;
  }
  if (e.example?.startsWith('?')) return `${e.path}${e.example}`;
  const required = e.params.filter((p) => p.required && p.in === 'query');
  if (!required.length) return e.path;
  if (required.some((p) => !p.example)) return null;
  const qs = required.map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.example!)}`).join('&');
  return `${e.path}?${qs}`;
}

/** Parameter type as shown in tables: `enum (a | b)`. */
export function formatParamType(p: Pick<ApiParam, 'type' | 'enum'>): string {
  return p.type === 'enum' && p.enum?.length ? `enum (${p.enum.join(' | ')})` : p.type;
}

/** Plain-language condition under which a capability is on (mirrors `evaluateCapability`). */
export function capabilityCondition(id: string, spec: CapabilitySpec): string {
  const parts: string[] = [];
  if (spec.env.length) parts.push(`${spec.env.join(' + ')} set`);
  if (spec.flag) parts.push(`${spec.flag}=true`);
  if (spec.invertFlag) parts.push(`${spec.invertFlag} is not "true"`);
  // evaluateCapability() also turns DeepState off on commercial deployments.
  if (id === 'deepstate') parts.push('COMMERCIAL_DEPLOYMENT is not "true"');
  if (!parts.length) return 'Always on';
  const onByDefault = !spec.env.length && !spec.flag;
  return `${onByDefault ? 'On by default; off when ' : 'On when '}${onByDefault ? `${spec.invertFlag}=true` : parts.join(', ')}`;
}

/** Group endpoints in catalogue order (first appearance of each group). */
export function groupEndpoints<E extends Pick<ApiEndpoint, 'group'>>(catalog: readonly E[]): [ApiGroup, E[]][] {
  const out = new Map<ApiGroup, E[]>();
  for (const e of catalog) {
    const list = out.get(e.group) ?? [];
    list.push(e);
    out.set(e.group, list);
  }
  return [...out.entries()];
}

export interface Disclosure {
  host: string;
  uses: { method: ApiEndpoint['method']; path: string; summary: string; sent: string[] }[];
}

/** What each forwarded parameter carries, in plain words, for the Privacy page. */
export function describeSent(e: Pick<ApiEndpoint, 'params' | 'path'>): string[] {
  if (!e.params.length) return ['Your IP address as seen by this server (only after you ask to centre the map on your region)'];
  return e.params.map((p) => {
    if (p.in === 'header') return `${p.name} header: ${p.description}`;
    if (p.in === 'body') return `JSON request body ${p.description}`;
    return `${p.name} (${p.in}): ${p.description}`;
  });
}

/**
 * For every upstream host that receives user input (`upstreamsReceivingUserInput()`), the
 * endpoints that forward it and what they send.
 */
export function userInputDisclosures(catalog: readonly ApiEndpoint[], hosts: readonly string[]): Disclosure[] {
  return hosts.map((host) => ({
    host,
    uses: catalog
      .filter((e) => e.forwardsUserInput && e.upstreams.includes(host))
      .map((e) => ({ method: e.method, path: e.path, summary: e.summary, sent: describeSent(e) })),
  }));
}
