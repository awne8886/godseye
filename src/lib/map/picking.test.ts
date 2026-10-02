import { afterEach, describe, expect, it } from 'vitest';
import type { Selection } from '@/lib/layer-host';
import {
  candidatesFromDeck,
  candidatesFromNative,
  collectCandidates,
  markContainsPointer,
  registerHitTester,
  getPickOverlay,
  nativePickLayerIds,
  registerDeckPick,
  registerNativePick,
  resetPicking,
  routePick,
  setPickOverlay,
  type DeckPickInfo,
  type PickMap,
} from './picking';

const sel = (layer: Selection['layer'], id: string, kind: Selection['kind'] = 'aircraft'): Selection => ({
  kind,
  id,
  layer,
  source: 'test',
  observedAt: null,
  data: {},
  lngLat: [0, 0],
});

afterEach(() => resetPicking());

describe('pick routing', () => {
  it('opens the highest registry pickPriority (aircraft 100 beats satellites 40 drawn above them)', () => {
    const picked = routePick([
      { layer: 'satellites', selection: sel('satellites', 'ISS', 'satellite') },
      { layer: 'flights', selection: sel('flights', 'a1b2c3') },
      { layer: 'country_risk', selection: sel('country_risk', 'UKR', 'country_risk') },
    ]);
    expect(picked?.id).toBe('a1b2c3');
  });

  it('breaks ties by order: the top-most candidate wins', () => {
    expect(routePick([{ layer: 'flights', selection: sel('flights', 'top') }, { layer: 'military', selection: sel('military', 'below') }])?.id).toBe('top');
  });

  it('returns null when nothing selectable is under the pointer', () => {
    expect(routePick([])).toBeNull();
  });

  it('resolves deck picks via the layer prop, the registry, or the parent id of sub-layers', () => {
    registerDeckPick('quakes', (info) => sel('earthquakes', String((info.object as { id: string }).id), 'earthquake'));
    const infos: DeckPickInfo[] = [
      { object: { id: 'own' }, layer: { id: 'aviation-icons', props: { toSelection: (i: DeckPickInfo) => sel('flights', (i.object as { id: string }).id) } } },
      { object: { id: 'us7000' }, layer: { id: 'quakes-rings', props: {} } },
      { object: { id: 'x' }, layer: { id: 'unregistered', props: {} } },
      { object: null, layer: { id: 'quakes', props: {} } },
      { object: { id: 'nolayer' } },
    ];
    const c = candidatesFromDeck(infos);
    expect(c.map((x) => [x.layer, x.selection.id])).toEqual([
      ['flights', 'own'],
      ['earthquakes', 'us7000'],
    ]);
  });

  it('resolves native features by style layer id and lists them for queryRenderedFeatures', () => {
    const off = registerNativePick('gdacs-dots', (f) => sel('global_incidents', String(f.properties?.id), 'gdacs_incident'));
    registerNativePick('news-dots', () => null); // not selectable
    expect(nativePickLayerIds().sort()).toEqual(['gdacs-dots', 'news-dots']);
    const c = candidatesFromNative([
      { layer: { id: 'gdacs-dots' }, properties: { id: 'EQ1' } },
      { layer: { id: 'news-dots' }, properties: {} },
      { layer: { id: 'water' }, properties: {} },
    ]);
    expect(c.map((x) => x.selection.id)).toEqual(['EQ1']);
    off();
    expect(nativePickLayerIds()).toEqual(['news-dots']);
  });

  it('keeps a newer registration when an old unregister runs late', () => {
    const off = registerDeckPick('a', () => null);
    registerDeckPick('a', () => sel('flights', 'new'));
    off();
    expect(candidatesFromDeck([{ object: {}, layer: { id: 'a', props: {} } }])[0]?.selection.id).toBe('new');
    const offNative = registerNativePick('b', () => null);
    registerNativePick('b', () => sel('flights', 'n'));
    offNative();
    expect(nativePickLayerIds()).toEqual(['b']);
  });

  it('publishes the overlay picking API', () => {
    const o = { pickMultipleObjects: () => [], pickObject: () => null };
    setPickOverlay(o);
    expect(getPickOverlay()).toBe(o);
  });
});

