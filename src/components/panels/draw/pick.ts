/**
 * Click → Selection for the RECON family's own map overlays: drawn shapes (`recon-draw`), the
 * planned route and its alternates (`recon-route`, `recon-route-casing`, `recon-route-alternates`)
 * and imported ArcGIS layers (`recon-arcgis-<id>`). Every result is kind `drawn_shape` with
 * `layer: null` (no registry layer, so they lose to any live entity under the same pixel) and
 * `observedAt: null` (local or user-imported data, never an observation). While a DRAW tool is
 * armed every resolver returns null, so drawing clicks never open a card.
 * The `data` record is small and flat: a few measured numbers or at most MAX_ATTRS primitive
 * attributes, strings capped at MAX_STR characters (rendered as text by DrawnShapeCard).
 * Pure (reads only the state passed in), unit-tested. Owner: panels-recon.
 */
import type { Selection } from '@/lib/layer-host';
import type { DeckPickInfo } from '@/lib/map/picking';
import type { ArcgisLayer, RouteState } from '../recon/overlay-store';
import { measure, type DrawFeature, type DrawShape } from './geometry';

export const DRAW_DECK_ID = 'recon-draw';
export const ROUTE_DECK_IDS = ['recon-route', 'recon-route-casing', 'recon-route-alternates'] as const;
export const arcgisDeckId = (layerId: string) => `recon-arcgis-${layerId}`;

export const MAX_ATTRS = 24;
export const MAX_STR = 300;

export interface PickState {
  drawMode: DrawShape | null;
  features: readonly DrawFeature[];
  route: RouteState | null;
  arcgis: readonly ArcgisLayer[];
}

/** The clicked map coordinate ([lng, lat]) or null when deck did not report one. */
function clickLngLat(info: DeckPickInfo): [number, number] | null {
  const c = info.coordinate;
  if (!c || c.length < 2) return null;
  const [lng, lat] = c as [number, number];
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
}

const vertexCount = (g: DrawFeature['geometry']): number =>
  g.type === 'Point' ? 1 : g.type === 'LineString' ? g.coordinates.length : Math.max(0, (g.coordinates[0]?.length ?? 1) - 1);

/** A drawn shape (point, line, polygon, circle) from the DRAW tool or a GeoJSON import. */
export function drawnShapeSelection(info: DeckPickInfo, st: PickState): Selection | null {
  if (st.drawMode) return null;
  const picked = info.object as DrawFeature | undefined;
  const id = picked?.properties?.id;
  if (typeof id !== 'string') return null;
  // The store's copy (renames / AOI toggles after the layer was built).
  const f = st.features.find((x) => x.properties.id === id);
  if (!f) return null;
  const m = measure(f);
  return {
    kind: 'drawn_shape',
    id,
    layer: null,
    source: 'local',
    observedAt: null,
    lngLat: clickLngLat(info),
    data: {
      type: 'drawn',
      featureId: id,
      name: f.properties.name,
      shape: f.properties.shape,
      aoi: f.properties.aoi === true,
      vertices: vertexCount(f.geometry),
      lengthM: m.lengthM,
      areaM2: m.areaM2,
      perimeterM: m.perimeterM,
      radiusM: m.radiusM,
    },
  };
}

/** The active route (line or casing) or one of its alternates. */
export function routeSelection(info: DeckPickInfo, st: PickState): Selection | null {
  if (st.drawMode || !st.route) return null;
  const i = (info.object as { i?: unknown } | undefined)?.i;
  if (typeof i !== 'number') return null;
  const { result, active } = st.route;
  const r = result.routes[i];
  if (!r) return null;
  return {
    kind: 'drawn_shape',
    id: 'route',
    layer: null,
    source: `directions:${result.engine}`,
    observedAt: null,
    lngLat: clickLngLat(info),
    data: {
      type: 'route',
      name: i === active ? 'Planned route' : `Alternate route ${i}`,
      routeIndex: i,
      active: i === active,
      routes: result.routes.length,
      engine: result.engine,
      mode: result.mode,
      distanceM: r.distanceM,
      durationS: r.durationS,
      steps: r.steps.length,
      hasToll: r.hasToll,
      hasHighway: r.hasHighway,
      hasFerry: r.hasFerry,
      ascentM: i === 0 ? result.ascentM : null,
      descentM: i === 0 ? result.descentM : null,
      attribution: result.attribution,
      computedAt: result.timestamp,
    },
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

/** Primitive attributes only, at most MAX_ATTRS, long strings cut (an upstream record is never dumped whole). */
export function smallAttributes(props: Record<string, unknown> | null | undefined): { attributes: Record<string, string | number | boolean | null>; omitted: number } {
  const attributes: Record<string, string | number | boolean | null> = {};
  let n = 0;
  let omitted = 0;
  for (const [k, v] of Object.entries(props ?? {})) {
    const ok = v === null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string';
    if (!ok || n >= MAX_ATTRS) {
      omitted++;
      continue;
    }
    attributes[k.slice(0, 64)] = typeof v === 'string' && v.length > MAX_STR ? `${v.slice(0, MAX_STR)}…` : (v as string | number | boolean | null);
    n++;
  }
  return { attributes, omitted };
}

/** A feature of an imported ArcGIS Feature Service layer. */
export function arcgisSelection(layer: ArcgisLayer, info: DeckPickInfo, st: Pick<PickState, 'drawMode'>): Selection | null {
  if (st.drawMode) return null;
  const f = info.object as GeoJSON.Feature | undefined;
  if (!f || typeof f !== 'object' || f.type !== 'Feature') return null;
  const idx = typeof info.index === 'number' && info.index >= 0 ? info.index : layer.fc.features.indexOf(f);
  if (idx < 0) return null;
  const { attributes, omitted } = smallAttributes(f.properties);
  const label = ['name', 'NAME', 'Name', 'title', 'TITLE', 'label'].map((k) => attributes[k]).find((v) => typeof v === 'string' && v.trim());
  return {
    kind: 'drawn_shape',
    id: `arcgis:${layer.id}:${idx}`,
    layer: null,
    source: `arcgis:${hostOf(layer.source)}`,
    observedAt: null,
    lngLat: clickLngLat(info),
    data: {
      type: 'arcgis',
      name: typeof label === 'string' ? label.trim().slice(0, 120) : `${layer.title.slice(0, 100)} #${idx + 1}`,
      layerId: layer.id,
      layerTitle: layer.title,
      serviceUrl: layer.source,
      featureIndex: idx,
      geometryType: f.geometry?.type ?? null,
      importedAt: layer.importedAt,
      attributes,
      omittedAttributes: omitted,
    },
  };
}
