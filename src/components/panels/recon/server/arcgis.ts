/**
 * ArcGIS catalogue search (www.arcgis.com, fixed host) and import of a public
 * …/rest/services/…/(Feature|Map)Server layer as GeoJSON from an ALLOW-LISTED ArcGIS host
 * (`services.arcgis.com`, `services[1-9].arcgis.com`, `*.arcgisonline.com`, plus exact hosts the operator lists in
 * `ARCGIS_ALLOWED_HOSTS`). The user's URL is never proxied as is: it is parsed, checked against the
 * service-URL shape and the allow-list, and REBUILT to exactly
 * `<origin>/…/rest/services/<svc>/(Feature|Map)Server/<n>/query?…&f=geojson`, then fetched with
 * allowListedFetch() (allow-list AND SSRF guard on every hop, no credentials). Features are capped
 * (FEATURE_CAP) and the response says when it was truncated. Owner: panels-recon. Server-only.
 */
import 'server-only';
import { HttpError, httpJson } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import { ALLOWED_PORTS, allowListedFetch, matchesAllowList, type AllowRule } from '@/lib/ssrf';
import type { ArcgisResponse, ProviderStatus } from '@/lib/types';
import { probe } from './lookup';

export const FEATURE_CAP = 1000;
/** Stay under the 4 MB response cap (§4) with room for the envelope. */
export const ARCGIS_MAX_BYTES = 3_500_000;

