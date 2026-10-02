import { describe, expect, it } from 'vitest';
import { deckGroupId, missingDeckGroups, withParsedStyle } from './deck-apply';

/** A map whose style is parsed but whose tiles are still loading (isStyleLoaded false). */
class FakeMap {
  style = { _loaded: true };
  layers = new Set<string>(['water_name']);
  isStyleLoaded(): boolean {
    return false;
  }
  getLayer(id: string) {
    return this.layers.has(id) ? { id } : undefined;
  }
}

/** The rule deck applies in resolveMapLibreLayerGroups: no group while isStyleLoaded() is false. */
function deckResolve(map: FakeMap, layers: { props: { beforeId?: string } }[]) {
  if (!map.isStyleLoaded()) return;
  for (const l of layers) map.layers.add(deckGroupId(l));
}

describe('deck layer groups enter the style once it is parsed (R3-M2)', () => {
  const icons = { props: { beforeId: 'water_name' } };

  it('group ids follow @deck.gl/maplibre', () => {
    expect(deckGroupId(icons)).toBe('deck-maplibre-layer-group-before:water_name');
    expect(deckGroupId({ props: {} })).toBe('deck-maplibre-layer-group-last');
  });

  it('a loading tile no longer keeps the layer off the map', () => {
    const map = new FakeMap();
    deckResolve(map, [icons]);
    expect(missingDeckGroups(map, [icons])).toEqual(['deck-maplibre-layer-group-before:water_name']);
    withParsedStyle(map, () => deckResolve(map, [icons]));
    expect(missingDeckGroups(map, [icons])).toEqual([]);
  });

  it('the override is scoped to the call and restores the prototype method', () => {
    const map = new FakeMap();
    let inside: boolean | void = undefined;
    withParsedStyle(map, () => {
      inside = map.isStyleLoaded();
    });
    expect(inside).toBe(true);
    expect(map.isStyleLoaded()).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(map, 'isStyleLoaded')).toBe(false);
  });

  it('an unparsed style stays unloaded, and a throwing call still restores', () => {
    const map = new FakeMap();
    map.style._loaded = false;
    expect(withParsedStyle(map, () => map.isStyleLoaded())).toBe(false);
    expect(() =>
      withParsedStyle(map, () => {
        throw new Error('x');
      }),
    ).toThrow('x');
    expect(Object.prototype.hasOwnProperty.call(map, 'isStyleLoaded')).toBe(false);
  });

  it('reports each missing group once; no map means nothing to report', () => {
    const map = new FakeMap();
    expect(missingDeckGroups(map, [icons, icons, { props: {} }])).toHaveLength(2);
    expect(missingDeckGroups(null, [icons])).toEqual([]);
  });
});
