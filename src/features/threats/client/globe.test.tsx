// @vitest-environment jsdom
/**
 * visual-qa round 5 MAJOR-1: the flat ScatterplotLayers of the threats, network and maritime
 * modules were depth-tested against the globe surface and came out half-clipped or missing (malware
 * at z5–z9, quake-style half discs). Every point layer now draws with `depthCompare: 'always'` and
 * `cullMode: 'none'`, and — because the globe no longer hides them — carries only the points on the
 * camera-facing hemisphere, so far-side points are neither drawn nor picked. Data: recorded IODA
 * events (2026-09-30), the recorded GDELT 20:00 batch (2026-09-30) and the bundled maritime
 * reference answer (no network).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createElement, type ComponentType } from 'react';
import type { Layer } from '@deck.gl/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as maritimeGet } from '@/app/api/maritime/route';
import MaritimeLayer from '@/features/maritime/client/MaritimeLayer';
import { maritimeFeed, resetAis } from '@/features/maritime/server/maritime';
import NetworkLayer from '@/features/network/client/NetworkLayer';
import { mapIoda } from '@/features/network/server/outages';
import type { LayerComponentProps } from '@/lib/feature-module';
import type { LayerId } from '@/lib/layer-registry';
import { useDeckLayerStore, useLayerStatusStore, useMapInstanceStore } from '@/lib/layer-host';
import { isFacing, type FarSideCamera } from '@/lib/map/far-side';
import { candidatesFromDeck } from '@/lib/map/picking';
import type { MaritimeResponse } from '@/lib/types';
import { fixture, FX } from '../server/__fixtures__';
import { freshCache, req, resetCache } from '../server/__fixtures__/routes';
import { parseExport } from '../server/gdelt';
import { unzipFirst } from '../server/zip';
import { facingSubset, GLOBE_POINT_PARAMETERS, lngLatOf } from './globe';
import ThreatsLayer, { GDELT_EVENTS_URL } from './ThreatsLayer';

const at = '2026-09-30T20:00:00.000Z';
const envelope = (feed: string) => ({ meta: { feed, kind: 'live', state: 'live', fetchedAt: at, observedAt: at, lastGoodAt: at, stale: false, ttlSeconds: 300, attribution: [] }, providers: {} });

const ioda = JSON.parse(fixture(FX.ioda).toString('utf8')) as { data: Parameters<typeof mapIoda>[0]; requestParameters: { until: string } };
const outages = mapIoda(ioda.data, Number(ioda.requestParameters.until));
const events = parseExport(unzipFirst(fixture(FX.gdeltZip)).data.toString('utf8')).events;
let maritime: MaritimeResponse;

beforeAll(async () => {
  freshCache();
  resetAis();
  delete process.env.AIS_API_KEY;
  maritime = (await (await maritimeGet(req('/api/maritime'), undefined)).json()) as MaritimeResponse;
  maritimeFeed.stop();
  resetCache();
});

// ── A MapLibre stand-in with a movable globe camera ──────────────────────────────
type Handler = () => void;
function fakeMap(camera: FarSideCamera) {
  const handlers = new Map<string, Set<Handler>>();
  const cam = { ...camera };
  return {
    cam,
    transform: { getCameraLngLat: () => ({ lng: cam.lng, lat: cam.lat }), getCameraAltitude: () => cam.altitude },
    getCenter: () => ({ lng: cam.lng, lat: cam.lat }),
    getZoom: () => 2,
    getCanvas: () => ({ clientHeight: 800, style: {} }),
    on: (e: string, f: Handler) => void (handlers.get(e) ?? handlers.set(e, new Set()).get(e)!).add(f),
    off: (e: string, f: Handler) => void handlers.get(e)?.delete(f),
    fire: (e: string) => [...(handlers.get(e) ?? [])].forEach((f) => f()),
  };
}

// Over the Atlantic at ~8 000 km: the horizon is ~64° away, so roughly a third of the world faces.
const ATLANTIC: FarSideCamera = { lng: -30, lat: 20, altitude: 8_000_000 };
const PACIFIC: FarSideCamera = { lng: 150, lat: -20, altitude: 8_000_000 };

function serve(bodies: Record<string, unknown>) {
  const f = vi.fn(async (u: string) => {
    const hit = Object.entries(bodies).find(([k]) => u.startsWith(k));
    return hit ? new Response(JSON.stringify(hit[1]), { status: 200 }) : new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', f);
  return f;
}

function mount(Comp: ComponentType<LayerComponentProps>, active: LayerId[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(createElement(QueryClientProvider, { client }, createElement(Comp, { active: new Set(active) })));
}

const deckLayers = (key: string) => (useDeckLayerStore.getState().entries[key]?.layers ?? []) as Layer[];
const layerById = (key: string, id: string) => deckLayers(key).find((l) => l.id === id);
const dataOf = <T,>(key: string, id: string) => (layerById(key, id)?.props.data ?? []) as readonly T[];
const facingIds = <T extends { id: string; lat: number; lng: number }>(items: readonly T[], cam: FarSideCamera | null) => items.filter((t) => isFacing([t.lng, t.lat], cam)).map((t) => t.id);

let map: ReturnType<typeof fakeMap>;
beforeEach(() => {
  map = fakeMap(ATLANTIC);
  useMapInstanceStore.setState({ map: map as never, projection: 'globe', ready: true });
  useDeckLayerStore.setState({ entries: {} });
  useLayerStatusStore.setState({ status: {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('facingSubset (pure)', () => {
  const pts = [
    { id: 'lisbon', lng: -9.14, lat: 38.72 },
    { id: 'dakar', lng: -17.45, lat: 14.69 },
    { id: 'sydney', lng: 151.21, lat: -33.87 },
    { id: 'tokyo', lng: 139.69, lat: 35.68 },
  ];
  it('keeps the camera-facing points, drops the far side, and returns everything in mercator', () => {
    expect(facingSubset(pts, lngLatOf, ATLANTIC).map((p) => p.id)).toEqual(['lisbon', 'dakar']);
    expect(facingSubset(pts, lngLatOf, PACIFIC).map((p) => p.id)).toEqual(['sydney', 'tokyo']);
    expect(facingSubset(pts, lngLatOf, null)).toBe(pts);
  });
  it('returns the same array while the visible set is unchanged, a new one when it changes', () => {
    const a = facingSubset(pts, lngLatOf, ATLANTIC);
    const b = facingSubset(pts, lngLatOf, { ...ATLANTIC, lng: -29 });
    expect(b).toBe(a);
    const c = facingSubset(pts, lngLatOf, PACIFIC);
    expect(c).not.toBe(a);
    // Everything facing: the input itself, no copy.
    const near = pts.slice(0, 2);
    expect(facingSubset(near, lngLatOf, ATLANTIC)).toBe(near);
  });
});

describe('point layers draw over the globe and only on the facing hemisphere (visual-qa r5 MAJOR-1)', () => {
  it('outages: depthCompare always + cullMode none; far-side outages are neither drawn nor pickable; refiltered on moveend', async () => {
    serve({ '/api/outages': { items: outages, ...envelope('outages') } });
    await act(async () => {
      mount(NetworkLayer, ['cf_outages']);
    });
    await waitFor(() => expect(layerById('network:outages', 'tn-outages')).toBeDefined());
    const layer = layerById('network:outages', 'tn-outages')!;
    expect(layer.props.parameters).toEqual(GLOBE_POINT_PARAMETERS);
    expect(GLOBE_POINT_PARAMETERS).toEqual({ cullMode: 'none', depthCompare: 'always' });
    const atlantic = facingIds(outages, ATLANTIC);
    expect(atlantic.length).toBeGreaterThan(0);
    expect(atlantic.length).toBeLessThan(outages.length);
    expect(dataOf<{ id: string }>('network:outages', 'tn-outages').map((o) => o.id)).toEqual(atlantic);
    // The rail still counts every outage the feed served (drawing is a view, the count is the data).
    expect(useLayerStatusStore.getState().status.cf_outages?.count).toBe(outages.length);
    // The camera turns to the Pacific: the layer follows on moveend.
    await act(async () => {
      Object.assign(map.cam, PACIFIC);
      map.fire('moveend');
    });
    await waitFor(() => expect(dataOf<{ id: string }>('network:outages', 'tn-outages').map((o) => o.id)).toEqual(facingIds(outages, PACIFIC)));
    // Mercator: every outage.
    await act(async () => {
      useMapInstanceStore.setState({ projection: 'mercator' });
    });
    await waitFor(() => expect(dataOf('network:outages', 'tn-outages')).toHaveLength(outages.length));
  });

  it('throttles refilters while the camera moves (≤ 10 Hz) and settles on moveend', async () => {
    serve({ '/api/outages': { items: outages, ...envelope('outages') } });
    await act(async () => {
      mount(NetworkLayer, ['cf_outages']);
    });
    await waitFor(() => expect(layerById('network:outages', 'tn-outages')).toBeDefined());
    const ids = () => dataOf<{ id: string }>('network:outages', 'tn-outages').map((o) => o.id);
    const before = facingIds(outages, ATLANTIC);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      // A settled camera (moveend) refilters at once.
      await act(async () => map.fire('moveend'));
      expect(ids()).toEqual(before);
      // Moving within 100 ms of that refilter: wait for the throttle window, however many moves.
      await act(async () => {
        Object.assign(map.cam, PACIFIC);
        map.fire('move');
        map.fire('move');
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(ids()).toEqual(before);
      await act(async () => {
        map.fire('move');
        await vi.advanceTimersByTimeAsync(60);
      });
      expect(ids()).toEqual(facingIds(outages, PACIFIC));
    } finally {
      vi.useRealTimers();
    }
  });

  it('GDELT events: whole window requested, drawn over the globe on the facing side; a far-side event is not pickable', async () => {
    const f = serve({ '/api/gdelt-events': { items: events, total: events.length + 250, truncated: true, window: { from: at, to: at, batches: 1 }, scanned: 1233, ...envelope('gdelt-events') } });
    await act(async () => {
      mount(ThreatsLayer, ['gdelt_events']);
    });
    await waitFor(() => expect(layerById('threats:gdelt', 'tn-gdelt')).toBeDefined());
    expect(f.mock.calls.map((c) => (c as unknown[])[0])).toEqual([GDELT_EVENTS_URL]);
    expect(GDELT_EVENTS_URL).toBe('/api/gdelt-events?limit=5000');
    const layer = layerById('threats:gdelt', 'tn-gdelt')!;
    expect(layer.props.parameters).toEqual(GLOBE_POINT_PARAMETERS);
    const drawn = dataOf<{ id: string; lat: number; lng: number }>('threats:gdelt', 'tn-gdelt');
    expect(new Set(drawn.map((e) => e.id))).toEqual(new Set(facingIds(events, ATLANTIC)));
    expect(drawn.every((e) => isFacing([e.lng, e.lat], ATLANTIC))).toBe(true);
    // Picking resolves only what the layer holds; its card says how much of the window is drawn.
    const sel = candidatesFromDeck([{ object: drawn[0], layer: { id: 'tn-gdelt', props: {} } }])[0]!.selection;
    expect(sel.layer).toBe('gdelt_events');
    expect(sel.data.windowCoverage).toEqual({ served: events.length, total: events.length + 250 });
  });

  it('maritime: ports and chokepoints over the globe, facing side only', async () => {
    serve({ '/api/maritime': maritime });
    await act(async () => {
      mount(MaritimeLayer, ['maritime']);
    });
    await waitFor(() => expect(layerById('maritime:reference', 'tn-ports')).toBeDefined());
    for (const id of ['tn-ports', 'tn-chokepoints']) expect(layerById('maritime:reference', id)!.props.parameters).toEqual(GLOBE_POINT_PARAMETERS);
    expect(dataOf<{ id: string }>('maritime:reference', 'tn-ports').map((p) => p.id)).toEqual(facingIds(maritime.ports, ATLANTIC));
    expect(dataOf<{ id: string }>('maritime:reference', 'tn-chokepoints').map((c) => c.id)).toEqual(facingIds(maritime.chokepoints, ATLANTIC));
    expect(facingIds(maritime.ports, ATLANTIC).length).toBeLessThan(maritime.ports.length);
  });

  it('every ScatterplotLayer in the three modules uses the globe parameters and facing data', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const file of ['src/features/threats/client/ThreatsLayer.tsx', 'src/features/network/client/NetworkLayer.tsx', 'src/features/maritime/client/MaritimeLayer.tsx']) {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      const blocks = src.split('new ScatterplotLayer').slice(1);
      expect(blocks.length).toBeGreaterThan(0);
      for (const b of blocks) expect(b.slice(0, 400), file).toContain('parameters: GLOBE_POINT_PARAMETERS');
    }
  });
});
