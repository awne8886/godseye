/**
 * Test-only upstream table for flight-paths route tests (used from vi.mock('@/lib/http')).
 * Bodies are the recorded probes in this folder (captured 2026-09-30, see each `_captured`) plus
 * aviation's recorded VRS/adsbdb/hexdb fixtures. Open-Meteo answers are shaped like the recorded
 * multi-coordinate probe, one entry per requested coordinate.
 */
import metar from './awc-metar-EGLL-KJFK.json';
import taf from './awc-taf-EGLL-KJFK.json';
import openmeteo from './openmeteo-250hpa-3pt.json';
import photon from './photon-heathrow-aerodrome.json';
import adsblolEmpty from './adsblol-callsign-BAW117-empty.json';
import vrs from '@/features/aviation/__fixtures__/vrs-BAW117.json';
import adsbdbCs from '@/features/aviation/__fixtures__/adsbdb-callsign-BAW117.json';

export interface UpstreamMode {
  /** Hostnames that answer HTTP 502. */
  down: Set<string>;
  /** Exact URL (or URL prefix ending in `*`) → body overrides. */
  override: Map<string, unknown>;
  calls: string[];
}

export const newMode = (): UpstreamMode => ({ down: new Set(), override: new Map(), calls: [] });

function openMeteoFor(url: URL): unknown {
  const lats = (url.searchParams.get('latitude') ?? '').split(',');
  const lngs = (url.searchParams.get('longitude') ?? '').split(',');
  const sample = openmeteo.body[1]!;
  const pts = lats.map((la, i) => ({ ...sample, latitude: Number(la), longitude: Number(lngs[i]), location_id: i }));
  return pts.length === 1 ? pts[0] : pts;
}

/** Body for a URL, or `undefined` for a 404. */
export function upstreamBody(raw: string, mode: UpstreamMode): unknown {
  const url = new URL(raw);
  for (const [k, v] of mode.override) if (k === raw || (k.endsWith('*') && raw.startsWith(k.slice(0, -1)))) return v;
  if (url.hostname === 'aviationweather.gov') {
    const ids = new Set((url.searchParams.get('ids') ?? '').split(','));
    const list = (url.pathname.endsWith('/metar') ? metar.body : taf.body) as { icaoId: string }[];
    return list.filter((x) => ids.has(x.icaoId));
  }
  if (url.hostname === 'api.open-meteo.com') return openMeteoFor(url);
  if (url.hostname === 'photon.komoot.io') return url.searchParams.get('osm_tag') ? photon.body : { type: 'FeatureCollection', features: [] };
  if (raw === 'https://vrs-standing-data.adsb.lol/routes/BA/BAW117.json') return vrs;
  if (raw === 'https://api.adsbdb.com/v0/callsign/BAW117') return adsbdbCs;
  if (url.hostname === 'api.adsb.lol') return adsblolEmpty.body;
  return undefined;
}
