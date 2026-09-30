'use client';
/**
 * Network intel layers: URLhaus malware hosts over SSE (arrival beacons for NEW IPs only), Feodo
 * C2 and ThreatFox IOCs as INDICATOR points (never arcs), internet outages, Cloudflare attack
 * origins (points; an arc only when a target is reported) and submarine cables (REFERENCE).
 * Co-located indicators are spread for display only (spread.ts). Owner: layers-threats-network.
 */
import { ArcLayer, ScatterplotLayer } from '@deck.gl/layers';
import { useEffect, useMemo, useState } from 'react';
import type { LayerComponentProps } from '@/lib/feature-module';
import { LAYERS } from '@/lib/layer-registry';
import { useDeckLayers, useFeedEventStore, useLayerStatusStore } from '@/lib/layer-host';
import type { DeckPickInfo } from '@/lib/map/picking';
import { readCssColor } from '@/lib/tokens';
import type { AttackOrigin, AttackOriginsResponse, C2Response, C2Server, CablesResponse, FeedEvent, FeedMeta, MalwareHost, Outage, OutagesResponse, Providers, ThreatFoxResponse, ThreatIndicator } from '@/lib/types';
import { countryByIso2 } from '../../threats/shared/country';
import { pointsFc, rgbaCss, useDeckPick, useFeedData, useNativeLayers, useNativePick } from '../../threats/client/hooks';
import { spreadPositions, useZoomBucket } from './spread';

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

// ── Malware (SSE) ────────────────────────────────────────────────────────────────
export function malwareEvents(hosts: readonly MalwareHost[]): FeedEvent[] {
  return hosts.map((h) => ({
    id: h.ip,
    layer: 'malware',
    entityKind: 'malware_host' as const,
    entityId: h.id,
    title: `New malware host ${h.ip}${h.family ? ` (${h.family})` : ''}`,
    detail: [h.city, h.country].filter(Boolean).join(', ') || undefined,
    severity: h.online ? ('medium' as const) : ('low' as const),
    observedAt: h.observedAt ?? new Date().toISOString(),
    lat: h.lat,
    lng: h.lng,
    source: 'URLhaus',
  }));
}

const BEACON_MS = 120_000;

