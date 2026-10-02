/**
 * GET /api/arcgis?q= — search public Feature/Map Services on arcgis.com.
 * GET /api/arcgis?url=…/rest/services/…/(Feature|Map)Server[/n][&bbox=w,s,e,n] — import one layer
 * as GeoJSON from an allow-listed ArcGIS host (services.arcgis.com, services[1-9].arcgis.com,
 * services-eu1/-ap1.arcgis.com, *.arcgisonline.com under /arcgis/rest/services/, ARCGIS_ALLOWED_HOSTS);
 * URL rebuilt, allow-list + SSRF guard on every hop, FEATURE_CAP features. A service that answers
 * 4xx (bad item, path or layer; token required) → 422 `service_error` with `upstreamStatus`; only an
 * unreachable/5xx/unusable service is 503 SOURCE OFFLINE; a layer over ARCGIS_MAX_BYTES is 422
 * `layer_too_large`. Owner: panels-recon.
 */
import { z } from 'zod';
import { HttpError } from '@/lib/http';
import { apiError, json, parseQuery, withRoute } from '@/lib/respond';
import { assertPublicUrl } from '@/lib/ssrf';
import type { ProviderStatus } from '@/lib/types';
import { ARCGIS_MAX_BYTES, arcgisPorts, arcgisRules, importLayer, isAllowedService, parseServiceUrl, searchItems, type Bbox, type ServiceRefusal } from '@/components/panels/recon/server/arcgis';
import { offline } from '@/components/panels/recon/server/lookup';

export const dynamic = 'force-dynamic';

const Query = z
  .object({
    q: z.string().trim().min(2).max(120).optional(),
    url: z.string().trim().max(2048).optional(),
    bbox: z
      .string()
      .optional()
      .transform((v, ctx) => {
        if (!v) return null;
        const n = v.split(',').map(Number);
        if (n.length !== 4 || n.some((x) => !Number.isFinite(x)) || Math.abs(n[1]!) > 90 || Math.abs(n[3]!) > 90 || Math.abs(n[0]!) > 180 || Math.abs(n[2]!) > 180) {
          ctx.addIssue({ code: 'custom', message: 'bbox must be west,south,east,north in degrees' });
          return z.NEVER;
        }
        return n as Bbox;
      }),
  })
  .refine((v) => Boolean(v.q) !== Boolean(v.url), 'Pass exactly one of q (search) or url (import)');

/**
 * 422 `service_error`: the ArcGIS host answered but refused this layer URL (unknown service, bad
 * layer id, token required). Not an outage, so no SOURCE OFFLINE and no Retry-After; the upstream
 * status and ArcGIS's own message (text) are passed on so the user can fix the URL.
 */
function serviceRefused(refusal: ServiceRefusal, status: ProviderStatus): Response {
  const said = refusal.message ? ` ("${refusal.message}")` : '';
  const auth = [401, 403, 498, 499].includes(refusal.status);
  const detail = auth
    ? `The ArcGIS service refused the request (HTTP ${refusal.status}${said}). Only public layers can be imported; this server sends no ArcGIS token.`
    : `The ArcGIS service answered HTTP ${refusal.status}${said}. The host is up: check the layer URL (service name, FeatureServer/MapServer and layer number).`;
  return json({ error: 'service_error', detail, upstreamStatus: refusal.status, providers: { service: status } }, { status: 422, ttl: 0 });
}

export const GET = withRoute('/api/arcgis', async (req: Request) => {
  const q = parseQuery(req, Query);
  if (!q.ok) return q.response;
  const now = () => new Date().toISOString();
  if (q.data.q) {
    const r = await searchItems(q.data.q);
    if (!r.status.ok) return offline({ arcgis: r.status }, 'The arcgis.com catalogue search is unavailable.');
    return json({ mode: 'search', items: r.items, features: null, truncated: false, providers: { arcgis: r.status }, timestamp: now() }, { ttl: 600 });
  }
  let ref;
  try {
    ref = parseServiceUrl(q.data.url!);
    if (ref.origin.startsWith('http:')) return apiError(400, 'https_only', 'ArcGIS imports use https only: change the service URL to https://.');
    if (!isAllowedService(ref)) {
      return apiError(403, 'host_not_allowed', `${new URL(ref.origin).host} is not an ArcGIS host this server imports from (ArcGIS Online hosted services on services[1-9].arcgis.com and the regional services-eu1/-ap1 hosts, *.arcgisonline.com, or hosts the operator adds in ARCGIS_ALLOWED_HOSTS).`);
    }
    await assertPublicUrl(new URL(`${ref.origin}/`), undefined, undefined, arcgisPorts(arcgisRules()));
  } catch (e) {
    if (e instanceof HttpError && e.code === 'blocked') return apiError(400, 'blocked_target', e.message);
    throw e;
  }
  const r = await importLayer(ref, q.data.bbox);
  if (r.status.error === 'blocked' || r.status.error === 'redirect') return apiError(400, 'blocked_target', 'The service redirected to a host, address or scheme this server will not fetch.');
  if (!r.fc && r.refusal) return serviceRefused(r.refusal, r.status);
  // The host answered; the layer is just bigger than this server proxies. A retry cannot succeed, so
  // this is 422 (not SOURCE OFFLINE with Retry-After).
  if (!r.fc && r.status.error === 'too_large') {
    return json(
      { error: 'layer_too_large', detail: `The layer exceeds ${(ARCGIS_MAX_BYTES / 1e6).toFixed(1)} MB; import a smaller layer, or call the API with a bbox (west,south,east,north).`, providers: { service: r.status } },
      { status: 422, ttl: 0 },
    );
  }
  if (!r.fc) return offline({ service: r.status }, 'The ArcGIS service did not return usable GeoJSON.');
  return json(
    { mode: 'layer', items: [], features: r.fc, truncated: r.truncated, providers: { service: r.status }, timestamp: now(), source: `${ref.origin}${ref.servicePath}/${ref.layer}` },
    { ttl: 600 },
  );
});
