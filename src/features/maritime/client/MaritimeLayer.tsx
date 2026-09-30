'use client';
/**
 * Maritime layer: ports and chokepoints (REFERENCE, native circles) and — only when the server
 * relays AISStream — live vessels (deck points) with speed-coloured recent tracks (segment speed
 * computed from consecutive AIS positions). Owner: layers-threats-network.
 */
import { LineLayer, ScatterplotLayer } from '@deck.gl/layers';
import { useMemo } from 'react';
import { distanceKm } from '@/lib/geo';
import { LAYERS } from '@/lib/layer-registry';
import { useDeckLayers } from '@/lib/layer-host';
import { readCssColor, type MapToken } from '@/lib/tokens';
import type { Chokepoint, MaritimeResponse, Port, RiskLevel, Vessel } from '@/lib/types';
import { useDeckPick, useFeedData } from '../../threats/client/hooks';

const Z = LAYERS.find((l) => l.id === 'maritime')!.z;
const CHOKE_TOKEN: Record<RiskLevel, MapToken> = { CRITICAL: '--map-choke-critical', HIGH: '--map-choke-high', ELEVATED: '--map-choke-elevated', MODERATE: '--map-choke-elevated', LOW: '--map-choke-low' };

const SHIP_TOKEN: Record<Vessel['type'], MapToken> = {
  military: '--map-ship-military',
  tanker: '--map-ship-tanker',
  cargo: '--map-ship-cargo',
  passenger: '--map-ship-other',
  fishing: '--map-ship-other',
  other: '--map-ship-other',
};

/** Knots between two track points ([lng, lat, epochS]); null when the time step is unusable. */
export function segmentKnots(a: [number, number, number], b: [number, number, number]): number | null {
  const dt = b[2] - a[2];
  if (dt <= 0) return null;
  return distanceKm([a[0], a[1]], [b[0], b[1]]) / 1.852 / (dt / 3600);
}

const speedToken = (kn: number | null): MapToken => (kn === null ? '--map-ship-other' : kn < 0.5 ? '--map-seismic-low' : kn < 12 ? '--map-ship-cargo' : '--map-alt-high');

interface Segment {
  from: [number, number];
  to: [number, number];
  kn: number | null;
}

export default function MaritimeLayer() {
  const data = useFeedData<MaritimeResponse>('maritime', '/api/maritime', (b) => b.ports.length + b.vessels.length);
  const ports = data?.ports;
  const chokes = data?.chokepoints;
  const vessels = data?.vessels;

  const refLayers = useMemo(() => {
    if (!ports || !chokes) return null;
    return [
      new ScatterplotLayer<Port>({
        id: 'tn-ports',
        data: ports,
        getPosition: (p) => [p.lng, p.lat],
        getRadius: (p) => (p.dataset === 'curated' ? 4.5 : 2.5),
        radiusUnits: 'pixels',
        getFillColor: (p) => readCssColor(p.type === 'naval' ? '--map-port-naval' : p.type === 'energy' ? '--map-port-energy' : '--map-port', 0.85),
        getLineColor: readCssColor('--map-port', 0.5),
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 1,
        pickable: true,
        autoHighlight: true,
      }),
      new ScatterplotLayer<Chokepoint>({
        id: 'tn-chokepoints',
        data: chokes,
        getPosition: (c) => [c.lng, c.lat],
        getRadius: 7,
        radiusUnits: 'pixels',
        filled: false,
        stroked: true,
        getLineColor: (c) => readCssColor(CHOKE_TOKEN[c.risk], 1),
        lineWidthUnits: 'pixels',
        getLineWidth: 2,
        pickable: true,
      }),
    ];
  }, [ports, chokes]);
  useDeckLayers('maritime:reference', refLayers, Z - 1);
  useDeckPick('tn-ports', (info) => {
    const p = info.object as Port | undefined;
    return p ? { kind: 'port', id: p.id, layer: 'maritime', source: p.source, observedAt: null, data: p as unknown as Record<string, unknown>, lngLat: [p.lng, p.lat] } : null;
  });
  useDeckPick('tn-chokepoints', (info) => {
    const c = info.object as Chokepoint | undefined;
    return c ? { kind: 'chokepoint', id: c.id, layer: 'maritime', source: 'curated', observedAt: null, data: c as unknown as Record<string, unknown>, lngLat: [c.lng, c.lat] } : null;
  });

  const layers = useMemo(() => {
    if (!vessels?.length) return null;
    const segments: Segment[] = [];
    for (const v of vessels)
      for (let i = 1; i < v.track.length; i++) segments.push({ from: [v.track[i - 1]![0], v.track[i - 1]![1]], to: [v.track[i]![0], v.track[i]![1]], kn: segmentKnots(v.track[i - 1]!, v.track[i]!) });
    return [
      new LineLayer<Segment>({
        id: 'tn-vessel-tracks',
        data: segments,
        getSourcePosition: (s) => s.from,
        getTargetPosition: (s) => s.to,
        getColor: (s) => readCssColor(speedToken(s.kn), 0.7),
        getWidth: 1.5,
        widthUnits: 'pixels',
        parameters: { cullMode: 'none' },
        antialiasing: true,
      } as ConstructorParameters<typeof LineLayer<Segment>>[0]),
      new ScatterplotLayer<Vessel>({
        id: 'tn-vessels',
        data: vessels,
        getPosition: (v) => [v.lng, v.lat],
        getRadius: (v) => (v.type === 'military' ? 4 : 3),
        radiusUnits: 'pixels',
        getFillColor: (v) => readCssColor(SHIP_TOKEN[v.type], 0.9),
        pickable: true,
        autoHighlight: true,
      }),
    ];
  }, [vessels]);
  useDeckLayers('maritime:vessels', layers, Z);
  useDeckPick('tn-vessels', (info) => {
    const v = info.object as Vessel | undefined;
    return v ? { kind: 'vessel', id: v.id, layer: 'maritime', source: 'aisstream', observedAt: v.observedAt, data: v as unknown as Record<string, unknown>, lngLat: [v.lng, v.lat] } : null;
  });
  return null;
}
