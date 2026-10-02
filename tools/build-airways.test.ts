import { describe, expect, it } from 'vitest';
import j80 from '../src/features/flight-paths/__fixtures__/faa-adds-ats-route-J80.json';
import quota from '../src/features/flight-paths/__fixtures__/faa-adds-429-in-200.json';
import { buildAirwaysFile, fetchAllFeatures, pageUrl, QUOTA_WAIT_MS } from './build-airways';

const features = j80.body.features as unknown[];

describe('tools/build-airways', () => {
  it('pages until the transfer limit clears, waiting ≥ 60 s on a 429 inside a 200', async () => {
    const waits: number[] = [];
    const urls: string[] = [];
    let n = 0;
    const get = async (url: string) => {
      urls.push(url);
      n++;
      if (n === 1) return { status: 200, lastModified: 'Thu, 03 Sep 2026 11:59:04 GMT', body: { features: features.slice(0, 10), properties: { exceededTransferLimit: true } } as unknown };
      if (n === 2) return { status: 200, lastModified: null, body: quota.body as unknown };
      return { status: 200, lastModified: null, body: { features: features.slice(10) } as unknown };
    };
    const r = await fetchAllFeatures(get, async (ms) => {
      waits.push(ms);
    });
    expect(r.features).toHaveLength(features.length);
    expect(r.lastModified).toBe('Thu, 03 Sep 2026 11:59:04 GMT');
    expect(QUOTA_WAIT_MS).toBeGreaterThanOrEqual(60_000);
    expect(waits).toContain(QUOTA_WAIT_MS);
    expect(urls[0]).toBe(pageUrl(0));
    expect(urls[1]).toBe(pageUrl(10));
    expect(urls[2]).toBe(pageUrl(10));
    expect(pageUrl(0)).toMatch(/outFields=IDENT%2CTYPE_CODE&outSR=4326&f=geojson/);
  });

  it('a non-quota error stops the build (never an empty snapshot)', async () => {
    await expect(fetchAllFeatures(async () => ({ status: 200, lastModified: null, body: { error: { code: 400 } } }), async () => undefined)).rejects.toThrow(/error 400/);
  });

  it('writes sources {url, lastModified} and the merged airways', () => {
    const file = buildAirwaysFile(features, 'Thu, 03 Sep 2026 11:59:04 GMT', new Date('2026-10-02T00:00:00Z'));
    expect(file.sources).toEqual([{ url: 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/ATS_Route/FeatureServer/0', lastModified: 'Thu, 03 Sep 2026 11:59:04 GMT' }]);
    expect(file.airways.map((a) => a.ident)).toEqual(['J80']);
    expect(file.generatedAt).toBe('2026-10-02T00:00:00.000Z');
  });
});
