'use client';
/**
 * NASA FIRMS fires: up to 30 000 FRP-ranked pixels drawn from FIRE_FIELDS columnar rows through
 * binary attributes (typed arrays, no per-row objects), radius by FRP and opacity by confidence;
 * EONET open wildfire events as ringed markers. On the globe both draw without the depth test (the
 * surface clipped them) and only on the camera-facing side: the full columns are built once per
 * snapshot and compacted to the facing rows per camera (globe.tsx). Owner: layers-hazards.
 */
import { ScatterplotLayer } from '@deck.gl/layers';
import { useEffect, useMemo } from 'react';
import { LAYERS } from '@/lib/layer-registry';
import { useDeckLayers, useFeedEventStore } from '@/lib/layer-host';
import { readCssColor } from '@/lib/tokens';
import type { FiresResponse, WeatherEvent } from '@/lib/types';
import { FIRE_CONFIDENCE_ALPHA, FIRE_IDX as IDX, fireEvents, fireRadiusPx, fireRowObject } from '../shared';
import { nearestPoint, useHitTester } from './hit-test';
import { DrawnStatus, GLOBE_POINT_PARAMETERS, facingIndices, unitVectors, useFacing, useFarSideCamera } from './globe';
import { entitySelection } from './pick';
import { useHazardData } from './useHazardData';

const Z = LAYERS.find((l) => l.id === 'fires')!.z;
const count = (b: FiresResponse) => b.rows.length;

export default function FireLayer() {
  const data = useHazardData<FiresResponse>('fires', '/api/fires', count);
  const push = useFeedEventStore((s) => s.push);

  useEffect(() => {
    if (!data) return;
    push(fireEvents(data.rows.slice(0, 50).map(fireRowObject)));
  }, [data, push]);

  // Full columns once per snapshot (positions, FRP radii, confidence alpha, unit vectors).
  const columns = useMemo(() => {
    if (!data) return null;
    const rows = data.rows;
    const n = rows.length;
    const positions = new Float32Array(n * 2);
    const radii = new Float32Array(n);
    const colors = new Uint8Array(n * 4);
    const [r, g, b] = readCssColor('--map-fire');
    for (let i = 0; i < n; i++) {
      const row = rows[i]!;
      positions[i * 2] = row[IDX.lng] as number;
      positions[i * 2 + 1] = row[IDX.lat] as number;
      radii[i] = fireRadiusPx(row[IDX.frpMw] as number | null);
      colors[i * 4] = r;
      colors[i * 4 + 1] = g;
      colors[i * 4 + 2] = b;
      colors[i * 4 + 3] = Math.round(255 * FIRE_CONFIDENCE_ALPHA[row[IDX.confidence] as keyof typeof FIRE_CONFIDENCE_ALPHA]);
    }
    const units = unitVectors(n, (i) => rows[i]![IDX.lng] as number, (i) => rows[i]![IDX.lat] as number);
    return { n, positions, radii, colors, units };
  }, [data]);

  const camera = useFarSideCamera();
  const facing = useMemo(() => (columns ? facingIndices(columns.units, camera) : null), [columns, camera]);
  const wildfires = useFacing(data?.wildfireEvents, camera);

  // The drawn (camera-facing) rows: compacted copies on the globe, the full columns in mercator.
  const drawn = useMemo(() => {
    if (!columns) return null;
    if (!facing) return columns;
    const m = facing.length;
    const positions = new Float32Array(m * 2);
    const radii = new Float32Array(m);
    const colors = new Uint8Array(m * 4);
    for (let k = 0; k < m; k++) {
      const i = facing[k]!;
      positions[k * 2] = columns.positions[i * 2]!;
      positions[k * 2 + 1] = columns.positions[i * 2 + 1]!;
      radii[k] = columns.radii[i]!;
      colors.set(columns.colors.subarray(i * 4, i * 4 + 4), k * 4);
    }
    return { n: m, positions, radii, colors };
  }, [columns, facing]);

  const layers = useMemo(() => {
    if (!drawn) return null;
    return [
      new ScatterplotLayer({
        id: 'hazards-fires',
        data: { length: drawn.n, attributes: { getPosition: { value: drawn.positions, size: 2 }, getRadius: { value: drawn.radii, size: 1 }, getFillColor: { value: drawn.colors, size: 4, normalized: true } } },
        radiusUnits: 'pixels',
        billboard: true,
        parameters: GLOBE_POINT_PARAMETERS,
        pickable: true,
        autoHighlight: true,
      }),
      new ScatterplotLayer<WeatherEvent>({
        id: 'hazards-wildfire-events',
        data: wildfires ?? [],
        getPosition: (e) => [e.lng, e.lat],
        getRadius: 9,
        radiusUnits: 'pixels',
        filled: false,
        stroked: true,
        getLineColor: readCssColor('--map-volcano', 0.9),
        getLineWidth: 2,
        lineWidthUnits: 'pixels',
        billboard: true,
        parameters: GLOBE_POINT_PARAMETERS,
        pickable: true,
      }),
    ];
  }, [drawn, wildfires]);

  useDeckLayers('hazards:fires', layers, Z);
  useHitTester('fires', (map, e) => {
    if (!data) return null;
    const wf = nearestPoint(map, e, data.wildfireEvents ?? [], (w) => [w.lng, w.lat], () => 9);
    if (wf) return { layer: 'fires', distancePx: wf.distancePx, selection: entitySelection('weather_event', 'fires', wf.item, wf.item as unknown as Record<string, unknown>) };
    const hit = nearestPoint(map, e, data.rows, (r) => [r[IDX.lng] as number, r[IDX.lat] as number], (r) => fireRadiusPx(r[IDX.frpMw] as number | null));
    if (!hit) return null;
    const o = fireRowObject(hit.item);
    return { layer: 'fires', distancePx: hit.distancePx, selection: entitySelection('fire', 'fires', o, o) };
  });
  return <DrawnStatus layer="fires" drawn={drawn?.n ?? 0} total={columns?.n ?? 0} camera={camera} />;
}
