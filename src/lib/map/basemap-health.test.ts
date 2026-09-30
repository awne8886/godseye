import { describe, expect, it } from 'vitest';
import { BASEMAP_OFFLINE_AFTER, BASEMAP_RETRY_BASE_MS, BASEMAP_RETRY_MAX_MS, basemapChipText, createBasemapHealth } from './basemap-health';

describe('basemap health (R1-m2)', () => {
  it('reports BASEMAP OFFLINE after consecutive tile failures, with no invented last-good time', () => {
    const h = createBasemapHealth();
    for (let i = 1; i < BASEMAP_OFFLINE_AFTER; i++) expect(h.tileError().state).toBe('ok');
    const off = h.tileError();
    expect(off.state).toBe('offline');
    expect(off.lastGoodAt).toBeNull();
    expect(basemapChipText(off)).toBe('BASEMAP OFFLINE · RETRYING');
  });

  it('shows the last observed tile time once one arrived', () => {
    const h = createBasemapHealth();
    h.tileLoaded(Date.UTC(2026, 8, 30, 21, 5));
    for (let i = 0; i < BASEMAP_OFFLINE_AFTER; i++) h.tileError();
    expect(basemapChipText(h.get())).toBe('BASEMAP OFFLINE · LAST TILE 21:05 UTC · RETRYING');
  });

  it('retries with exponential backoff, capped, and recovers on the next tile', () => {
    const h = createBasemapHealth();
    for (let i = 0; i < BASEMAP_OFFLINE_AFTER; i++) h.tileError();
    expect(h.get().retryInMs).toBe(BASEMAP_RETRY_BASE_MS);
    expect(h.retried().retryInMs).toBe(BASEMAP_RETRY_BASE_MS * 2);
    for (let i = 0; i < 10; i++) h.retried();
    expect(h.get().retryInMs).toBe(BASEMAP_RETRY_MAX_MS);
    const ok = h.tileLoaded(1);
    expect(ok.state).toBe('ok');
    expect(ok.retryInMs).toBeNull();
    expect(basemapChipText(ok)).toBeNull();
  });
});
