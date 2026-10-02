'use client';
/**
 * Network intel layers: URLhaus malware hosts over SSE (arrival beacons for NEW IPs only), Feodo
 * C2 and ThreatFox IOCs as INDICATOR points (never arcs), internet outages, Cloudflare attack
 * origins (points; an arc only when a target is reported) and submarine cables (REFERENCE).
 * Co-located indicators are ONE point at their true shared coordinate with a count (colocate.ts);
 * nothing is displaced. Point layers draw over the globe surface and only on the camera-facing
 * hemisphere (threats/client/globe.ts). Owner: layers-threats-network.
 */
import { ArcLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { LayerComponentProps } from '@/lib/feature-module';
import { LAYERS } from '@/lib/layer-registry';
import { useDeckLayers, useFeedEventStore, useLayerStatusStore, type LayerStatus } from '@/lib/layer-host';
import type { DeckPickInfo } from '@/lib/map/picking';
import { readCssColor, hudFontFamily } from '@/lib/tokens';
import type { AttackOrigin, AttackOriginsResponse, C2Response, C2Server, CablesResponse, FeedEvent, FeedMeta, KevResponse, LandingPoint, MalwareHost, Outage, OutagesResponse, Providers, ThreatFoxResponse, ThreatIndicator } from '@/lib/types';
import { countryByIso2 } from '../../threats/shared/country';
import { GLOBE_POINT_PARAMETERS, lngLatOf, useFacing } from '../../threats/client/globe';
import { FEED_FETCH_INIT, rgbaCss, useCapabilityGate, useDeckPick, useFeedData, useNativeLayers, useNativePick } from '../../threats/client/hooks';
import { colocatedRadiusPx, countLabels, groupColocated, type Colocated } from './colocate';
import { KEV_FEED_LIMIT, kevEvents } from './kev-events';
import { isDegradedStatus, MALWARE_WATCHDOG_MS, malwareCount, needsResync, reduceMalware, type MalwareStatus, type MalwareStreamEvent } from './malware-state';

const zOf = (id: string) => LAYERS.find((l) => l.id === id)!.z;
const css = (token: Parameters<typeof readCssColor>[0], alpha = 1) => rgbaCss(readCssColor(token, alpha));
const sel = <T extends { id: string; lat: number; lng: number; observedAt: string | null; source: string }>(kind: 'malware_host' | 'c2_server' | 'attack_origin', layer: 'malware' | 'cyber_attacks' | 'cf_attacks', t: T, extra: Record<string, unknown> = {}) => ({
  kind,
  id: t.id,
  layer,
  source: t.source,
  observedAt: t.observedAt,
  data: { ...(t as unknown as Record<string, unknown>), ...extra },
  lngLat: [t.lng, t.lat] as [number, number],
});

// ── Co-located indicator groups (one point per true coordinate, count label) ─────
/** Card payload for a group: the first indicator's fields plus every indicator at that point. */
function groupData<T extends { id: string }>(g: Colocated<T>): Record<string, unknown> {
  return { ...(g.items[0] as unknown as Record<string, unknown>), colocated: g.items.length, members: g.items };
}
const groupId = <T extends { id: string }>(g: Colocated<T>) => (g.items.length > 1 ? `at:${g.key}` : g.items[0]!.id);

/** Count labels (n ≥ 2) at the shared point; billboard + cullMode none; `groups` are facing ones. */
function countLabelLayer<T>(id: string, groups: readonly Colocated<T>[], token: Parameters<typeof readCssColor>[0]) {
  return new TextLayer<Colocated<T>>({
    id,
    data: countLabels(groups),
    getPosition: lngLatOf,
    getText: (g) => String(g.items.length),
    getSize: 10,
    getColor: readCssColor(token, 1),
    fontFamily: hudFontFamily(),
    fontWeight: 600,
    getTextAnchor: 'middle',
    getAlignmentBaseline: 'center',
    billboard: true,
    parameters: { cullMode: 'none', depthCompare: 'always' },
    pickable: false,
  });
}

// ── Malware (SSE) ────────────────────────────────────────────────────────────────
export function malwareEvents(hosts: readonly MalwareHost[], receivedAt: string): FeedEvent[] {
  return hosts.map((h) => ({
    id: h.ip,
    layer: 'malware',
    entityKind: 'malware_host' as const,
    entityId: h.id,
    title: `New malware host ${h.ip}${h.family ? ` (${h.family})` : ''}`,
    detail: [h.city, h.country].filter(Boolean).join(', ') || undefined,
    severity: h.online ? ('medium' as const) : ('low' as const),
    // URLhaus dateadded of the host's newest URL; the stream arrival time only when URLhaus gave none.
    observedAt: h.observedAt ?? receivedAt,
    lat: h.lat,
    lng: h.lng,
    source: 'URLhaus',
  }));
}

const BEACON_MS = 120_000;
const RESYNC_MIN_MS = 60_000;

function MalwareLayer() {
  // The stream is only opened when /api/health reports nc_sources on (never a 403 to log).
  const gate = useCapabilityGate('malware');
  return gate === 'enabled' ? <MalwareStream /> : null;
}

function MalwareStream() {
  const [hosts, setHosts] = useState<MalwareHost[] | null>(null);
  // Arrival time per NEW ip (beacon rings fade out of the set after BEACON_MS).
  const [arrivals, setArrivals] = useState<ReadonlyMap<string, number>>(() => new Map());
  const update = useLayerStatusStore((s) => s.update);
  const push = useFeedEventStore((s) => s.push);

  useEffect(() => {
    let es: EventSource | null = null;
    let current: MalwareHost[] | null = null;
    let lastResync = 0;
    let lastEventAt = Date.now();
    // Set when the watchdog downgraded a silent stream: the next event resyncs from a snapshot.
    let resyncOnEvent = false;
    /**
     * Downgrade the row without touching the host set (round 10 BLOCKING 1/2): never better than
     * `state`, SOURCE OFFLINE when there is nothing to show.
     */
    const degrade = (state: 'stale' | 'offline', patch: Partial<LayerStatus>) => {
      const was = useLayerStatusStore.getState().status.malware?.state;
      const next = current === null || state === 'offline' || was === 'offline' ? 'offline' : 'stale';
      update('malware', { ...patch, state: next, ...(next === 'offline' ? { count: null } : {}) });
    };
    const apply = (ev: MalwareStreamEvent) => {
      current = reduceMalware(current, ev);
      setHosts(current);
      if (needsResync(current, ev) && Date.now() - lastResync > RESYNC_MIN_MS) {
        lastResync = Date.now();
        open(); // a fresh snapshot replaces the set
      }
    };
    /** Any frame proves the stream is alive; after a watchdog downgrade it resyncs (true = reopened). */
    const seen = () => {
      lastEventAt = Date.now();
      if (!resyncOnEvent) return false;
      resyncOnEvent = false;
      open();
      return true;
    };
    const open = () => {
      es?.close();
      const src = new EventSource('/api/malware/stream');
      es = src;
      lastEventAt = Date.now();
      src.addEventListener('snapshot', (ev) => {
        lastEventAt = Date.now();
        resyncOnEvent = false;
        const snap = JSON.parse((ev as MessageEvent<string>).data) as { items: MalwareHost[]; meta: FeedMeta; providers: Providers };
        update('malware', { state: snap.meta.state, fetchedAt: snap.meta.fetchedAt, observedAt: snap.meta.observedAt, lastGoodAt: snap.meta.lastGoodAt, providers: snap.providers, attribution: snap.meta.attribution, error: undefined });
        apply({ type: 'snapshot', items: snap.items });
      });
      src.addEventListener('heartbeat', () => void seen());
      src.addEventListener('detections', (ev) => {
        if (seen()) return;
        const added = JSON.parse((ev as MessageEvent<string>).data) as MalwareHost[];
        const now = Date.now();
        setArrivals((prev) => new Map([...prev, ...added.map((h) => [h.ip, now] as const)]));
        apply({ type: 'detections', items: added });
        push(malwareEvents(added, new Date(now).toISOString()));
      });
      src.addEventListener('status', (ev) => {
        if (seen()) return;
        const st = JSON.parse((ev as MessageEvent<string>).data) as MalwareStatus;
        // A failed server run retires nothing: the hosts stay, badged with their last-good time.
        if (isDegradedStatus(st)) return degrade(st.state as 'stale' | 'offline', { lastGoodAt: st.lastGoodAt ?? null, error: st.error ?? 'source_offline' });
        if (st.state) update('malware', { state: st.state, fetchedAt: st.fetchedAt ?? null, lastGoodAt: st.lastGoodAt ?? st.fetchedAt ?? null, error: undefined });
        apply({ type: 'status', retired: st.retired, total: st.total });
      });
      src.onerror = () => {
        if (es !== src) return;
        // CLOSED: the browser gave up. CONNECTING: it is retrying; either way nothing is observed
        // now, and the snapshot sent on reconnect restores the row.
        if (src.readyState === EventSource.CLOSED) degrade('offline', { error: 'stream_closed' });
        else degrade('stale', { error: 'reconnecting' });
      };
    };
    // A stream that has gone quiet for three server heartbeats is not observed any more.
    const watchdog = setInterval(() => {
      if (resyncOnEvent || Date.now() - lastEventAt <= MALWARE_WATCHDOG_MS) return;
      resyncOnEvent = true;
      degrade('stale', { error: 'no_heartbeat' });
    }, 5_000);
    update('malware', { state: 'loading' });
    open();
    return () => {
      clearInterval(watchdog);
      es?.close();
    };
  }, [update, push]);

  // The count is derived from the host set here and nowhere else (R3-M2).
  useEffect(() => {
    const count = malwareCount(hosts);
    if (count !== null) update('malware', { count });
  }, [hosts, update]);

  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setArrivals((prev) => {
        const next = new Map([...prev].filter(([, at]) => now - at <= BEACON_MS));
        return next.size === prev.size ? prev : next;
      });
    }, 10_000);
    return () => clearInterval(t);
  }, []);

  const all = useMemo(() => (hosts ? groupColocated(hosts) : null), [hosts]);
  const groups = useFacing(all, lngLatOf);
  const layers = useMemo(() => {
    if (!groups) return null;
    const beacons = groups.filter((g) => g.items.some((h) => arrivals.has(h.ip)));
    return [
      new ScatterplotLayer<Colocated<MalwareHost>>({
        id: 'tn-malware',
        data: groups,
        parameters: GLOBE_POINT_PARAMETERS,
        getPosition: lngLatOf,
        getRadius: (g) => colocatedRadiusPx(g.items.length, g.items.some((h) => h.online) ? 4 : 3),
        radiusUnits: 'pixels',
        getFillColor: (g) => readCssColor('--map-malware', g.items.some((h) => h.online) ? 0.7 : 0.4),
        getLineColor: readCssColor('--map-malware-ring', 0.9),
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 0.75,
        pickable: true,
        autoHighlight: true,
      }),
      new ScatterplotLayer<Colocated<MalwareHost>>({
        id: 'tn-malware-beacons',
        data: beacons,
        parameters: GLOBE_POINT_PARAMETERS,
        getPosition: lngLatOf,
        getRadius: (g) => colocatedRadiusPx(g.items.length, 4) + 7,
        radiusUnits: 'pixels',
        filled: false,
        stroked: true,
        getLineColor: readCssColor('--map-malware-ring', 0.8),
        lineWidthUnits: 'pixels',
        getLineWidth: 1.5,
        pickable: false,
      }),
      countLabelLayer('tn-malware-count', groups, '--map-malware-ring'),
    ];
  }, [groups, arrivals]);
  useDeckLayers('network:malware', layers, zOf('malware'));
  useDeckPick('tn-malware', (info: DeckPickInfo) => {
    const g = info.object as Colocated<MalwareHost> | undefined;
    return g ? { ...sel('malware_host', 'malware', g.items[0]!), id: groupId(g), data: groupData(g) } : null;
  });
  return null;
}

