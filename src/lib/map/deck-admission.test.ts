import { describe, expect, it } from 'vitest';
import { admitLayers, createAdmissionState, flattenLayers, layerClassKey } from './deck-admission';

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
