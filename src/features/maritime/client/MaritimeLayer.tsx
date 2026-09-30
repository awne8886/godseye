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
import type { MaritimeResponse, Vessel } from '@/lib/types';
import { pointsFc, rgbaCss, useDeckPick, useFeedData, useNativeLayers, useNativePick } from '../../threats/client/hooks';

const Z = LAYERS.find((l) => l.id === 'maritime')!.z;
const css = (token: MapToken, alpha = 1) => rgbaCss(readCssColor(token, alpha));

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

  const portFc = useMemo(() => (ports ? pointsFc(ports, (p) => ({ type: p.type, major: p.dataset === 'curated' })) : null), [ports]);
  const chokeFc = useMemo(() => (chokes ? pointsFc(chokes, (c) => ({ risk: c.risk })) : null), [chokes]);
  const portLayers = useMemo(
    () => [
      {
        id: 'tn-ports',
        type: 'circle' as const,
        filter: ['any', ['get', 'major'], ['>=', ['zoom'], 3]] as unknown as boolean,
        paint: {
          'circle-radius': ['case', ['get', 'major'], 4.5, 3] as unknown as number,
          'circle-color': ['match', ['get', 'type'], 'naval', css('--map-port-naval'), 'energy', css('--map-port-energy'), css('--map-port')] as unknown as string,
          'circle-stroke-color': css('--map-port', 0.5),
          'circle-stroke-width': 1,
          'circle-opacity': 0.85,
        },
      },
    ],
    [],
  );
  const chokeLayers = useMemo(
    () => [
      {
        id: 'tn-chokepoints',
        type: 'circle' as const,
        paint: {
          'circle-radius': 7,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': ['match', ['get', 'risk'], 'CRITICAL', css('--map-choke-critical'), 'HIGH', css('--map-choke-high'), 'ELEVATED', css('--map-choke-elevated'), css('--map-choke-low')] as unknown as string,
          'circle-stroke-width': 2,
        },
      },
    ],
    [],
  );
  useNativeLayers('tn-ports', portFc, portLayers);
  useNativeLayers('tn-chokepoints', chokeFc, chokeLayers);
  const pById = useMemo(() => new Map((ports ?? []).map((p) => [p.id, p])), [ports]);
  const cById = useMemo(() => new Map((chokes ?? []).map((c) => [c.id, c])), [chokes]);
  useNativePick(['tn-ports'], (id) => {
    const p = pById.get(id);
    return p ? { kind: 'port', id: p.id, layer: 'maritime', source: p.source, observedAt: null, data: p as unknown as Record<string, unknown>, lngLat: [p.lng, p.lat] } : null;
  });
  useNativePick(['tn-chokepoints'], (id) => {
    const c = cById.get(id);
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
