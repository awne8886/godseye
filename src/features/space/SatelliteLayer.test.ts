import { describe, expect, it } from 'vitest';
import type { FeedMeta } from '@/lib/types';
import type { GetPickingInfoParams, PickingInfo } from '@deck.gl/core';
import { ISS_LABEL, ISS_LABEL_CHARSET, frameDiagnostics, issLabelLayer, orbitLayer, pickedRow, railAttribution, satelliteIconLayers, satelliteLayerId } from './SatelliteLayer';
import { SAT_CATEGORIES } from './lib/catalog';
import { buildGlyphAtlas } from './lib/glyphs';

const color: [number, number, number, number] = [10, 20, 30, 255];

const meta = (): FeedMeta => ({
  feed: 'satellites',
  kind: 'live',
  state: 'live',
  fetchedAt: '2026-10-01T06:14:19.000Z',
  observedAt: '2026-10-01T03:22:47.196Z',
  lastGoodAt: '2026-10-01T06:14:19.000Z',
  stale: false,
  ttlSeconds: 7200,
  attribution: [
    { text: 'Orbital elements: CelesTrak GP (OMM), Dr T.S. Kelso', url: 'https://celestrak.org/NORAD/documentation/gp-data-formats.php' },
    { text: 'Fallback TLEs: SatNOGS DB (Libre Space Foundation)', url: 'https://db.satnogs.org/', licence: 'CC BY-SA 4.0' },
  ],
});