// ── Feodo C2 (INDICATOR points) ──────────────────────────────────────────────────
export function c2Events(items: readonly C2Server[]): FeedEvent[] {
  return items
    .filter((c) => c.status === 'online' && c.lastOnline)
    .map((c) => ({ id: `${c.ip}:${c.lastOnline}`, layer: 'cyber_attacks', entityKind: 'c2_server' as const, entityId: c.id, title: `Botnet C2 listed online: ${c.ip}${c.malware ? ` (${c.malware})` : ''}`, detail: c.country ?? undefined, severity: 'medium' as const, observedAt: c.lastOnline!, lat: c.lat, lng: c.lng, source: 'Feodo Tracker' }));
}

function C2Layer() {
  const data = useFeedData<C2Response>('cyber_attacks', '/api/cyber-attacks', (b) => b.items.length);
  const items = data?.items;
  const push = useFeedEventStore((s) => s.push);
  useEffect(() => {
    if (items) push(c2Events(items));
  }, [items, push]);
  const all = useMemo(() => (items ? groupColocated(items) : null), [items]);
  const groups = useFacing(all, lngLatOf);
  const layers = useMemo(() => {
    if (!groups) return null;
    return [
      new ScatterplotLayer<Colocated<C2Server>>({
        id: 'tn-c2',
        data: groups,
        parameters: GLOBE_POINT_PARAMETERS,
        getPosition: lngLatOf,
        getRadius: (g) => colocatedRadiusPx(g.items.length, g.items.some((c) => c.status === 'online') ? 6 : 4),
        radiusUnits: 'pixels',
        getFillColor: (g) => readCssColor(g.items.some((c) => c.status === 'online') ? '--map-c2-online' : '--map-c2-offline', 0.9),
        getLineColor: readCssColor('--map-c2-online', 1),
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 1,
        pickable: true,
        autoHighlight: true,
      }),
      countLabelLayer('tn-c2-count', groups, '--map-c2-online'),
    ];
  }, [groups]);
  useDeckLayers('network:c2', layers, zOf('cyber_attacks'));
  useDeckPick('tn-c2', (info) => {
    const g = info.object as Colocated<C2Server> | undefined;
    return g ? { ...sel('c2_server', 'cyber_attacks', g.items[0]!), id: groupId(g), data: groupData(g) } : null;
  });
  return null;
}

