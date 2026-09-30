/**
 * Maritime: ports + chokepoints (REFERENCE, bundled) and AIS vessels (LIVE, AISStream relay when
 * AIS_API_KEY is set). Owner: layers-threats-network. Server-only.
 *
 * Ports (public/data/ports.json, prepared 2026-09-30): NGA World Port Index Pub 150 (harbour size
 * Large/Medium, 550 of 3 807; public domain), Natural Earth 10m ports (scalerank ≤ 6, 522; public
 * domain) and OSIRIS's curated majors (52, MIT; TEU/bpd/fleet text is reference, not live).
 * Duplicates within 5 km collapse to the most specific record (curated > WPI > Natural Earth).
 *
 * AISStream (probed 2026-09-30: HTTP HEAD on the WebSocket URL → 405, i.e. WebSocket-only; keyed):
 * one server-side connection, subscription sent within 3 s ({APIKey, BoundingBoxes,
 * FilterMessageTypes}); the key travels in that message, never in a URL or to the browser
 * ("direct browser connections are not permitted"). Reconnects with capped back-off.
 * Congestion is a labelled heuristic computed from live counts; without AIS it is null, not guessed.
 */
import 'server-only';
import { hasCapability } from '@/lib/capabilities';
import { userAgent } from '@/lib/config';
import { defineFeed, skippedProvider, type ProviderRun } from '@/lib/feeds';
import { distanceKm } from '@/lib/geo';
import type { Chokepoint, Port, RiskLevel, Vessel, VesselType } from '@/lib/types';
import { readRef } from '../../threats/server/refdata';

// ── Reference data ──────────────────────────────────────────────────────────────
interface PortsFile {
  curated: { name: string; country: string; lat: number; lng: number; type: string; volume?: string; fleet?: string; rank?: number }[];
  wpi: { id: string; name: string; country: string | null; lat: number; lng: number; harborSize: string; energy: boolean }[];
  naturalEarth: { id: string; name: string; lat: number; lng: number; scalerank: number }[];
}

const PORT_TYPES = new Set(['container', 'energy', 'naval', 'general']);
const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function buildPorts(file: PortsFile): Port[] {
  const out: Port[] = [];
  const near = (lat: number, lng: number) => out.some((p) => Math.abs(p.lat - lat) < 0.1 && distanceKm([p.lng, p.lat], [lng, lat]) <= 5);
  for (const c of file.curated) {
    out.push({
      id: `port-${slug(c.name)}`,
      lat: c.lat,
      lng: c.lng,
      observedAt: null,
      source: 'curated',
      name: c.name,
      country: c.country ?? null,
      type: (PORT_TYPES.has(c.type) ? c.type : 'general') as Port['type'],
      dataset: 'curated',
      harborSize: null,
      rank: typeof c.rank === 'number' && c.rank > 0 ? c.rank : null,
      volume: c.volume ?? null,
      fleet: c.fleet ?? null,
      live: null,
    });
  }
  for (const w of file.wpi) {
    if (near(w.lat, w.lng)) continue;
    out.push({ id: w.id, lat: w.lat, lng: w.lng, observedAt: null, source: 'wpi', name: w.name, country: w.country, type: w.energy ? 'energy' : 'general', dataset: 'wpi', harborSize: w.harborSize, rank: null, volume: null, fleet: null, live: null });
  }
  for (const n of file.naturalEarth) {
    if (near(n.lat, n.lng)) continue;
    out.push({ id: n.id, lat: n.lat, lng: n.lng, observedAt: null, source: 'natural-earth', name: n.name, country: null, type: 'general', dataset: 'natural-earth', harborSize: null, rank: null, volume: null, fleet: null, live: null });
  }
  return out;
}

const RISKS = new Set<RiskLevel>(['LOW', 'MODERATE', 'ELEVATED', 'HIGH', 'CRITICAL']);

