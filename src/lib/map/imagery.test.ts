import { describe, expect, it } from 'vitest';
import { TILE_HOSTS } from '@/config/hosts';
import {
  BLACK_MARBLE_ATTRIBUTION,
  ESRI_ATTRIBUTION,
  ESRI_MAX_ZOOM,
  ESRI_TILES,
  GIBS_TRUECOLOR_ATTRIBUTION,
  TERRARIUM_ATTRIBUTION,
  TERRARIUM_TILES,
  blackMarbleUrl,
  gibsTrueColorDate,
  gibsTrueColorLabel,
  gibsTrueColorTiles,
} from './imagery';

describe('GIBS true colour date', () => {
  it('is the previous UTC day (today is still being filled in)', () => {
    expect(gibsTrueColorDate(Date.UTC(2026, 8, 30, 18, 0))).toBe('2026-09-29');
    expect(gibsTrueColorDate(Date.UTC(2026, 8, 30, 0, 0))).toBe('2026-09-29');
    expect(gibsTrueColorDate(Date.UTC(2026, 8, 30, 23, 59, 59))).toBe('2026-09-29');
    expect(gibsTrueColorDate(new Date('2026-01-01T03:00:00Z'))).toBe('2025-12-31');
    expect(gibsTrueColorDate(new Date('2024-03-01T12:00:00+13:00'))).toBe('2024-02-28'); // 2024-02-29T23:00Z
  });
  it('builds the dated Level9 WMTS template and REFERENCE label', () => {
    expect(gibsTrueColorTiles('2026-09-29')).toEqual([
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/2026-09-29/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg',
    ]);
    expect(() => gibsTrueColorTiles('yesterday')).toThrow();
    expect(gibsTrueColorLabel('2026-09-29')).toBe('VIIRS TRUE COLOUR 2026-09-29 · REFERENCE');
  });
});

describe('imagery sources', () => {
  it('only use hosts allowed by the CSP tile list', () => {
    const urls = [...ESRI_TILES, ...gibsTrueColorTiles('2026-09-29'), blackMarbleUrl(0, 0, 0), ...TERRARIUM_TILES];
    for (const u of urls) expect(TILE_HOSTS.some((h) => u.startsWith(h))).toBe(true);
  });
  it('carry their attribution (Esri verbatim, GIBS acknowledgement, Tilezen)', () => {
    expect(ESRI_ATTRIBUTION).toBe('Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community');
    expect(ESRI_MAX_ZOOM).toBe(19);
    expect(GIBS_TRUECOLOR_ATTRIBUTION).toContain('NASA GIBS');
    expect(BLACK_MARBLE_ATTRIBUTION).toContain('2016');
    expect(TERRARIUM_ATTRIBUTION).toContain('tilezen/joerd');
  });
});