// ── ThreatFox (INDICATOR points for IP IOCs) ─────────────────────────────────────
type Placed = ThreatIndicator & { lat: number; lng: number };

function ThreatFoxLayer() {
  const data = useFeedData<ThreatFoxResponse>('threatfox', '/api/threatfox', (b) => b.located);
  const placed = useMemo<Placed[] | null>(() => data?.items.flatMap((t) => (t.geo ? [{ ...t, lat: t.geo.lat, lng: t.geo.lng }] : [])) ?? null, [data]);
  const all = useMemo(() => (placed ? groupColocated(placed) : null), [placed]);
  const groups = useFacing(all, lngLatOf);
  const layers = useMemo(() => {
    if (!groups) return null;
    return [
      new ScatterplotLayer<Colocated<Placed>>({
        id: 'tn-threatfox',
        data: groups,
        parameters: GLOBE_POINT_PARAMETERS,
        getPosition: lngLatOf,
        getRadius: (g) => colocatedRadiusPx(g.items.length, 3.5),
        radiusUnits: 'pixels',
        getFillColor: readCssColor('--map-malware', 0.35),
        getLineColor: readCssColor('--map-malware', 0.95),
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 1,
        pickable: true,
        autoHighlight: true,
      }),
      countLabelLayer('tn-threatfox-count', groups, '--map-malware'),
    ];
  }, [groups]);
  useDeckLayers('network:threatfox', layers, zOf('threatfox'));
  useDeckPick('tn-threatfox', (info) => {
    const g = info.object as Colocated<Placed> | undefined;
    const t = g?.items[0];
    return g && t ? { kind: 'threat_indicator', id: groupId(g), layer: 'threatfox', source: 'threatfox', observedAt: t.observedAt, data: groupData(g), lngLat: [g.lng, g.lat] } : null;
  });
  return null;
}