export function buildChokepoints(file: { items: { name: string; lat: number; lng: number; traffic?: string; risk: string }[] }): Chokepoint[] {
  return file.items.map((c) => {
    const risk = (RISKS.has(c.risk as RiskLevel) ? c.risk : 'MODERATE') as RiskLevel;
    return { id: `choke-${slug(c.name)}`, lat: c.lat, lng: c.lng, observedAt: null, source: 'curated', name: c.name, baseRisk: risk, risk, traffic: c.traffic ?? null, shipsNearby: null };
  });
}

// ── AIS relay ───────────────────────────────────────────────────────────────────
export const AIS_URL = 'wss://stream.aisstream.io/v0/stream';
const VESSEL_TTL_MS = 30 * 60_000;
const MAX_VESSELS = 60_000;
const TRACK_POINTS = 20;

interface VesselState extends Vessel {
  seenAt: number;
}

interface AisState {
  vessels: Map<string, VesselState>;
  ws: WebSocket | null;
  connectedAt: number | null;
  lastMessageAt: number | null;
  error: string | null;
  retry: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const G = globalThis as unknown as { __godseyeAis?: AisState };
const ais: AisState = (G.__godseyeAis ??= { vessels: new Map(), ws: null, connectedAt: null, lastMessageAt: null, error: null, retry: 0, timer: null });

export function vesselType(code: number | null): VesselType {
  if (code === null) return 'other';
  if (code === 35) return 'military';
  if (code === 30) return 'fishing';
  if (code >= 60 && code <= 69) return 'passenger';
  if (code >= 70 && code <= 79) return 'cargo';
  if (code >= 80 && code <= 89) return 'tanker';
  return 'other';
}

/** AISStream `time_utc` ("2026-09-30 19:54:23.123456789 +0000 UTC") → ISO. */
export function aisTime(s: string | undefined): string | null {
  const m = s && /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?/.exec(s);
  if (!m) return null;
  const ms = Date.parse(`${m[1]}T${m[2]}${m[3] ? m[3].slice(0, 4) : ''}Z`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

const angle = (v: unknown, max: number) => (typeof v === 'number' && v >= 0 && v < max ? v : null);

interface AisMessage {
  MessageType?: string;
  MetaData?: { MMSI?: number; ShipName?: string; latitude?: number; longitude?: number; time_utc?: string };
  Message?: {
    PositionReport?: { Sog?: number; Cog?: number; TrueHeading?: number; Latitude?: number; Longitude?: number };
    ShipStaticData?: { Type?: number; CallSign?: string; ImoNumber?: number; Destination?: string; Name?: string };
  };
}

/** Apply one AISStream message to the vessel map. Pure except for `map`. */
export function applyAis(map: Map<string, VesselState>, msg: AisMessage, now = Date.now()): void {
  const mmsi = String(msg.MetaData?.MMSI ?? '');
  if (!/^\d{9}$/.test(mmsi)) return;
  const at = aisTime(msg.MetaData?.time_utc) ?? new Date(now).toISOString();
  let v = map.get(mmsi);
  const pr = msg.Message?.PositionReport;
  const sd = msg.Message?.ShipStaticData;
  const lat = pr?.Latitude ?? msg.MetaData?.latitude;
  const lng = pr?.Longitude ?? msg.MetaData?.longitude;
  const validPos = typeof lat === 'number' && typeof lng === 'number' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  if (!v) {
    if (!validPos) return;
    v = { id: mmsi, mmsi, lat: lat!, lng: lng!, observedAt: at, source: 'aisstream', name: null, callsign: null, imo: null, type: 'other', aisType: null, sogKt: null, cogDeg: null, headingDeg: null, destination: null, flag: null, track: [], seenAt: now };
    if (map.size >= MAX_VESSELS) map.delete(map.keys().next().value!);
    map.set(mmsi, v);
  }
  const name = (sd?.Name ?? msg.MetaData?.ShipName ?? '').trim();
  if (name) v.name = name.slice(0, 40);
  if (sd) {
    const t = typeof sd.Type === 'number' && sd.Type >= 0 && sd.Type <= 99 ? sd.Type : null;
    v.aisType = t;
    v.type = vesselType(t);
    v.callsign = sd.CallSign?.trim() || v.callsign;
    v.imo = sd.ImoNumber ? String(sd.ImoNumber) : v.imo;
    v.destination = sd.Destination?.trim().slice(0, 40) || v.destination;
  }
  if (pr && validPos) {
    v.lat = lat!;
    v.lng = lng!;
    v.observedAt = at;
    v.sogKt = typeof pr.Sog === 'number' && pr.Sog >= 0 && pr.Sog < 102.3 ? pr.Sog : null;
    v.cogDeg = angle(pr.Cog, 360);
    v.headingDeg = angle(pr.TrueHeading, 360);
    const t = Math.round(Date.parse(at) / 1000);
    const last = v.track.at(-1);
    if (!last || t - last[2] >= 60) {
      v.track.push([lng!, lat!, t]);
      if (v.track.length > TRACK_POINTS) v.track.shift();
    }
  }
  v.seenAt = now;
}

function scheduleReconnect(): void {
  if (ais.timer) return;
  const delay = Math.min(5 * 60_000, 2_000 * 2 ** Math.min(ais.retry, 7));
  ais.retry++;
  ais.timer = setTimeout(() => {
    ais.timer = null;
    connectAis();
  }, delay);
  ais.timer.unref?.();
}

/** Open (once per process) the AISStream relay. No-op without the `ais` capability. */
export function connectAis(): void {
  if (!hasCapability('ais') || ais.ws || typeof WebSocket === 'undefined') return;
  let ws: WebSocket;
  try {
    // Node's WebSocket (undici) accepts headers in the init object; browsers never see this socket.
    ws = new WebSocket(AIS_URL, { headers: { 'User-Agent': userAgent() } } as unknown as string[]);
  } catch (e) {
    ais.error = (e as Error).message;
    scheduleReconnect();
    return;
  }
  ws.binaryType = 'arraybuffer';
  ais.ws = ws;
  const decoder = new TextDecoder();
  ws.addEventListener('open', () => {
    ais.connectedAt = Date.now();
    ais.error = null;
    ws.send(JSON.stringify({ APIKey: process.env.AIS_API_KEY, BoundingBoxes: [[[-90, -180], [90, 180]]], FilterMessageTypes: ['PositionReport', 'ShipStaticData'] }));
  });
  ws.addEventListener('message', (ev: MessageEvent) => {
    try {
      const text = typeof ev.data === 'string' ? ev.data : decoder.decode(ev.data as ArrayBuffer);
      const msg = JSON.parse(text) as AisMessage & { error?: string };
      if (msg.error) {
        ais.error = String(msg.error).slice(0, 120);
        return;
      }
      ais.lastMessageAt = Date.now();
      ais.retry = 0;
      applyAis(ais.vessels, msg);
    } catch {
      // A malformed frame is dropped; the stream continues.
    }
  });
  const down = (reason: string) => {
    if (ais.ws !== ws) return;
    ais.ws = null;
    ais.connectedAt = null;
    ais.error = reason;
    scheduleReconnect();
  };
  ws.addEventListener('close', (ev: CloseEvent) => down(`closed ${ev.code}`));
  ws.addEventListener('error', () => down('socket error'));
}

export function liveVessels(now = Date.now()): Vessel[] {
  const out: Vessel[] = [];
  for (const [id, v] of ais.vessels) {
    if (now - v.seenAt > VESSEL_TTL_MS) {
      ais.vessels.delete(id);
      continue;
    }
    const { seenAt: _s, ...vessel } = v;
    out.push({ ...vessel, track: [...vessel.track] });
  }
  return out;
}

// ── Congestion heuristic (labelled) ─────────────────────────────────────────────
export const CONGESTION_METHOD = 'heuristic: waiting ratio and count within 50 km' as const;

export function annotatePorts(ports: Port[], vessels: readonly Vessel[]): Port[] {
  if (!vessels.length) return ports;
  return ports.map((p) => {
    let near = 0;
    let waiting = 0;
    for (const v of vessels) {
      if (Math.abs(v.lat - p.lat) > 0.5) continue;
      if (distanceKm([p.lng, p.lat], [v.lng, v.lat]) > 50) continue;
      near++;
      if (v.sogKt !== null && v.sogKt < 0.5) waiting++;
    }
    if (!near) return p;
    const ratio = waiting / near;
    const congestion = waiting >= 30 && ratio >= 0.6 ? 'SEVERE' : waiting >= 10 && ratio >= 0.4 ? 'CONGESTED' : 'NORMAL';
    return { ...p, live: { shipsNearby: near, waiting, congestion, method: CONGESTION_METHOD } };
  });
}

export function annotateChokepoints(chokes: Chokepoint[], vessels: readonly Vessel[], live: boolean): Chokepoint[] {
  if (!live) return chokes;
  return chokes.map((c) => ({ ...c, shipsNearby: vessels.filter((v) => Math.abs(v.lat - c.lat) < 1.2 && distanceKm([c.lng, c.lat], [v.lng, v.lat]) <= 100).length }));
}

// ── Feed ────────────────────────────────────────────────────────────────────────
export interface MaritimeData {
  ports: Port[];
  chokepoints: Chokepoint[];
  vessels: Vessel[];
  aisConfigured: boolean;
}

let refCache: { ports: Port[]; chokepoints: Chokepoint[] } | null = null;
function reference() {
  refCache ??= { ports: buildPorts(readRef<PortsFile>('ports.json')), chokepoints: buildChokepoints(readRef('chokepoints.json')) };
  return refCache;
}

export const maritimeFeed = defineFeed<MaritimeData>({
  key: 'maritime',
  ttlMs: 10_000,
  kind: 'mixed',
  attribution: [
    { text: 'Ports: NGA World Port Index (public domain), Natural Earth (public domain), curated list (OSIRIS, MIT)', url: 'https://msi.nga.mil/Publications/WPI' },
    { text: 'Vessels: AISStream.io (when configured)', url: 'https://aisstream.io/' },
  ],
  note: 'Ports and chokepoints are REFERENCE; vessels are live AIS only when AIS_API_KEY is configured. Congestion is a heuristic.',
  count: (d) => d.ports.length + d.vessels.length,
  run: async () => {
    const ref = reference();
    const configured = hasCapability('ais');
    const providers: Record<string, ProviderRun> = {
      reference: { status: { ok: true, count: ref.ports.length + ref.chokepoints.length, ms: 0, age_s: 0 }, okAt: Date.now() },
    };
    let vessels: Vessel[] = [];
    if (configured) {
      connectAis();
      vessels = liveVessels();
      const ok = vessels.length > 0 && ais.lastMessageAt !== null && Date.now() - ais.lastMessageAt < 120_000;
      providers.aisstream = {
        status: { ok, count: vessels.length, ms: 0, age_s: ais.lastMessageAt ? Math.round((Date.now() - ais.lastMessageAt) / 1000) : null, ...(ok ? {} : { error: ais.error ?? (ais.ws ? 'connecting' : 'disconnected') }) },
        okAt: ok ? ais.lastMessageAt : null,
      };
    } else providers.aisstream = skippedProvider('not-configured');
    let newest = 0;
    for (const v of vessels) if (v.observedAt) newest = Math.max(newest, Date.parse(v.observedAt));
    return {
      data: { ports: annotatePorts(ref.ports, vessels), chokepoints: annotateChokepoints(ref.chokepoints, vessels, vessels.length > 0), vessels, aisConfigured: configured },
      providers,
      observedAt: newest || null,
    };
  },
});

/** Test hook. */
export function resetAis(): void {
  ais.vessels.clear();
  refCache = null;
}