describe('satellite deck layers (globe rules)', () => {
  it('the orbit PathLayer is antialiased and never culled (R1 m8)', () => {
    const l = orbitLayer(
      [
        [
          [0, 0, 400],
          [10, 5, 410],
        ],
      ],
      color,
    );
    const props = l.props as unknown as { antialiasing?: boolean; parameters?: { cullMode?: string } };
    expect(props.antialiasing).toBe(true);
    expect(props.parameters?.cullMode).toBe('none');
  });

  it('the ISS label builds its atlas from the label letters only (perf m-b)', () => {
    const l = issLabelLayer([0, 0, 1000], color);
    const props = l.props as unknown as { characterSet?: string[]; parameters?: { cullMode?: string }; billboard?: boolean };
    expect(props.characterSet).toEqual(['I', 'S']);
    expect(ISS_LABEL_CHARSET).toEqual(['I', 'S']);
    for (const ch of ISS_LABEL) expect(props.characterSet).toContain(ch);
    expect(props.parameters?.cullMode).toBe('none');
    expect(props.billboard).toBe(true);
  });

  const frame = (at: number, count: number, categoryOffsets = new Uint32Array([0, count, count, count, count, count, count])) => ({
    version: '2026-10-01T06:14:19.000Z|2',
    at,
    count,
    positions: new Float32Array(count * 3),
    colors: new Uint8Array(count * 4),
    sizes: new Float32Array(count),
    index: new Uint32Array(count),
    categoryOffsets,
    hidden: 2 - count,
    failed: 0,
    selected: null,
    camera: count === 2 ? null : { lng: -98, lat: 39, altitude: 5_700_000 },
  });

  const glyphs = buildGlyphAtlas();
  const atlas = { image: { width: glyphs.width, height: glyphs.height, data: glyphs.data }, mapping: glyphs.mapping };
  type IconProps = {
    id: string;
    data: { length: number; attributes: Record<string, { value: ArrayBufferView; size: number }> };
    parameters?: { cullMode?: string; depthCompare?: string };
    pickable?: boolean;
    billboard?: boolean;
    visible?: boolean;
    sizeUnits?: string;
    getIcon?: unknown;
    iconAtlas?: unknown;
    iconMapping?: Record<string, { mask?: boolean }>;
    drawnFrame?: unknown;
    drawOffset?: number;
    updateTriggers: Record<string, unknown>;
  };

  it('one glyph IconLayer per mission category over subarray views of the sorted frame', () => {
    // 2 comms, 0 military, 3 navigation, 1 earth_obs, 0 science, 1 other.
    const f = frame(1_790_900_000_000, 7, new Uint32Array([0, 2, 2, 5, 6, 6, 7]));
    for (let k = 0; k < 7; k++) f.positions[k * 3] = k;
    const layers = satelliteIconLayers(f, atlas);
    expect(layers.map((l) => l.id)).toEqual(SAT_CATEGORIES.map((c) => `space-satellites-${c}`));
    expect(SAT_CATEGORIES.map(satelliteLayerId)).toEqual(layers.map((l) => l.id));
    const lengths = [2, 0, 3, 1, 0, 1];
    const starts = [0, 2, 2, 5, 6, 6];
    layers.forEach((l, c) => {
      const p = l.props as unknown as IconProps;
      expect(p.getIcon).toBe(SAT_CATEGORIES[c]);
      expect(p.iconAtlas).toBe(atlas.image);
      expect(p.iconMapping?.[SAT_CATEGORIES[c]!]?.mask).toBe(true);
      expect(p.data.length).toBe(lengths[c]);
      expect(p.visible).toBe(lengths[c]! > 0);
      expect(p.drawOffset).toBe(starts[c]);
      const pos = p.data.attributes.getPosition!.value as Float32Array;
      const col = p.data.attributes.getColor!.value as Uint8Array;
      const size = p.data.attributes.getSize!.value as Float32Array;
      // Views on the transferred buffers (no copy), each starting at the category's first row.
      expect(pos.buffer).toBe(f.positions.buffer);
      expect(col.buffer).toBe(f.colors.buffer);
      expect(size.buffer).toBe(f.sizes.buffer);
      expect(pos.length).toBe(lengths[c]! * 3);
      expect(col.length).toBe(lengths[c]! * 4);
      expect(size.length).toBe(lengths[c]);
      if (lengths[c]) expect(pos[0]).toBe(starts[c]);
    });
  });

  it('the glyph layers follow the globe rules: billboard, never culled, depthCompare always, pickable, pixel sizes', () => {
    for (const l of satelliteIconLayers(frame(1_790_900_000_000, 2), atlas)) {
      const p = l.props as unknown as IconProps;
      expect(p.parameters?.cullMode).toBe('none');
      expect(p.parameters?.depthCompare).toBe('always');
      expect(p.billboard).toBe(true);
      expect(p.pickable).toBe(true);
      expect(p.sizeUnits).toBe('pixels');
    }
  });

  it('re-uploads on a same-`at` camera re-filter, not on unrelated re-renders', () => {
    const a = frame(1_790_900_000_000, 2);
    const b = frame(1_790_900_000_000, 1); // same propagation, re-filtered for a new camera
    const pa = satelliteIconLayers(a, atlas)[0]!.props as unknown as IconProps;
    const pb = satelliteIconLayers(b, atlas)[0]!.props as unknown as IconProps;
    expect(pa.drawnFrame).toBe(a);
    expect(pb.updateTriggers.getPosition).not.toBe(pa.updateTriggers.getPosition);
    expect((satelliteIconLayers(a, atlas)[0]!.props as unknown as IconProps).updateTriggers.getPosition).toBe(pa.updateTriggers.getPosition);
  });

  it('a GPU pick returns the frame-wide drawIndex (category offset + layer index)', () => {
    const f = frame(1_790_900_000_000, 7, new Uint32Array([0, 2, 2, 5, 6, 6, 7]));
    const nav = satelliteIconLayers(f, atlas)[2]!;
    const info = nav.getPickingInfo({ info: { index: 1, object: undefined } as unknown as PickingInfo, mode: 'query', sourceLayer: nav } as unknown as GetPickingInfoParams);
    expect(info.object).toEqual({ drawIndex: 3 });
    const none = nav.getPickingInfo({ info: { index: -1, object: undefined } as unknown as PickingInfo, mode: 'hover', sourceLayer: nav } as unknown as GetPickingInfoParams);
    expect(none.object).toBeUndefined();
    expect(pickedRow({ object: info.object, index: 1, layer: { id: nav.id, props: nav.props as unknown as Record<string, unknown> } })).toEqual({ frame: f, row: 3 });
    expect(pickedRow({ object: { drawIndex: 7 }, index: 1, layer: { id: nav.id, props: nav.props as unknown as Record<string, unknown> } })).toBeNull();
    expect(pickedRow({ object: { drawIndex: 1 }, index: 1, layer: { id: 'x', props: {} } })).toBeNull();
  });

  it('diagnostics name the frame and the far-side camera it was filtered with (e2e)', () => {
    expect(frameDiagnostics(null)).toBe('');
    const d = JSON.parse(frameDiagnostics(frame(1_790_900_000_000, 1)));
    expect(d).toEqual({ version: '2026-10-01T06:14:19.000Z|2', at: 1_790_900_000_000, count: 1, hidden: 1, failed: 0, camera: { lng: -98, lat: 39, altitude: 5_700_000 } });
  });
});

describe('rail attribution names the catalogue in use (R2 minor 5)', () => {
  it('CelesTrak catalogue: CelesTrak only, the SatNOGS fallback credit is not shown', () => {
    const a = railAttribution({ catalogueSource: 'celestrak', meta: meta(), total: 16_612 });
    expect(a).toHaveLength(1);
    expect(a[0]!.text).toMatch(/CelesTrak/);
  });

  it('fallback: a FALLBACK line with the object count, SatNOGS link and licence', () => {
    const a = railAttribution({ catalogueSource: 'satnogs-fallback', meta: meta(), total: 1_679 });
    expect(a).toEqual([
      { text: 'FALLBACK · SatNOGS DB TLEs, 1,679 objects (CelesTrak unavailable; retrying)', url: 'https://db.satnogs.org/', licence: 'CC BY-SA 4.0' },
    ]);
  });
});