// ── Outages ─────────────────────────────────────────────────────────────────────
export function outageEvents(items: readonly Outage[]): FeedEvent[] {
  return items
    .filter((o) => o.ongoing)
    .map((o) => ({ id: o.id, layer: 'cf_outages', entityKind: 'outage' as const, entityId: o.id, title: `Internet outage: ${o.country}`, detail: o.description ?? undefined, severity: 'medium' as const, observedAt: o.startedAt, lat: o.lat, lng: o.lng, source: o.provider }));
}

function OutagesLayer() {
  const data = useFeedData<OutagesResponse>('cf_outages', '/api/outages', (b) => b.items.length);
  const all = data?.items;
  const push = useFeedEventStore((s) => s.push);
  useEffect(() => {
    if (all) push(outageEvents(all));
  }, [all, push]);
  const items = useFacing(all, lngLatOf);
  const layers = useMemo(
    () =>
      items
        ? [
            new ScatterplotLayer<Outage>({
              id: 'tn-outages',
              data: items,
              parameters: GLOBE_POINT_PARAMETERS,
              getPosition: lngLatOf,
              getRadius: 7,
              radiusUnits: 'pixels',
              getFillColor: (o) => (o.ongoing ? readCssColor('--map-outage', 0.55) : readCssColor('--map-outage-resolved', 0.4)),
              getLineColor: readCssColor('--map-outage', 1),
              stroked: true,
              lineWidthUnits: 'pixels',
              getLineWidth: 1.25,
              pickable: true,
              autoHighlight: true,
            }),
          ]
        : null,
    [items],
  );
  useDeckLayers('network:outages', layers, zOf('cf_outages'));
  useDeckPick('tn-outages', (info) => {
    const o = info.object as Outage | undefined;
    return o ? { kind: 'outage', id: o.id, layer: 'cf_outages', source: o.source, observedAt: o.startedAt, data: o as unknown as Record<string, unknown>, lngLat: [o.lng, o.lat] } : null;
  });
  return null;
}

