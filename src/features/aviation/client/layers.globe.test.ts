import { describe, expect, it, vi } from 'vitest';
import type { FlightRecord } from '../adsb';

// The atlas needs a DOM canvas; a stand-in mapping is enough to build (not draw) the icon layer.
vi.mock('./icons', () => ({
  aircraftAtlas: () => ({
    canvas: {},
    mapping: Object.fromEntries(['plane', 'jet', 'heli'].map((n, i) => [n, { x: i * 64, y: 0, width: 64, height: 64, anchorX: 32, anchorY: 32, mask: true }])),
  }),
}));

const { ICON_PARAMETERS, advanceFrame, buildLayers, newFrame } = await import('./layers');
const { SdfIconLayer } = await import('./SdfIconLayer');
const { aircraftSelection } = await import('./select');

const rec = (id: string, lng: number, lat: number, p: Partial<FlightRecord> = {}): FlightRecord => ({
  id, callsign: null, registration: null, typeCode: null, bucket: 'commercial', isHelicopter: false, onGround: false, lat, lng,
  altFt: 30000, altGeomFt: null, gsKt: 360, trackDeg: 90, vrFpm: 0, squawk: null, emergency: null, category: null, nacP: null,
  dbFlags: null, seenAt: 1000, source: 'adsblol_tiles', posSource: 'adsb', ...p,
});

type Built = { id: string; props: { parameters?: Record<string, unknown>; billboard?: boolean } };

function build(globe: boolean) {
  const f = newFrame([rec('aaaaa1', 0, 51), rec('aaaaa2', 1, 51, { emergency: '7700', squawk: '7700' })]);
  const camera = globe ? { lng: 0, lat: 51, altitude: 1_000_000 } : null;
  advanceFrame(f, 1000_000, new Set(['commercial']), camera);
  return buildLayers({
    now: 1000_000, camera,
    frame: f, view: { center: [0, 51], zoom: 6, bearing: 0 }, tick: 1, dataVersion: 1, colorMode: 'bucket', theme: 'HORUS',
    watched: ['aaaaa1'], tracks: new Map(), selectedId: null, cells: null, toSelection: aircraftSelection,
  }) as unknown as Built[];
}

describe('aviation icons on the globe', () => {
  it('disables face culling and the depth test (MapLibre globe leaves culling on; IconLayer quads wind backwards)', () => {
    expect(ICON_PARAMETERS).toEqual({ cullMode: 'none', depthCompare: 'always' });
  });

  it('passes colours as a binary attribute (no getColor accessor or trigger to re-run per tick)', () => {
    const icons = build(false).find((l) => l.id === 'aviation-icons') as unknown as { props: { data: { length: number; attributes?: { getColor?: { value: Uint8Array; size: number } } }; updateTriggers: Record<string, unknown> } };
    expect(icons.props.data.length).toBe(2);
    expect(icons.props.data.attributes?.getColor?.size).toBe(4);
    expect(icons.props.data.attributes?.getColor?.value).toHaveLength(8);
    expect(icons.props.updateTriggers.getColor).toBeUndefined();
  });

  it('draws aircraft as billboard SDF icons with the globe-safe GPU state on both projections', () => {
    for (const globe of [true, false]) {
      const layers = build(globe);
      const icons = layers.find((l) => l.id === 'aviation-icons')!;
      expect(icons).toBeInstanceOf(SdfIconLayer);
      expect(icons.props.billboard).toBe(true);
      expect(icons.props.parameters).toEqual(ICON_PARAMETERS);
      for (const id of ['aviation-emergency', 'aviation-highlight']) {
        expect(layers.find((l) => l.id === id)!.props.parameters).toEqual(ICON_PARAMETERS);
      }
    }
  });
});
