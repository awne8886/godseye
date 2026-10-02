// @vitest-environment jsdom
/**
 * Verification round 6 (MAJOR): Ghost Protocol and Style Studio rewrite `--map-cctv` / `--map-news`
 * without changing the preset `theme`, and the HUD announces it with `godseye:style`. The camera
 * points memoised on `theme` (updateTriggers too) and the news dots repainted on `theme` only, so
 * both kept the old colour until the next 30-min inventory refresh. Both now depend on
 * useStyleVersion(). Rows: the recorded Hong Kong TD fixture through the real adapter; channels:
 * the curated seed list through the real toChannel() (live state unknown, as before a check).
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toColumnar, type Cell } from '@/lib/columnar';
import { useDeckLayerStore, useMapInstanceStore } from '@/lib/layer-host';
import { MAP_STYLE_EVENT } from '@/lib/map/style-version';
import { CAMERA_FIELDS } from '@/lib/schemas/surveillance';
import * as A from '../server/adapters';
import { FX, text } from '../server/__fixtures__';
import { CHANNELS, toChannel } from '../server/live-news';

const { rows } = toColumnar(A.parseHongKong(text(FX.hktd)), CAMERA_FIELDS);
const items = CHANNELS.slice(0, 3).map((c) => toChannel(c, null));

vi.mock('./useCctv', () => ({ useCctv: (on: boolean) => (on ? { fields: [...CAMERA_FIELDS], rows, regionsLoaded: 1 } : null) }));
vi.mock('./useLiveNewsQuery', () => ({
  useLiveNewsQuery: () => ({ isPending: false, isError: false, data: { ok: true, body: { meta: { state: 'live', fetchedAt: null, observedAt: null, lastGoodAt: null, attribution: [] }, providers: {}, items } } }),
}));

const { default: SurveillanceLayer } = await import('./SurveillanceLayer');

function fakeMap() {
  const layers = new Set<string>();
  const sources = new Set<string>();
  const paints: [string, string, unknown][] = [];
  const map = {
    paints,
    getZoom: () => 4,
    on: () => undefined,
    off: () => undefined,
    getCanvas: () => ({ style: {} }),
    getStyle: () => ({ layers: [] }),
    getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
    getSource: (id: string) => (sources.has(id) ? { id, setData: () => undefined } : undefined),
    addSource: (id: string) => void sources.add(id),
    removeSource: (id: string) => void sources.delete(id),
    addLayer: (l: { id: string }) => void layers.add(l.id),
    removeLayer: (id: string) => void layers.delete(id),
    setPaintProperty: (id: string, k: string, v: unknown) => void paints.push([id, k, v]),
  };
  return map;
}

interface PointsLayer {
  props: { data: Cell[][]; getFillColor: (r: Cell[]) => number[]; updateTriggers: Record<string, unknown> };
}
const cctvLayer = () => useDeckLayerStore.getState().entries['surveillance:cctv']?.layers?.[0] as unknown as PointsLayer;

const restyle = (token: string, value: string) =>
  act(() => {
    document.documentElement.style.setProperty(token, value);
    window.dispatchEvent(new CustomEvent(MAP_STYLE_EVENT));
  });

beforeEach(() => {
  useDeckLayerStore.setState({ entries: {}, version: 0 });
});
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('style');
  useMapInstanceStore.setState({ map: null, projection: 'globe', ready: false });
});

describe('surveillance colours follow Style Studio / Ghost Protocol (style version)', () => {
  it('a style-version bump re-runs the camera colour accessors on the same rows', () => {
    const map = fakeMap();
    useMapInstanceStore.setState({ map: map as never, projection: 'mercator', ready: true });
    render(<SurveillanceLayer active={new Set(['cctv'])} />);
    const before = cctvLayer();
    expect(before.props.data.length).toBe(rows.length);
    const row = before.props.data[0]!;

    restyle('--map-cctv', '#b388ff');
    const after = cctvLayer();
    // Same rows (no refetch), new trigger: deck recomputes the colour attribute in place.
    expect(after.props.data).toBe(before.props.data);
    expect(after.props.updateTriggers.getFillColor).not.toEqual(before.props.updateTriggers.getFillColor);
    expect(after.props.updateTriggers.getLineColor).not.toEqual(before.props.updateTriggers.getLineColor);
    expect(after.props.getFillColor(row).slice(0, 3)).toEqual([0xb3, 0x88, 0xff]);
  });

  it('a style-version bump repaints the live-news dots in place', () => {
    const map = fakeMap();
    useMapInstanceStore.setState({ map: map as never, projection: 'mercator', ready: true });
    render(<SurveillanceLayer active={new Set(['live_news'])} />);
    map.paints.length = 0;
    restyle('--map-news', '#ff00aa');
    expect(map.paints).toContainEqual(['surveillance-live-news-dots', 'circle-color', 'rgba(255,0,170,0.902)']);
    expect(map.paints).toContainEqual(['surveillance-live-news-dots', 'circle-stroke-color', 'rgba(255,0,170,1.000)']);
  });
});