// ── Attack origins ──────────────────────────────────────────────────────────────
function AttackOriginsLayer() {
  const data = useFeedData<AttackOriginsResponse>('cf_attacks', '/api/cloudflare-radar', (b) => b.items.length);
  const all = data?.items;
  const items = useFacing(all, lngLatOf);
  // Arcs rise off the surface and keep the globe's depth test: built from every origin.
  const arcs = useMemo(
    () =>
      (all ?? []).flatMap((a) => {
        const t = a.targetCountryCode ? countryByIso2(a.targetCountryCode) : null;
        return t ? [{ a, to: [t.lng, t.lat] as [number, number] }] : [];
      }),
    [all],
  );
  const layers = useMemo(() => {
    if (!items) return null;
    return [
      new ScatterplotLayer<AttackOrigin>({
        id: 'tn-origins',
        data: items,
        parameters: GLOBE_POINT_PARAMETERS,
        getPosition: lngLatOf,
        getRadius: (a) => 4 + Math.sqrt(a.sharePct) * 2,
        radiusUnits: 'pixels',
        getFillColor: readCssColor('--map-attack', 0.4),
        getLineColor: readCssColor('--map-attack', 1),
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 1,
        pickable: true,
      }),
      // Arcs only for rows whose upstream names the target (never inferred).
      new ArcLayer<(typeof arcs)[number]>({
        id: 'tn-origin-arcs',
        data: arcs,
        getSourcePosition: (d) => [d.a.lng, d.a.lat],
        getTargetPosition: (d) => d.to,
        getSourceColor: readCssColor('--map-attack', 0.9),
        getTargetColor: readCssColor('--map-attack', 0.3),
        getWidth: 1.5,
        greatCircle: true,
        numSegments: 64,
        parameters: { cullMode: 'none' },
        antialiasing: true,
      } as ConstructorParameters<typeof ArcLayer<(typeof arcs)[number]>>[0]),
    ];
  }, [items, arcs]);
  useDeckLayers('network:origins', layers, zOf('cf_attacks'));
  useDeckPick('tn-origins', (info) => {
    const a = info.object as AttackOrigin | undefined;
    return a ? sel('attack_origin', 'cf_attacks', a) : null;
  });
  return null;
}

