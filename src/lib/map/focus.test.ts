import { describe, expect, it } from 'vitest';
import { FOCUS_MAX_WAIT_MS } from './admission-scheduler';
import { admitLayers, createAdmissionState, flattenLayers, focusFirst } from './deck-admission';
import { FEATURE_MODULES } from '@/features/registry';
import { ADMISSION_PRIORITY, deckClassMaxWait, deckClassPriority, focusClassOrder, focusKeysOf, hasFocusLayers, registerFocusKeys } from './focus';

const layerClass = (layerName: string) =>
  class {
    static layerName = layerName;
    constructor(
      public id: string,
      public props: { visible?: boolean } = {},
    ) {}
  };
const PathLayer = layerClass('PathLayer');
const ScatterplotLayer = layerClass('ScatterplotLayer');
const TextLayer = layerClass('TextLayer');
const IconLayer = layerClass('IconLayer');

/** The focus keys the app registers (FeatureLayers.tsx, DeckOverlay.tsx), from the real registry. */
const KEYS = new Set(focusKeysOf(FEATURE_MODULES));

/** `?route=LHR-JFK` with the default layers: what the deck host sees once the data modules mounted. */
function routeEntries() {
  return {
    'hazards:earthquakes': { z: 40, layers: [new ScatterplotLayer('quakes')] },
    space: { z: 90, layers: [new IconLayer('satellites')] },
    'flight-paths': {
      z: 90,
      layers: [new PathLayer('route-planned-glow'), new PathLayer('route-planned-arc'), new ScatterplotLayer('route-endpoints'), new TextLayer('route-endpoint-labels')],
    },
    'flight-paths-anim': { z: 91, layers: [new ScatterplotLayer('route-comet')] },
  };
}

describe('focus layers (the user’s route/flight/drawing) go first', () => {
  it('registers exactly the module Backgrounds: the route planner and the recon overlays (not the aviation track)', () => {
    expect([...KEYS]).toEqual(['flight-paths', 'panels-recon']);
    expect(focusKeysOf([{ id: 'a', Background: () => null }, { id: 'b' }])).toEqual(['a']);
    const ambient = { aviation: { z: 80, layers: [new PathLayer('track')] }, 'flight-paths-anim': { z: 91, layers: [new ScatterplotLayer('comet')] } };
    expect(hasFocusLayers(ambient, KEYS)).toBe(false);
    expect(focusClassOrder({ ...ambient, 'panels-recon': { z: 95, layers: [new TextLayer('drawn-label')] } }, KEYS)).toEqual(['TextLayer']);
  });

  it('lists the focus classes in the focus layers’ drawing order: the arc’s PathLayer first', () => {
    expect(focusClassOrder(routeEntries(), KEYS)).toEqual(['PathLayer', 'ScatterplotLayer', 'TextLayer']);
    expect(focusClassOrder({ space: { z: 90, layers: [new IconLayer('s')] } }, KEYS)).toEqual([]);
  });

  it('admits the route’s arc class before the ambient ScatterplotLayer seen first (CI: arc came fourth)', () => {
    const entries = routeEntries();
    const all = flattenLayers<InstanceType<typeof PathLayer>>(Object.values(entries).sort((a, b) => a.z - b.z).map((e) => e.layers));
    const { waiting } = admitLayers(all, createAdmissionState());
    expect(waiting).toEqual(['ScatterplotLayer', 'IconLayer', 'PathLayer', 'TextLayer']); // global first-seen order
    const order = focusFirst(waiting, focusClassOrder(entries, KEYS));
    expect(order).toEqual(['PathLayer', 'ScatterplotLayer', 'TextLayer', 'IconLayer']);
  });

  it('serves the first focus class before the data-module mount, further focus classes before ambient work', () => {
    const focus = focusClassOrder(routeEntries(), KEYS);
    expect(deckClassPriority('PathLayer', focus)).toBe(ADMISSION_PRIORITY.focusFirst);
    expect(deckClassPriority('ScatterplotLayer', focus)).toBe(ADMISSION_PRIORITY.focus);
    expect(deckClassPriority('IconLayer', focus)).toBe(ADMISSION_PRIORITY.ambient);
    expect(deckClassPriority(undefined, focus)).toBe(ADMISSION_PRIORITY.ambient);
    expect(ADMISSION_PRIORITY.focusFirst).toBeLessThan(ADMISSION_PRIORITY.deckDevice);
    expect(ADMISSION_PRIORITY.deckDevice).toBeLessThan(ADMISSION_PRIORITY.features);
    expect(ADMISSION_PRIORITY.features).toBeLessThan(ADMISSION_PRIORITY.focus);
    expect(ADMISSION_PRIORITY.focus).toBeLessThan(ADMISSION_PRIORITY.ambient);
  });

  it('gives focus classes the short wait and ambient classes the scheduler default', () => {
    const focus = ['PathLayer', 'TextLayer'];
    expect(deckClassMaxWait('PathLayer', focus)).toBe(FOCUS_MAX_WAIT_MS);
    expect(deckClassMaxWait('TextLayer', focus)).toBe(FOCUS_MAX_WAIT_MS);
    expect(deckClassMaxWait('IconLayer', focus)).toBeUndefined();
    expect(deckClassMaxWait(undefined, focus)).toBeUndefined();
  });

  it('wants the deck device early only while a focus entry holds a visible layer', () => {
    expect(hasFocusLayers(routeEntries(), KEYS)).toBe(true);
    expect(hasFocusLayers({ 'flight-paths': { z: 90, layers: [new PathLayer('arc', { visible: false })] } }, KEYS)).toBe(false);
    expect(hasFocusLayers({ 'flight-paths': { z: 90, layers: [] } }, KEYS)).toBe(false);
    expect(hasFocusLayers({ 'hazards:earthquakes': { z: 40, layers: [new ScatterplotLayer('q')] } }, KEYS)).toBe(false);
  });

  it('uses the keys registered by the Background host by default', () => {
    const entries = { 'test-background': { z: 1, layers: [new TextLayer('t')] } };
    expect(hasFocusLayers(entries)).toBe(false);
    registerFocusKeys(['test-background']);
    expect(hasFocusLayers(entries)).toBe(true);
    expect(focusClassOrder(entries)).toEqual(['TextLayer']);
  });
});
