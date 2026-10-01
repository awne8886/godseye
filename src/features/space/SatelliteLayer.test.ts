import { describe, expect, it } from 'vitest';
import type { FeedMeta } from '@/lib/types';
import { ISS_LABEL, ISS_LABEL_CHARSET, issLabelLayer, orbitLayer, railAttribution } from './SatelliteLayer';

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
