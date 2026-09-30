import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Selection } from '@/lib/layer-host';
import { EARTH_RADIUS_M, isFacing } from './far-side';
import {
  collectCandidates,
  registerDeckPick,
  registerHitTester,
  registerNativePick,
  resetPicking,
  routePick,
  setPickOverlay,
  type PickMap,
} from './picking';

const sel = (layer: Selection['layer'], id: string, lngLat: [number, number] = [0, 0], kind: Selection['kind'] = 'aircraft'): Selection => ({
  kind,
  id,
  layer,
  source: 'test',
  observedAt: null,
  data: {},
  lngLat,
});

function fakeMap(features: { layer: { id: string }; properties: Record<string, unknown> }[] = []): PickMap {
  return {
    project: ([lng, lat]) => ({ x: lng, y: lat }),
    unproject: ([x, y]) => ({ lng: x, lat: y, wrap: () => ({ lng: x, lat: y }) }),
    getZoom: () => 3,
    getCenter: () => ({ lng: 0, lat: 0 }),
    getLayer: (id) => (features.some((f) => f.layer.id === id) ? { id } : undefined),
    queryRenderedFeatures: vi.fn(() => features),
  };
}

afterEach(() => resetPicking());

describe('the single click router', () => {
  it('arbitrates across deck, native and CPU hit-test candidates by registry pickPriority', () => {
    setPickOverlay({
      pickMultipleObjects: () => [{ object: { id: 25544 }, index: 0, layer: { id: 'space-satellites', props: {} } }],
      pickObject: () => null,
    });
    registerDeckPick('space', () => sel('satellites', '25544', [0, 0], 'satellite'));
    registerNativePick('gdacs-dots', () => sel('global_incidents', 'EQ1', [0, 0], 'gdacs_incident'));
    registerHitTester('aviation', () => [{ layer: 'flights', selection: sel('flights', 'a1b2c3'), distancePx: 6 }]);
    registerHitTester('hazards', () => [{ layer: 'earthquakes', selection: sel('earthquakes', 'us7000', [0, 0], 'earthquake'), distancePx: 1 }]);
    const map = fakeMap([{ layer: { id: 'gdacs-dots' }, properties: {} }]);
    const candidates = collectCandidates(map, { x: 10, y: 10 });
    expect(candidates.map((c) => c.layer).sort()).toEqual(['earthquakes', 'flights', 'global_incidents', 'satellites']);
    // Aircraft (100) beat quakes (70), incidents (62) and satellites (40), even when farther away.
    expect(routePick(candidates)?.id).toBe('a1b2c3');
  });

  it('picks the nearest hit within one priority, else the top-most', () => {
    registerHitTester('aviation', () => [
      { layer: 'flights', selection: sel('flights', 'far'), distancePx: 9 },
      { layer: 'military', selection: sel('military', 'near'), distancePx: 2 },
    ]);
    expect(routePick(collectCandidates(fakeMap(), { x: 0, y: 0 }))?.id).toBe('near');
    expect(routePick([{ layer: 'flights', selection: sel('flights', 'top') }, { layer: 'jets', selection: sel('jets', 'under') }])?.id).toBe('top');
  });

  it('drops candidates behind the globe before arbitration', () => {
    const cam = { lng: 0, lat: 0, altitude: EARTH_RADIUS_M }; // horizon 60°
    registerHitTester('aviation', () => [{ layer: 'flights', selection: sel('flights', 'antipode', [180, 0]), distancePx: 1 }]);
    registerHitTester('hazards', () => [{ layer: 'earthquakes', selection: sel('earthquakes', 'front', [10, 0], 'earthquake'), distancePx: 3 }]);
    const c = collectCandidates(fakeMap(), { x: 0, y: 0 }, { facing: (p) => isFacing(p, cam) });
    expect(c.map((x) => x.selection.id)).toEqual(['front']);
    expect(routePick(c)?.id).toBe('front');
  });

  it('yields one selection per click even when a module is also GPU-picked', () => {
    const select = vi.fn();
    setPickOverlay({
      pickMultipleObjects: () => [{ object: {}, index: 0, layer: { id: 'aviation-icons', props: { toSelection: () => sel('flights', 'a1b2c3') } } }],
      pickObject: () => null,
    });
    registerHitTester('aviation', () => [{ layer: 'flights', selection: sel('flights', 'a1b2c3'), distancePx: 0 }]);
    const s = routePick(collectCandidates(fakeMap(), { x: 0, y: 0 }));
    if (s) select(s);
    expect(select).toHaveBeenCalledTimes(1);
    expect(select.mock.calls[0]![0].id).toBe('a1b2c3');
  });

  it('hover asks deck for the top object only; failures and throwing testers are misses', () => {
    const pickObject = vi.fn(() => ({ object: {}, index: 0, layer: { id: 'x', props: { toSelection: () => sel('cctv', 'cam1', [0, 0], 'camera') } } }));
    const pickMultipleObjects = vi.fn(() => {
      throw new Error('deck not initialised');
    });
    setPickOverlay({ pickObject, pickMultipleObjects });
    registerHitTester('broken', () => {
      throw new Error('mid-update');
    });
    expect(collectCandidates(fakeMap(), { x: 1, y: 1 }, { hover: true }).map((c) => c.selection.id)).toEqual(['cam1']);
    expect(pickMultipleObjects).not.toHaveBeenCalled();
    expect(collectCandidates(fakeMap(), { x: 1, y: 1 })).toEqual([]);
  });

  it('unregisters hit-testers without dropping a newer registration', () => {
    const off = registerHitTester('a', () => []);
    registerHitTester('a', () => [{ layer: 'flights', selection: sel('flights', 'new') }]);
    off();
    expect(collectCandidates(fakeMap(), { x: 0, y: 0 }).map((c) => c.selection.id)).toEqual(['new']);
  });
});
