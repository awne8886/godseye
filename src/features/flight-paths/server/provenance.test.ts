// R4 round 2, m2: the shipped Flight Path Planner data must carry real upstream provenance
// (URL + Last-Modified), never a local sandbox path.
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { VRS_ROUTES_URL } from '../../../../tools/build-routes';

const DIR = new URL('../../../../public/data/', import.meta.url);
const files = readdirSync(DIR).filter((f) => /^(airports|routes)/.test(f) && /\.json(\.gz)?$/.test(f));

function head(name: string): string {
  const buf = readFileSync(new URL(name, DIR));
  const text = (name.endsWith('.gz') ? gunzipSync(buf) : buf).toString('utf8');
  // Provenance lives in the leading metadata keys; the data payload follows.
  return text.slice(0, 2_000);
}

describe('public/data provenance', () => {
  it('ships the airports and routes files', () => {
    expect(files).toEqual(expect.arrayContaining(['airports.min.json', 'routes-vrs.json.gz', 'routes-openflights.json.gz']));
  });

  for (const f of files) {
    it(`${f}: no local filesystem path in the metadata`, () => {
      const meta = head(f);
      expect(meta).not.toMatch(/\/tmp\/|\/home\/|scratchpad|local copy|file:\/\//);
    });
  }

  it('routes-vrs.json.gz names the VRS URL and an ISO Last-Modified', () => {
    const meta = JSON.parse(gunzipSync(readFileSync(new URL('routes-vrs.json.gz', DIR))).toString('utf8')) as { source?: string; lastModified: string | null };
    expect(meta.source).toBe(VRS_ROUTES_URL);
    expect(meta.lastModified).not.toBeNull();
    expect(new Date(meta.lastModified!).toISOString()).toBe(meta.lastModified);
  });
});