const SERVICE_RE = /^(\/(?:[^/?#]+\/)*rest\/services\/(?:[^/?#]+\/)*?[^/?#]+\/(FeatureServer|MapServer))(?:\/(\d{1,4}))?(?:\/(?:query)?)?\/?$/i;

export interface ServiceRef {
  origin: string;
  servicePath: string;
  kind: 'FeatureServer' | 'MapServer';
  layer: number;
}

/** Parse a user-supplied service URL. Throws HttpError('blocked') with a reason. */
export function parseServiceUrl(raw: string): ServiceRef {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new HttpError('Not a valid URL', 'blocked', raw);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new HttpError('Only http(s) service URLs are allowed', 'blocked', raw);
  if (u.username || u.password) throw new HttpError('Credentials in URLs are not allowed', 'blocked', raw);
  if (/%2f|%5c|%2e/i.test(u.pathname) || u.pathname.split('/').some((s) => s === '..' || s === '.')) throw new HttpError('Encoded or relative path segments are not allowed', 'blocked', raw);
  const m = u.pathname.match(SERVICE_RE);
  if (!m) throw new HttpError('Expected …/rest/services/<name>/FeatureServer[/n] or …/MapServer[/n]', 'blocked', raw);
  const kind = m[2]!.toLowerCase() === 'featureserver' ? 'FeatureServer' : 'MapServer';
  return { origin: u.origin, servicePath: m[1]!.replace(/(FeatureServer|MapServer)$/i, kind), kind, layer: m[3] ? Number(m[3]) : 0 };
}

/**
 * Built-in ArcGIS hosts. ArcGIS Online hosted services live at
 * `services[1-9].arcgis.com/<orgId>/arcgis/rest/services/…` (the org id varies, so the directory prefix
 * is `/` and the service shape is enforced by SERVICE_RE on the rebuilt URL); Esri's own servers
 * (`services.arcgisonline.com`, `sampleserver6.arcgisonline.com`) serve `/arcgis/rest/services/…`.
 */
export const BUILTIN_ARCGIS_RULES: readonly AllowRule[] = [
  // Explicit hosted-service hosts, not `*.arcgis.com`: utility.arcgis.com/usrsvcs is Esri's proxy to
  // any origin an ArcGIS Online account registers, so a wildcard would reopen the SSRF path.
  // services-eu1 / services-ap1 are the regional hosted-service hosts (both answered 2026-10-01).
  ...['services.arcgis.com', ...Array.from({ length: 9 }, (_, i) => `services${i + 1}.arcgis.com`), 'services-eu1.arcgis.com', 'services-ap1.arcgis.com'].map((host) => ({ host, pathPrefix: '/' })),
  { host: '*.arcgisonline.com', pathPrefix: '/arcgis/rest/services/' },
];

const HOST_ENTRY = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)(?::(\d{2,5}))?$/;

/**
 * Operator additions: `ARCGIS_ALLOWED_HOSTS=gis.example.gov,maps.example.org:6443` — exact hosts
 * (optional port, e.g. ArcGIS Server's 6443), https only, no wildcards. Invalid entries are ignored.
 * A listed port is allowed for that exact host only (see arcgisPorts).
 */
export function arcgisRules(env: Record<string, string | undefined> = process.env): AllowRule[] {
  const extra: AllowRule[] = [];
  for (const raw of (env.ARCGIS_ALLOWED_HOSTS ?? '').split(',')) {
    const m = raw.trim().toLowerCase().match(HOST_ENTRY);
    if (!m) continue;
    extra.push({ host: m[1]!, pathPrefix: '/', ...(m[2] && m[2] !== '443' ? { port: m[2] } : {}) });
  }
  return [...BUILTIN_ARCGIS_RULES, ...extra];
}

/**
 * Ports the SSRF guard accepts for ArcGIS fetches: the usual web ports plus any port an operator rule
 * names. Safe to widen here because matchesAllowList already requires the exact host + port pair.
 */
export function arcgisPorts(rules: readonly AllowRule[]): ReadonlySet<string> {
  return new Set([...ALLOWED_PORTS, ...rules.flatMap((r) => (r.port ? [r.port] : []))]);
}

/** True when the (rebuilt) service URL is on the ArcGIS allow-list. */
export function isAllowedService(ref: ServiceRef, env: Record<string, string | undefined> = process.env): boolean {
  return matchesAllowList(new URL(`${ref.origin}${ref.servicePath}/${ref.layer}/query`), arcgisRules(env));
}

/** Allow-list check for a catalogue item URL (lets the panel say which results can be imported). */
export function isImportableUrl(raw: string, env: Record<string, string | undefined> = process.env): boolean {
  try {
    return isAllowedService(parseServiceUrl(raw), env);
  } catch {
    return false;
  }
}

export type Bbox = [number, number, number, number];

export function queryUrl(ref: ServiceRef, bbox?: Bbox | null): URL {
  const u = new URL(`${ref.origin}${ref.servicePath}/${ref.layer}/query`);
  u.searchParams.set('where', '1=1');
  u.searchParams.set('outFields', '*');
  u.searchParams.set('returnGeometry', 'true');
  u.searchParams.set('outSR', '4326');
  u.searchParams.set('resultRecordCount', String(FEATURE_CAP));
  u.searchParams.set('f', 'geojson');
  if (bbox) {
    u.searchParams.set('geometry', bbox.join(','));
    u.searchParams.set('geometryType', 'esriGeometryEnvelope');
    u.searchParams.set('inSR', '4326');
    u.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  }
  return u;
}

type Primitive = string | number | boolean | null;
const GEOMETRY_TYPES = new Set(['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']);

/** Keep valid features with primitive properties only; cap the count. */
export function sanitizeFeatures(body: unknown): { fc: GeoJSON.FeatureCollection; truncated: boolean } {
  const b = body as { type?: string; features?: unknown[]; exceededTransferLimit?: boolean; properties?: { exceededTransferLimit?: boolean }; error?: { message?: string } };
  if (b?.error) throw new HttpError(`ArcGIS error: ${String(b.error.message ?? 'unknown').slice(0, 200)}`, 'http', '');
  if (b?.type !== 'FeatureCollection' || !Array.isArray(b.features)) throw new HttpError('The service did not return GeoJSON (f=geojson unsupported?)', 'parse', '');
  const features: GeoJSON.Feature[] = [];
  for (const raw of b.features) {
    const f = raw as { geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> | null; id?: unknown };
    if (!f?.geometry?.type || !GEOMETRY_TYPES.has(f.geometry.type) || !Array.isArray(f.geometry.coordinates)) continue;
    const props: Record<string, Primitive> = {};
    for (const [k, v] of Object.entries(f.properties ?? {}).slice(0, 60)) {
      if (v === null || typeof v === 'number' || typeof v === 'boolean') props[k] = v;
      else if (typeof v === 'string') props[k] = v.slice(0, 500);
    }
    features.push({ type: 'Feature', geometry: f.geometry as GeoJSON.Geometry, properties: props, ...(typeof f.id === 'number' || typeof f.id === 'string' ? { id: f.id } : {}) });
    if (features.length >= FEATURE_CAP) break;
  }
  const truncated = features.length >= FEATURE_CAP || b.exceededTransferLimit === true || b.properties?.exceededTransferLimit === true;
  return { fc: { type: 'FeatureCollection', features }, truncated };
}

export async function importLayer(ref: ServiceRef, bbox?: Bbox | null): Promise<{ fc: GeoJSON.FeatureCollection | null; truncated: boolean; status: ProviderStatus }> {
  const url = queryUrl(ref, bbox);
  const p = await probe(`arcgis:layer:${url.toString()}`, 10 * 60_000, async () => {
    const rules = arcgisRules();
    const res = await allowListedFetch(url, rules, { ports: arcgisPorts(rules), maxBytes: ARCGIS_MAX_BYTES, timeoutMs: 10_000, deadlineMs: 20_000, headers: { accept: 'application/geo+json, application/json' } });
    if (!res.ok) throw new HttpError(`HTTP ${res.status}`, 'http', url.origin, res.status);
    let body: unknown;
    try {
      body = JSON.parse(res.body.toString('utf8'));
    } catch {
      throw new HttpError('Invalid JSON from the service', 'parse', url.origin);
    }
    return sanitizeFeatures(body);
  }, { count: (r) => r.fc.features.length, allowEmpty: true });
  return { fc: p.value?.fc ?? null, truncated: p.value?.truncated ?? false, status: p.status };
}

interface ArcgisItem {
  id: string;
  title?: string;
  owner?: string;
  url?: string | null;
  snippet?: string | null;
  type?: string;
  extent?: [[number, number], [number, number]] | [];
}

const inRange = (e: number[]) => e.length === 4 && e[0]! >= -180 && e[2]! <= 180 && e[1]! >= -90 && e[3]! <= 90;

export async function searchItems(q: string): Promise<{ items: ArcgisResponse['items']; status: ProviderStatus }> {
  const p = await probe(`arcgis:search:${q.toLowerCase()}`, 10 * 60_000, async () => {
    const u = new URL('https://www.arcgis.com/sharing/rest/search');
    u.searchParams.set('q', `(${q.slice(0, 120)}) AND (type:"Feature Service" OR type:"Map Service") AND access:public`);
    u.searchParams.set('f', 'json');
    u.searchParams.set('num', '20');
    u.searchParams.set('sortField', 'numviews');
    u.searchParams.set('sortOrder', 'desc');
    const { data } = await httpJson<{ results?: ArcgisItem[]; error?: { message?: string } }>(u, { timeoutMs: 10_000, retries: 1, limiter: providerBucket('www.arcgis.com', 2, 2) });
    if (!data || data.error || !Array.isArray(data.results)) throw new HttpError('ArcGIS search failed', 'http', u.origin);
    return data.results.flatMap((r) => {
      if (!r.url || !/^https?:\/\//.test(r.url)) return [];
      const e = r.extent?.length === 2 ? [r.extent[0]![0], r.extent[0]![1], r.extent[1]![0], r.extent[1]![1]] : [];
      return [{ id: r.id, title: r.title ?? r.id, owner: r.owner ?? null, url: r.url, snippet: r.snippet ?? null, extent: inRange(e) ? (e as Bbox) : null, importable: isImportableUrl(r.url) }];
    });
  }, { count: (l) => l.length, allowEmpty: true });
  return { items: p.value ?? [], status: p.status };
}
