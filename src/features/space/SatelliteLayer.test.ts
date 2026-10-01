import { describe, expect, it } from 'vitest';
import type { FeedMeta } from '@/lib/types';
import { ISS_LABEL, ISS_LABEL_CHARSET, frameDiagnostics, issLabelLayer, orbitLayer, railAttribution, satelliteDotsLayer } from './SatelliteLayer';

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

  const frame = (at: number, count: number) => ({
    version: '2026-10-01T06:14:19.000Z|2',
    at,
    count,
    positions: new Float32Array(count * 3),
    colors: new Uint8Array(count * 4),
    radii: new Float32Array(count),
    index: new Uint32Array(count),
    hidden: 2 - count,
    failed: 0,
    selected: null,
    camera: count === 2 ? null : { lng: -98, lat: 39, altitude: 5_700_000 },
  });

  it('the satellite dots are never culled, pickable, and re-upload on a same-`at` camera re-filter', () => {
    const a = frame(1_790_900_000_000, 2);
    const b = frame(1_790_900_000_000, 1); // same propagation, re-filtered for a new camera
    const la = satelliteDotsLayer(a);
    const lb = satelliteDotsLayer(b);
    const pa = la.props as unknown as { parameters?: { cullMode?: string }; pickable?: boolean; billboard?: boolean; drawnFrame?: unknown; updateTriggers: Record<string, unknown> };
    const pb = lb.props as unknown as typeof pa;
    expect(pa.parameters?.cullMode).toBe('none');
    expect(pa.pickable).toBe(true);
    expect(pa.billboard).toBe(true);
    expect(pa.drawnFrame).toBe(a);
    expect(pb.updateTriggers.getPosition).not.toBe(pa.updateTriggers.getPosition);
    // The same frame object keeps its trigger (no needless re-upload on unrelated re-renders).
    expect((satelliteDotsLayer(a).props as unknown as typeof pa).updateTriggers.getPosition).toBe(pa.updateTriggers.getPosition);
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