// ── Cables (REFERENCE) ──────────────────────────────────────────────────────────
function CablesLayer() {
  const data = useFeedData<CablesResponse>('sdk_sea', '/api/cables', (b) => b.cables.length, 24 * 60 * 60_000);
  const cables = data?.cables;
  const landing = data?.landingPoints;
  const cableFc = useMemo<GeoJSON.FeatureCollection | null>(() => (cables ? { type: 'FeatureCollection', features: cables.map((c) => ({ type: 'Feature', geometry: c.geometry, properties: { id: c.id } })) } : null), [cables]);
  const cableLayers = useMemo(() => [{ id: 'tn-cables', type: 'line' as const, paint: { 'line-color': css('--map-cable', 0.75), 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.6, 6, 1.6] as unknown as number } }], []);
  useNativeLayers('tn-cables', cableFc, cableLayers);
  const shownLanding = useFacing(landing, lngLatOf);
  const landingLayers = useMemo(
    () =>
      shownLanding
        ? [
            new ScatterplotLayer<LandingPoint>({
              id: 'tn-landing',
              data: shownLanding,
              parameters: GLOBE_POINT_PARAMETERS,
              getPosition: lngLatOf,
              getRadius: 2.5,
              radiusUnits: 'pixels',
              getFillColor: readCssColor('--map-cable', 1),
              getLineColor: readCssColor('--map-cable', 0.4),
              stroked: true,
              lineWidthUnits: 'pixels',
              getLineWidth: 2,
              pickable: true,
            }),
          ]
        : null,
    [shownLanding],
  );
  useDeckLayers('network:landing', landingLayers, zOf('sdk_sea'));
  const cById = useMemo(() => new Map((cables ?? []).map((c) => [c.id, c])), [cables]);
  useNativePick(['tn-cables'], (id) => {
    const c = cById.get(id);
    return c ? { kind: 'cable', id: c.id, layer: 'sdk_sea', source: 'telegeography', observedAt: null, data: { ...c, geometry: null } as unknown as Record<string, unknown>, lngLat: null } : null;
  });
  useDeckPick('tn-landing', (info) => {
    const l = info.object as LandingPoint | undefined;
    return l ? { kind: 'landing_point', id: l.id, layer: 'sdk_sea', source: 'telegeography', observedAt: null, data: l as unknown as Record<string, unknown>, lngLat: [l.lng, l.lat] } : null;
  });
  return null;
}

// ── CISA KEV newest additions → Intel Feed (no map geometry) ─────────────────────
function KevFeed() {
  const push = useFeedEventStore((s) => s.push);
  const q = useQuery({
    queryKey: ['threats-network', 'kev-feed'],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/cyber-threats?limit=${KEV_FEED_LIMIT}`, { ...FEED_FETCH_INIT, signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as KevResponse;
    },
    refetchInterval: 10 * 60_000,
    refetchIntervalInBackground: false,
  });
  const items = q.data?.items;
  useEffect(() => {
    if (items) push(kevEvents(items));
  }, [items, push]);
  return null;
}

export default function NetworkLayer({ active }: LayerComponentProps) {
  return (
    <>
      {active.has('sdk_sea') && <CablesLayer />}
      {active.has('cf_outages') && <OutagesLayer />}
      {active.has('cf_attacks') && <AttackOriginsLayer />}
      {active.has('threatfox') && <ThreatFoxLayer />}
      {active.has('cyber_attacks') && <C2Layer />}
      {active.has('malware') && <MalwareLayer />}
      {(active.has('malware') || active.has('cyber_attacks') || active.has('threatfox')) && <KevFeed />}
    </>
  );
}
