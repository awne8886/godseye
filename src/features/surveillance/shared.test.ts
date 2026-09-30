import { describe, expect, it } from 'vitest';
import { cameraTag, CCTV_REGIONS, CCTV_ZOOM_BANDS, isRegion, providerIdOf, regionsForPoint, removalContact, removalHref, stillPath, zoomBand } from './shared';

describe('surveillance shared helpers', () => {
  it('selects regions by point, falling back to the nearest box', () => {
    expect(regionsForPoint(34.05, -118.24)).toEqual(['us-west']);
    expect(regionsForPoint(51.5, -0.12)).toEqual(['uk', 'europe']); // overlapping boxes: both served
    expect(regionsForPoint(1.35, 103.82)).toEqual(['asia']);
    expect(regionsForPoint(-36.85, 174.76)).toEqual(['oceania']);
    expect(regionsForPoint(-33.9, 18.4)).toHaveLength(1); // Cape Town: nearest box only
    expect(CCTV_REGIONS.every(isRegion)).toBe(true);
    expect(isRegion('mars')).toBe(false);
  });

  it('M9: camera points are small and unstroked at globe zooms, growing monotonically with zoom', () => {
    expect(zoomBand(1.8)).toBe(0);
    expect(zoomBand(4)).toBe(1);
    expect(zoomBand(13)).toBe(CCTV_ZOOM_BANDS.length - 1);
    const landing = CCTV_ZOOM_BANDS[zoomBand(2)]!;
    expect(landing.maxPx).toBeLessThanOrEqual(1.5);
    expect(landing.stroked).toBe(false);
    expect(landing.opacity).toBeLessThan(0.6);
    for (let i = 1; i < CCTV_ZOOM_BANDS.length; i++) {
      expect(CCTV_ZOOM_BANDS[i]!.maxPx).toBeGreaterThan(CCTV_ZOOM_BANDS[i - 1]!.maxPx);
      expect(CCTV_ZOOM_BANDS[i]!.scale).toBeGreaterThan(CCTV_ZOOM_BANDS[i - 1]!.scale);
    }
  });

  it('removal contact: GODSEYE_CONTACT (email/https) when set, else the project tracker', () => {
    expect(removalContact({})).toEqual({ kind: 'tracker', href: 'https://github.com/awne8886/godseye/issues' });
    expect(removalContact({ GODSEYE_CONTACT: 'ops@example.org' })).toEqual({ kind: 'email', href: 'mailto:ops@example.org' });
    expect(removalContact({ GODSEYE_CONTACT: 'mailto:ops@example.org' })).toEqual({ kind: 'email', href: 'mailto:ops@example.org' });
    expect(removalContact({ GODSEYE_CONTACT: 'https://ops.example.org/abuse' })).toEqual({ kind: 'url', href: 'https://ops.example.org/abuse' });
    expect(removalContact({ GODSEYE_CONTACT: 'javascript:alert(1)' }).kind).toBe('tracker');
    expect(removalContact({ GODSEYE_CONTACT: 'a\r\nb' }).kind).toBe('tracker');
    expect(removalHref({ kind: 'email', href: 'mailto:o@x.org' }, 'T', 'a b')).toBe('mailto:o@x.org?subject=T&body=a%20b');
  });

  it('ids, tags and still paths', () => {
    expect(providerIdOf('txdot-AUS-FM-734 @ US-290 EB')).toBe('txdot');
    expect(cameraTag(34.0837, -118.2215)).toBe('CAM-3408N-11822W');
    expect(cameraTag(-1.5, 3)).toBe('CAM-0150S-00300E');
    expect(stillPath({ id: 'txdot-AUS-X 1', providerId: 'txdot' })).toBe('/api/cctv/texas/snapshot?id=txdot-AUS-X%201');
    expect(stillPath({ id: 'hktd-H429F', providerId: 'hktd' })).toBe('/api/cctv/proxy?id=hktd-H429F');
  });
});
