/**
 * The line under an entity card's kind (round 5 visual-qa m4): a display name taken from the
 * selected record itself — its name, place, title, callsign, country — or, for records that have
 * none (a fire pixel), its own coordinates. Never an internal key such as "ioda-CD-1790822400-bgp",
 * "at:20.1825,80.0024", "caltrans-d1-168" or "M-202609301826--4.26633--5…"; the key itself moves to
 * the card's SOURCES tab. Nothing is invented: a record with no name and no position gets no line.
 * Pure. Owner: design-system-hud.
 */
import { formatLatLng } from '@/components/hud/map-readout';
import type { Selection } from '@/lib/layer-host';
import type { EntityKind } from '@/lib/types';

type Data = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const join = (...parts: (string | null)[]): string | null => parts.filter((p): p is string => p !== null).join(' · ') || null;

/** The record's own position (its lat/lng fields, else the selection's anchor). */
function position(d: Data, s: Selection): string | null {
  const lat = num(d.lat);
  const lng = num(d.lng);
  if (lat !== null && lng !== null) return formatLatLng(lat, lng);
  return s.lngLat ? formatLatLng(s.lngLat[1], s.lngLat[0]) : null;
}

/** A co-located indicator group (NetworkLayer: `colocated` ≥ 2 members at one geolocated point). */
function group(d: Data, s: Selection, noun: string): string | null {
  const n = num(d.colocated);
  return n !== null && n > 1 ? `${n} ${noun} · ${position(d, s) ?? ''}`.replace(/ · $/, '') : null;
}

function hostPort(d: Data): string | null {
  const ip = str(d.ip);
  const port = num(d.port);
  return ip ? (port !== null ? `${ip}:${port}` : ip) : null;
}

/** Per-kind display names, from the fields each kind's record actually carries (src/lib/schemas). */
const BY_KIND: Partial<Record<EntityKind, (d: Data, s: Selection) => string | null>> = {
  // Callsign and registration as broadcast; else the transponder address it transmits ("~" = non-ICAO).
  aircraft: (d, s) => join(str(d.callsign), str(d.registration)) ?? `HEX ${s.id.toUpperCase()}`,
  vessel: (d) => str(d.name) ?? str(d.callsign) ?? (str(d.mmsi) ? `MMSI ${str(d.mmsi)}` : null),
  satellite: (d) => str(d.name) ?? (num(d.noradId) !== null ? `NORAD ${num(d.noradId)}` : null),
  earthquake: (d) => str(d.place),
  fire: (d, s) => position(d, s),
  weather_event: (d) => str(d.title),
  air_quality: (d) => str(d.station),
  gps_jam_cell: (d, s) => position(d, s),
  malware_host: (d, s) => group(d, s, 'hosts') ?? hostPort(d),
  c2_server: (d, s) => group(d, s, 'C2 servers') ?? str(d.hostname) ?? hostPort(d),
  threat_indicator: (d, s) => group(d, s, 'indicators') ?? str(d.ioc),
  outage: (d) => join(str(d.country), str(d.scope)),
  attack_origin: (d) => str(d.country),
  gdelt_event: (d) => str(d.place) ?? join(str(d.actor1), str(d.actor2)),
  // A zone's curated label; an in-zone event's own title.
  conflict_zone: (d) => str(d.label) ?? str(d.title),
  vulnerability: (d) => join(str(d.cveId), str(d.name)),
  // Ports keep the line their module chose (threats/client/selection.ts): the curated port's name,
  // or the upstream WPI / Natural Earth index it is known by.
  port: (_d, s) => str(s.id),
};

/** Fields that name a record across kinds, in order of preference. */
const NAME_FIELDS = ['name', 'title', 'label', 'place', 'station', 'hostname', 'ioc', 'country'] as const;

/** The card's subtitle: the record's display name, its coordinates, or null (no line) — never its internal id. */
export function entityDisplayName(s: Selection): string | null {
  const d: Data = s.data ?? {};
  const own = BY_KIND[s.kind]?.(d, s);
  if (own) return own;
  for (const k of NAME_FIELDS) {
    const v = str(d[k]);
    if (v) return v;
  }
  return position(d, s);
}
