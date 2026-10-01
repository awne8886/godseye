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
  return `Browser revalidates every request (ETag); shared caches s-maxage ${formatDuration(e.ttlSeconds)}, CDN stale-while-revalidate ${formatDuration(e.ttlSeconds * 2)}`;
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
  const envKeys = spec.env.filter((k) => k !== spec.flag);
  if (envKeys.length) parts.push(`${envKeys.join(' + ')} set`);
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
      .filter((e) => e.forwardsUserInput && (e.inputReceivers ?? e.upstreams).includes(host))
      .map((e) => ({ method: e.method, path: e.path, summary: e.summary, sent: describeSent(e) })),
  }));
}

/**
 * True when the endpoint answers with real data only after the operator sets a key or opts in to a
 * licence gate (its capability is off by default). Keyless gates that are on by default
 * (`nc_sources`, `openmeteo`) do not count.
 */
export function requiresOperatorConfig(e: Pick<ApiEndpoint, 'capability'>, caps: Readonly<Record<string, CapabilitySpec>>): boolean {
  if (!e.capability) return false;
  const spec = caps[e.capability];
  return Boolean(spec && (spec.env.length > 0 || spec.flag));
}

/** Page-intro sentence: how many endpoints exist and how many need operator configuration. */
export function keylessSummary(catalog: readonly Pick<ApiEndpoint, 'capability'>[], caps: Readonly<Record<string, CapabilitySpec>>): string {
  const gated = catalog.filter((e) => requiresOperatorConfig(e, caps)).length;
  if (!gated) return `${catalog.length} endpoints on this origin, all usable without an API key.`;
  return `${catalog.length} endpoints on this origin; all but ${gated} work without an API key. Those ${gated} name the capability (an operator key or licence opt-in) that turns them on.`;
}

// ── "Send request" try-it (client island in ./interactive.tsx) ──────────────────────────────────

export interface TryParam {
  name: string;
  in: 'query' | 'path';
  type: ApiParam['type'];
  required: boolean;
  description: string;
  example?: string;
  enum?: readonly string[];
}

/** Serialisable subset of a GET catalogue entry for the try-it console and the ⌘K palette. */
export interface TryEndpoint {
  id: string;
  path: string;
  groupTitle: string;
  summary: string;
  sse: boolean;
  params: TryParam[];
  /** Pre-filled values: the catalogue example (the same one the Example link uses). */
  initial: Record<string, string>;
}

/** Palette/try-it data for a GET endpoint; null for POST (the console only sends GET). */
export function tryEndpoint(e: ApiEndpoint): TryEndpoint | null {
  if (e.method !== 'GET') return null;
  const params: TryParam[] = [];
  for (const p of e.params) {
    if (p.in !== 'query' && p.in !== 'path') continue;
    const tp: TryParam = { name: p.name, in: p.in, type: p.type, required: p.required, description: p.description };
    if (p.example) tp.example = p.example;
    if (p.enum) tp.enum = p.enum;
    params.push(tp);
  }
  const initial: Record<string, string> = {};
  const pathParams = params.filter((p) => p.in === 'path');
  for (const p of pathParams) {
    const v = pathParams.length === 1 ? (e.example ?? p.example) : p.example;
    if (v) initial[p.name] = v;
  }
  if (e.example?.startsWith('?')) {
    for (const [k, v] of new URLSearchParams(e.example.slice(1))) if (params.some((p) => p.name === k)) initial[k] = v;
  } else {
    for (const p of params) if (p.in === 'query' && p.required && p.example) initial[p.name] = p.example;
  }
  return { id: anchorId(e), path: e.path, groupTitle: GROUP_META[e.group].title, summary: e.summary, sse: e.stream === 'sse', params, initial };
}

export class TryInputError extends Error {}

const SAME_ORIGIN_ONLY = 'Only this server’s /api/ endpoints can be called.';

/**
 * Request URL for the try-it console. Same-origin only: the path comes from the catalogue,
 * values are percent-encoded into a path segment or the query string, and the result must stay
 * on `origin` under /api/; anything else throws before a request is made.
 */
export function buildTryUrl(ep: Pick<TryEndpoint, 'path' | 'params'>, values: Readonly<Record<string, string>>, origin: string): URL {
  if (!ep.path.startsWith('/api/')) throw new TryInputError(SAME_ORIGIN_ONLY);
  let pathname = ep.path;
  const query = new URLSearchParams();
  for (const p of ep.params) {
    const v = (values[p.name] ?? '').trim();
    if (!v) {
      if (p.required) throw new TryInputError(`${p.name} is required.`);
      continue;
    }
    if (p.in === 'path') {
      if (v === '.' || v === '..') throw new TryInputError(`${p.name} cannot be "${v}".`);
      pathname = pathname.replace(`{${p.name}}`, encodeURIComponent(v));
    } else {
      query.set(p.name, v);
    }
  }
  const base = new URL(origin);
  const url = new URL(pathname, base.origin);
  const qs = query.toString();
  if (qs) url.search = qs;
  if (url.origin !== base.origin || !url.pathname.startsWith('/api/')) throw new TryInputError(SAME_ORIGIN_ONLY);
  return url;
}

/** Parse Server-Sent Events text into complete events (blank-line separated); the incomplete tail is returned as `rest`. */
export function parseSseChunk(buffer: string): { events: { event: string; data: string }[]; rest: string } {
  const events: { event: string; data: string }[] = [];
  const blocks = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const rest = blocks.pop() ?? '';
  for (const block of blocks) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const i = line.indexOf(':');
      const field = i === -1 ? line : line.slice(0, i);
      const value = i === -1 ? '' : line.slice(i + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length) events.push({ event, data: data.join('\n') });
  }
  return { events, rest };
}

/** Body text for display: pretty JSON when it parses (bodies under 400 kB), cut to `max` characters. */
export function formatBody(text: string, contentType: string | null, max = 20_000): { text: string; truncated: boolean } {
  let out = text;
  if (contentType?.includes('json') && text.length < 400_000) {
    try {
      out = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      out = text;
    }
  }
  return out.length > max ? { text: out.slice(0, max), truncated: true } : { text: out, truncated: false };
}
