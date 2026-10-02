import { describe, expect, it } from 'vitest';
import j80 from '../__fixtures__/faa-adds-ats-route-J80.json';
import { mergeAirwayFeatures, type AirwaysFile } from '../lib/airways';
import { airwaysProvenance, routeAirways } from './airways';

const airways = mergeAirwayFeatures(j80.body.features as unknown as Parameters<typeof mergeAirwayFeatures>[0]);
const file = (lastModified: string | null): AirwaysFile => ({
  version: 1,
  generatedAt: '2026-10-02T00:13:19.188Z',
  sources: [{ url: 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/ATS_Route/FeatureServer/0', lastModified }],
  licence: 'US Government work (FAA Aeronautical Information Services), public domain',
  airways,
});
const NOW = Date.parse('2026-10-02T12:00:00Z');

describe('providers.faa_adds (round 6 M1)', () => {
  it('ages the snapshot from the FAA Last-Modified, not from our build time', () => {
    const r = routeAirways(airways[0]!.lines[0]!, NOW, file('Thu, 03 Sep 2026 11:59:04 GMT'));
    expect(r.run.status.ok).toBe(true);
    expect(r.run.status.count).toBeGreaterThan(0);
    expect(r.run.status.age_s).toBe(Math.round((NOW - Date.parse('2026-09-03T11:59:04Z')) / 1000));
    expect(r.source).toEqual({
      name: 'FAA ADDS ATS_Route',
      url: 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/ATS_Route/FeatureServer/0',
      licence: 'US Government work (FAA Aeronautical Information Services), public domain',
      lastModified: '2026-09-03T11:59:04.000Z',
      builtAt: '2026-10-02T00:13:19.188Z',
    });
  });

  it('an unknown Last-Modified is an unknown age, never the build age', () => {
    const r = routeAirways(airways[0]!.lines[0]!, NOW, file(null));
    expect(r.run.status.age_s).toBeNull();
    expect(airwaysProvenance(file(null)).lastModified).toBeNull();
  });

  it('a missing snapshot is a failed provider with no provenance', () => {
    const r = routeAirways([[0, 0], [1, 1]], NOW, null);
    expect(r.run.status).toMatchObject({ ok: false, error: 'snapshot_missing' });
    expect(r.source).toBeNull();
  });
});
