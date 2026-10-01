import { describe, expect, it, vi } from 'vitest';
import { admitLayers, createAdmissionState, createStableArray, createStableLists, flattenLayers, focusFirst, layerClassKey, sameMembers } from './deck-admission';

class ScatterplotLayer {
  static layerName = 'ScatterplotLayer';
  constructor(
    public id: string,
    public props: { visible?: boolean } = {},
  ) {}
}
class TextLayer {
  static layerName = 'TextLayer';
  constructor(
    public id: string,
    public props: { visible?: boolean } = {},
  ) {}
}

describe('deck layer admission (perf B2)', () => {
  it('uses deck’s static layerName as the class key', () => {
    expect(layerClassKey(new TextLayer('t'))).toBe('TextLayer');
  });

  it('flattens nested lists and drops falsy entries', () => {
    const a = new TextLayer('a');
    const b = new ScatterplotLayer('b');
    expect(flattenLayers([null, [a, false, [b]], undefined])).toEqual([a, b]);
  });

  it('never instantiates a layer that has never been visible; keeps it once it has been', () => {
    const st = createAdmissionState();
    st.admitted.add('ScatterplotLayer');
    expect(admitLayers([new ScatterplotLayer('quakes', { visible: false })], st).pass).toEqual([]);
    const on = new ScatterplotLayer('quakes', { visible: true });
    expect(admitLayers([on], st).pass).toEqual([on]);
    const off = new ScatterplotLayer('quakes', { visible: false });
    expect(admitLayers([off], st).pass).toEqual([off]);
  });

  it('holds new classes back until admitted, one class at a time, in first-seen order', () => {
    const st = createAdmissionState();
    const layers = [new ScatterplotLayer('a'), new TextLayer('iss-label'), new ScatterplotLayer('b')];
    let r = admitLayers(layers, st);
    expect(r.pass).toEqual([]);
    expect(r.waiting).toEqual(['ScatterplotLayer', 'TextLayer']);
    st.admitted.add(r.waiting[0]!);
    r = admitLayers(layers, st);
    expect(r.pass.map((l) => l.id)).toEqual(['a', 'b']);
    expect(r.waiting).toEqual(['TextLayer']);
    st.admitted.add(r.waiting[0]!);
    r = admitLayers(layers, st);
    expect(r.pass.map((l) => l.id)).toEqual(['a', 'iss-label', 'b']);
    expect(r.waiting).toEqual([]);
  });
});

describe('R4-M1: focus classes first, in the focus layers’ own order', () => {
  it('puts the classes of the user focus layers (route, drawing) before ambient ones', () => {
    expect(focusFirst(['IconLayer', 'PathLayer', 'TextLayer', 'ScatterplotLayer'], ['PathLayer', 'TextLayer'])).toEqual(['PathLayer', 'TextLayer', 'IconLayer', 'ScatterplotLayer']);
    expect(focusFirst(['A', 'B'], new Set<string>())).toEqual(['A', 'B']);
    expect(focusFirst([], ['A'])).toEqual([]);
  });

  it('orders focus classes as the focus layers draw them, not by when an ambient layer first showed the class', () => {
    // An ambient earthquake ScatterplotLayer (z 40) is seen before the route (z 90): the route's
    // arc (PathLayer) still goes first, then its endpoints and labels.
    const waiting = ['ScatterplotLayer', 'IconLayer', 'PathLayer', 'TextLayer'];
    expect(focusFirst(waiting, ['PathLayer', 'ScatterplotLayer', 'TextLayer'])).toEqual(['PathLayer', 'ScatterplotLayer', 'TextLayer', 'IconLayer']);
    // A focus class that is already admitted (not waiting) is not invented back into the queue.
    expect(focusFirst(['IconLayer'], ['PathLayer'])).toEqual(['IconLayer']);
  });
});

describe('identity-stable lists for deck (no repaint when nothing changed)', () => {
  type FakeLayer = { id: string; props: { beforeId?: string } };
  const mk = (id: string): FakeLayer => ({ id, props: {} });
  const clone = vi.fn((l: FakeLayer, beforeId: string): FakeLayer => ({ id: l.id, props: { ...l.props, beforeId } }));

  it('sameMembers compares members and order', () => {
    const a = mk('a');
    const b = mk('b');
    expect(sameMembers([a, b], [a, b])).toBe(true);
    expect(sameMembers([a, b], [b, a])).toBe(false);
    expect(sameMembers([a], [a, b])).toBe(false);
    const s = createStableArray<string>();
    const first = s(['x', 'y']);
    expect(s(['x', 'y'])).toBe(first);
    expect(s(['y'])).toEqual(['y']);
  });

  it('returns the same array (and the same clones) while the passed layers do not change', () => {
    clone.mockClear();
    const lists = createStableLists<FakeLayer>(clone);
    const a = mk('a');
    const b = mk('b');
    const first = lists.layers([a, b], 'label-anchor');
    expect(first.map((l) => l.props.beforeId)).toEqual(['label-anchor', 'label-anchor']);
    // A module republished (new entries object, same layer instances): nothing new for deck.
    expect(lists.layers([a, b], 'label-anchor')).toBe(first);
    expect(clone).toHaveBeenCalledTimes(2);
    // One layer changed: a new list, the unchanged layer keeps its clone.
    const b2 = mk('b');
    const second = lists.layers([a, b2], 'label-anchor');
    expect(second).not.toBe(first);
    expect(second[0]).toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
    // A layer with its own beforeId is passed as is; no anchor means no clones.
    const own: FakeLayer = { id: 'own', props: { beforeId: 'x' } };
    const lists2 = createStableLists<FakeLayer>((l, before) => (l.props.beforeId ? l : clone(l, before)));
    expect(lists2.layers([own], 'label-anchor')[0]).toBe(own);
    expect(createStableLists<FakeLayer>(clone).layers([a], undefined)[0]).toBe(a);
  });

  it('a layer that left the list gets a fresh clone when it comes back (deck never reuses a finalised layer)', () => {
    const lists = createStableLists<FakeLayer>(clone);
    const a = mk('a');
    const b = mk('b');
    const first = lists.layers([a, b], 'anchor');
    lists.layers([a], 'anchor');
    const back = lists.layers([a, b], 'anchor');
    expect(back[0]).toBe(first[0]);
    expect(back[1]).not.toBe(first[1]);
    // A new anchor re-clones.
    expect(lists.layers([a, b], 'other')[0]).not.toBe(first[0]);
  });

  it('keeps the waiting and focus class lists stable too', () => {
    const lists = createStableLists<FakeLayer>(clone);
    const w = lists.waiting(['PathLayer']);
    expect(lists.waiting(['PathLayer'])).toBe(w);
    const f = lists.focus(['PathLayer', 'TextLayer']);
    expect(lists.focus(['PathLayer', 'TextLayer'])).toBe(f);
    expect(lists.focus(['TextLayer'])).not.toBe(f);
  });
});