function MalwareLayer() {
  const [hosts, setHosts] = useState<MalwareHost[] | null>(null);
  // Arrival time per NEW ip (beacon rings fade out of the set after BEACON_MS).
  const [arrivals, setArrivals] = useState<ReadonlyMap<string, number>>(() => new Map());
  const update = useLayerStatusStore((s) => s.update);
  const push = useFeedEventStore((s) => s.push);
  const zoom = useZoomBucket();

  useEffect(() => {
    update('malware', { state: 'loading' });
    const es = new EventSource('/api/malware/stream');
    es.addEventListener('snapshot', (ev) => {
      const snap = JSON.parse((ev as MessageEvent<string>).data) as { items: MalwareHost[]; meta: FeedMeta; providers: Providers };
      setHosts(snap.items);
      update('malware', { state: snap.meta.state, count: snap.items.length, fetchedAt: snap.meta.fetchedAt, observedAt: snap.meta.observedAt, lastGoodAt: snap.meta.lastGoodAt, providers: snap.providers, attribution: snap.meta.attribution, error: undefined });
    });
    es.addEventListener('detections', (ev) => {
      const added = JSON.parse((ev as MessageEvent<string>).data) as MalwareHost[];
      const now = Date.now();
      setArrivals((prev) => new Map([...prev, ...added.map((h) => [h.ip, now] as const)]));
      setHosts((prev) => {
        const map = new Map((prev ?? []).map((h) => [h.ip, h]));
        for (const h of added) map.set(h.ip, h);
        const next = [...map.values()];
        update('malware', { count: next.length, state: 'live', fetchedAt: new Date(now).toISOString() });
        return next;
      });
      push(malwareEvents(added));
    });
    es.addEventListener('status', (ev) => {
      const st = JSON.parse((ev as MessageEvent<string>).data) as { retired: string[] };
      const gone = new Set(st.retired);
      setHosts((prev) => (prev ? prev.filter((h) => !gone.has(h.ip)) : prev));
    });
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) update('malware', { state: 'offline', error: 'stream_closed' });
    };
    return () => es.close();
  }, [update, push]);

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

  const layers = useMemo(() => {
    if (!hosts) return null;
    const { pos, shared } = spreadPositions(hosts, zoom);
    const data = hosts.map((h, i) => ({ h, p: pos[i]!, n: shared[i]! }));
    const beacons = data.filter((d) => arrivals.has(d.h.ip));
    return [
      new ScatterplotLayer<(typeof data)[number]>({
        id: 'tn-malware',
        data,
        getPosition: (d) => d.p,
        getRadius: (d) => (d.h.online ? 4 : 3),
        radiusUnits: 'pixels',
        getFillColor: (d) => readCssColor('--map-malware', d.h.online ? 0.85 : 0.45),
        getLineColor: readCssColor('--map-malware-ring', 0.9),
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 0.5,
        pickable: true,
        autoHighlight: true,
      }),
      new ScatterplotLayer<(typeof data)[number]>({
        id: 'tn-malware-beacons',
        data: beacons,
        getPosition: (d) => d.p,
        getRadius: 11,
        radiusUnits: 'pixels',
        filled: false,
        stroked: true,
        getLineColor: readCssColor('--map-malware-ring', 0.8),
        lineWidthUnits: 'pixels',
        getLineWidth: 1.5,
        pickable: false,
      }),
    ];
  }, [hosts, zoom, arrivals]);
  useDeckLayers('network:malware', layers, zOf('malware'));
  useDeckPick('tn-malware', (info: DeckPickInfo) => {
    const d = info.object as { h: MalwareHost; n: number } | undefined;
    return d ? sel('malware_host', 'malware', d.h, { colocated: d.n }) : null;
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
  const zoom = useZoomBucket();
  const push = useFeedEventStore((s) => s.push);
  useEffect(() => {
    if (items) push(c2Events(items));
  }, [items, push]);
  const layers = useMemo(() => {
    if (!items) return null;
    const { pos, shared } = spreadPositions(items, zoom);
    const rows = items.map((c, i) => ({ c, p: pos[i]!, n: shared[i]! }));
    return [
      new ScatterplotLayer<(typeof rows)[number]>({
        id: 'tn-c2',
        data: rows,
        getPosition: (d) => d.p,
        getRadius: (d) => (d.c.status === 'online' ? 6 : 4),
        radiusUnits: 'pixels',
        getFillColor: (d) => readCssColor(d.c.status === 'online' ? '--map-c2-online' : '--map-c2-offline', 0.9),
        getLineColor: readCssColor('--map-c2-online', 1),
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 1,
        pickable: true,
        autoHighlight: true,
      }),
    ];
  }, [items, zoom]);
  useDeckLayers('network:c2', layers, zOf('cyber_attacks'));
  useDeckPick('tn-c2', (info) => {
    const d = info.object as { c: C2Server; n: number } | undefined;
    return d ? sel('c2_server', 'cyber_attacks', d.c, { colocated: d.n }) : null;
  });
  return null;
}

// ── ThreatFox (INDICATOR points for IP IOCs) ─────────────────────────────────────
type Placed = ThreatIndicator & { lat: number; lng: number };

function ThreatFoxLayer() {
  const data = useFeedData<ThreatFoxResponse>('threatfox', '/api/threatfox', (b) => b.located);
  const placed = useMemo<Placed[] | null>(() => data?.items.flatMap((t) => (t.geo ? [{ ...t, lat: t.geo.lat, lng: t.geo.lng }] : [])) ?? null, [data]);
  const zoom = useZoomBucket();
  const layers = useMemo(() => {
    if (!placed) return null;
    const { pos, shared } = spreadPositions(placed, zoom);
    const rows = placed.map((t, i) => ({ t, p: pos[i]!, n: shared[i]! }));
    return [
      new ScatterplotLayer<(typeof rows)[number]>({
        id: 'tn-threatfox',
        data: rows,
        getPosition: (d) => d.p,
        getRadius: 3.5,
        radiusUnits: 'pixels',
        getFillColor: readCssColor('--map-malware', 0.35),
        getLineColor: readCssColor('--map-malware', 0.95),
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 1,
        pickable: true,
        autoHighlight: true,
      }),
    ];
  }, [placed, zoom]);
  useDeckLayers('network:threatfox', layers, zOf('threatfox'));
  useDeckPick('tn-threatfox', (info) => {
    const d = info.object as { t: Placed; n: number } | undefined;
    return d ? { kind: 'threat_indicator', id: d.t.id, layer: 'threatfox', source: 'threatfox', observedAt: d.t.observedAt, data: { ...d.t, colocated: d.n } as unknown as Record<string, unknown>, lngLat: [d.t.lng, d.t.lat] } : null;
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
  const items = data?.items;
  const push = useFeedEventStore((s) => s.push);
  useEffect(() => {
    if (items) push(outageEvents(items));
  }, [items, push]);
  const byId = useMemo(() => new Map((items ?? []).map((o) => [o.id, o])), [items]);
  const fc = useMemo(() => (items ? pointsFc(items, (o) => ({ ongoing: o.ongoing })) : null), [items]);
  const layers = useMemo(
    () => [
      {
        id: 'tn-outages',
        type: 'circle' as const,
        paint: {
          'circle-radius': 7,
          'circle-color': ['case', ['get', 'ongoing'], css('--map-outage', 0.55), css('--map-outage-resolved', 0.4)] as unknown as string,
          'circle-stroke-color': css('--map-outage'),
          'circle-stroke-width': 1.25,
        },
      },
    ],
    [],
  );
  useNativeLayers('tn-outages', fc, layers);
  useNativePick(['tn-outages'], (id) => {
    const o = byId.get(id);
    return o ? { kind: 'outage', id: o.id, layer: 'cf_outages', source: o.source, observedAt: o.startedAt, data: o as unknown as Record<string, unknown>, lngLat: [o.lng, o.lat] } : null;
  });
  return null;
}

// ── Attack origins ──────────────────────────────────────────────────────────────
function AttackOriginsLayer() {
  const data = useFeedData<AttackOriginsResponse>('cf_attacks', '/api/cloudflare-radar', (b) => b.items.length);
  const items = data?.items;
  const layers = useMemo(() => {
    if (!items) return null;
    const arcs = items.flatMap((a) => {
      const t = a.targetCountryCode ? countryByIso2(a.targetCountryCode) : null;
      return t ? [{ a, to: [t.lng, t.lat] as [number, number] }] : [];
    });
    return [
      new ScatterplotLayer<AttackOrigin>({
        id: 'tn-origins',
        data: items,
        getPosition: (a) => [a.lng, a.lat],
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
  }, [items]);
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
  const landingFc = useMemo(() => (landing ? pointsFc(landing, () => ({})) : null), [landing]);
  const cableLayers = useMemo(() => [{ id: 'tn-cables', type: 'line' as const, paint: { 'line-color': css('--map-cable', 0.75), 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.6, 6, 1.6] as unknown as number } }], []);
  const landingLayers = useMemo(() => [{ id: 'tn-landing', type: 'circle' as const, minzoom: 3, paint: { 'circle-radius': 2.5, 'circle-color': css('--map-cable'), 'circle-stroke-color': css('--map-cable', 0.4), 'circle-stroke-width': 2 } }], []);
  useNativeLayers('tn-cables', cableFc, cableLayers);
  useNativeLayers('tn-landing', landingFc, landingLayers);
  const cById = useMemo(() => new Map((cables ?? []).map((c) => [c.id, c])), [cables]);
  const lById = useMemo(() => new Map((landing ?? []).map((l) => [l.id, l])), [landing]);
  useNativePick(['tn-cables'], (id) => {
    const c = cById.get(id);
    return c ? { kind: 'cable', id: c.id, layer: 'sdk_sea', source: 'telegeography', observedAt: null, data: { ...c, geometry: null } as unknown as Record<string, unknown>, lngLat: null } : null;
  });
  useNativePick(['tn-landing'], (id) => {
    const l = lById.get(id);
    return l ? { kind: 'landing_point', id: l.id, layer: 'sdk_sea', source: 'telegeography', observedAt: null, data: l as unknown as Record<string, unknown>, lngLat: [l.lng, l.lat] } : null;
  });
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
    </>
  );
}
