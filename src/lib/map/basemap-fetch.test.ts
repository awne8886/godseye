import { describe, expect, it, vi } from 'vitest';
import planet from './__fixtures__/openfreemap-planet-tilejson.2026-09-30.json';
import { fetchBasemapStyle } from './basemap-fetch';
import { BASEMAP_STYLE_URL, BASEMAP_TILEJSON_URL } from './basemap-urls';

const style = (url: string) => ({ version: 8, sources: { openmaptiles: { type: 'vector', url } }, layers: [] });
const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
const fail = (status: number) => Promise.resolve({ ok: false, status, json: () => Promise.reject(new Error('no body')) });

describe('fetchBasemapStyle (first paint: style and TileJSON in parallel)', () => {
  it('requests the expected TileJSON alongside the style and inlines it', async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn((url: string) => {
      calls.push(url);
      return url === BASEMAP_STYLE_URL ? ok(style(BASEMAP_TILEJSON_URL)) : ok(planet);
    });
    const out = await fetchBasemapStyle(new AbortController().signal, fetchFn);
    // Both requests are in flight before the style body is read.
    expect(calls.slice(0, 2).sort()).toEqual([BASEMAP_STYLE_URL, BASEMAP_TILEJSON_URL].sort());
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const src = out.sources.openmaptiles as { url?: string; tiles?: string[] };
    expect(src.url).toBeUndefined();
    expect(src.tiles?.[0]).toMatch(/^https:\/\/tiles\.openfreemap\.org\/planet\//);
  });

  it('fetches a different TileJSON named by the style after it (the early one is ignored)', async () => {
    const other = 'https://tiles.openfreemap.org/planet-v2';
    const fetchFn = vi.fn((url: string) => (url === BASEMAP_STYLE_URL ? ok(style(other)) : url === other ? ok({ ...planet, tiles: planet.tiles.map((t: string) => t.replace('/planet/', '/planet-v2/')) }) : fail(404)));
    const out = await fetchBasemapStyle(new AbortController().signal, fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect((out.sources.openmaptiles as { tiles: string[] }).tiles[0]).toContain('/planet-v2/');
  });

  it('rejects when the TileJSON the style needs failed (the caller retries; no blank globe)', async () => {
    const fetchFn = vi.fn((url: string) => (url === BASEMAP_STYLE_URL ? ok(style(BASEMAP_TILEJSON_URL)) : fail(503)));
    await expect(fetchBasemapStyle(new AbortController().signal, fetchFn)).rejects.toThrow('basemap TileJSON HTTP 503');
  });

  it('rejects on a failed style', async () => {
    const fetchFn = vi.fn((url: string) => (url === BASEMAP_STYLE_URL ? fail(502) : ok(planet)));
    await expect(fetchBasemapStyle(new AbortController().signal, fetchFn)).rejects.toThrow('basemap style HTTP 502');
  });
});