describe('declared drawn marks (round 8: the mark under the pointer wins)', () => {
  /** A flat map: 10 px per degree, origin at (0, 0). */
  const map: PickMap = {
    project: ([lng, lat]) => ({ x: lng * 10, y: -lat * 10 }),
    unproject: ([x, y]) => ({ lng: x / 10, lat: -y / 10, wrap: () => ({ lng: x / 10, lat: -y / 10 }) }),
    getZoom: () => 3,
    getCenter: () => ({ lng: 0, lat: 0 }),
    getLayer: () => undefined,
    queryRenderedFeatures: () => [],
  };
  const dot = { id: 'EGLL', position: [10, -10] as [number, number] }; // drawn at (100, 100)
  const dotLayer = { id: 'dots', props: { pickMarkPx: 7, getPosition: (d: typeof dot) => d.position, toSelection: () => sel(null, 'EGLL', 'airport') } };
  const ringLayer = { id: 'rings', props: { toSelection: () => sel('flights', 'DAL3') } };

  it('a pointer inside a declared mark beats a priority-100 aircraft that is only within the pick tolerance', () => {
    setPickOverlay({ pickMultipleObjects: () => [{ object: {}, index: 0, layer: ringLayer }, { object: dot, index: 0, layer: dotLayer }], pickObject: () => null });
    const at = collectCandidates(map, { x: 101, y: 100 });
    expect(at.find((c) => c.selection.id === 'EGLL')).toMatchObject({ distancePx: 1, markRadiusPx: 7 });
    expect(routePick(at)?.id).toBe('EGLL');
    // Outside the dot (8 px from its centre) the priority order applies again: the aircraft.
    expect(routePick(collectCandidates(map, { x: 108, y: 100 }))?.id).toBe('DAL3');
  });

  it('also beats CPU hit-test candidates (the aviation 14 px tolerance) that declare no mark', () => {
    registerHitTester('aviation', () => [{ layer: 'flights', selection: sel('flights', 'DAL3'), distancePx: 3 }]);
    setPickOverlay({ pickMultipleObjects: () => [{ object: dot, index: 0, layer: dotLayer }], pickObject: () => null });
    expect(routePick(collectCandidates(map, { x: 104, y: 103 }))?.id).toBe('EGLL');
  });

  it('several marks under the pointer: the nearest centre wins, then priority, then order', () => {
    const c = (id: string, layer: Selection['layer'], d: number, r = 7) => ({ layer: layer ?? '', selection: sel(layer, id), distancePx: d, markRadiusPx: r });
    expect(routePick([c('far', 'flights', 5), c('near', null, 2)])?.id).toBe('near');
    expect(routePick([c('low', null, 2), c('high', 'flights', 2)])?.id).toBe('high');
    expect(routePick([c('first', null, 2), c('second', null, 2)])?.id).toBe('first');
    // A mark that does not contain the pointer is just a candidate (priority order).
    expect(markContainsPointer(c('x', null, 7.5))).toBe(false);
    expect(markContainsPointer({ layer: 'flights', selection: sel('flights', 'y'), distancePx: 0 })).toBe(false);
    expect(routePick([c('outside', null, 7.5), { layer: 'flights', selection: sel('flights', 'plane'), distancePx: 3 }])?.id).toBe('plane');
  });

  it('a declared mark is measured from its drawn position (getPosition); bad positions or radii declare nothing', () => {
    const pointer = { point: { x: 100, y: 100 }, project: map.project };
    // An unwrapped antimeridian frame: the projection of the DRAWN longitude is used.
    const wrapped = { id: 'NZAA', position: [-185.2, -37] as [number, number] };
    const far = candidatesFromDeck([{ object: wrapped, layer: { ...dotLayer, props: { ...dotLayer.props, getPosition: (d: typeof wrapped) => d.position } } }], { point: { x: -1852, y: 370 }, project: map.project });
    expect(far[0]!.distancePx).toBeCloseTo(0, 6);
    for (const props of [
      { ...dotLayer.props, pickMarkPx: 0 },
      { ...dotLayer.props, pickMarkPx: '7' },
      { ...dotLayer.props, getPosition: () => null },
      { ...dotLayer.props, getPosition: () => {
        throw new Error('mid-update');
      } },
    ]) {
      const [c] = candidatesFromDeck([{ object: dot, layer: { id: 'dots', props } }], pointer);
      expect(c!.selection.id).toBe('EGLL');
      expect(c!.markRadiusPx).toBeUndefined();
    }
    // A constant position works too; without the pointer nothing is measured.
    expect(candidatesFromDeck([{ object: dot, layer: { id: 'dots', props: { ...dotLayer.props, getPosition: [10, -10] } } }], pointer)[0]!.distancePx).toBe(0);
    expect(candidatesFromDeck([{ object: dot, layer: dotLayer }])[0]!.markRadiusPx).toBeUndefined();
  });
});
