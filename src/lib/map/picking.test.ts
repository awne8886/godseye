import { afterEach, describe, expect, it } from 'vitest';
import type { Selection } from '@/lib/layer-host';
import {
  candidatesFromDeck,
  candidatesFromNative,
  getPickOverlay,
  nativePickLayerIds,
  registerDeckPick,
  registerNativePick,
  resetPicking,
  routePick,
  setPickOverlay,
  type DeckPickInfo,
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
