import { describe, expect, it } from 'vitest';
import { BASEMAP_OFFLINE_AFTER, BASEMAP_RETRY_BASE_MS, BASEMAP_RETRY_MAX_MS, basemapChipText, createBasemapHealth, heldTileKeys, retryTargets } from './basemap-health';

describe('R1r4-m2: retries ask again for the failed tiles only', () => {
  it('lists the failed tiles by id and targets them (never the whole viewport while ids are known)', () => {
    const h = createBasemapHealth();
    h.tileLoaded(1, '3/4/2');
    h.tileError('3/4/3');
    h.tileError('3/5/3');
    expect(h.failedTiles()).toEqual([
      { z: 3, x: 4, y: 3 },
      { z: 3, x: 5, y: 3 },
    ]);
    expect(retryTargets(h.get(), h.failedTiles())).toEqual(h.failedTiles());
    h.tileLoaded(2, '3/4/3');
    expect(retryTargets(h.get(), h.failedTiles())).toEqual([{ z: 3, x: 5, y: 3 }]);
  });

  it('reloads the whole source only when the host is offline and no tile id was reported', () => {
    const h = createBasemapHealth();
    for (let i = 0; i < BASEMAP_OFFLINE_AFTER; i++) h.tileError();
    expect(retryTargets(h.get(), h.failedTiles())).toBe('source');
    expect(retryTargets(createBasemapHealth().get(), [])).toBeNull();
  });

  it('a camera move drops failed tiles that left the view and keeps the holes still in view', () => {
    const h = createBasemapHealth();
    h.tileLoaded(1, '3/4/2');
    h.tileError('3/4/3');
    h.tileError('3/0/0');
    const s = h.keepInView(new Set(['3/4/2', '3/4/3']));
    expect(s.state).toBe('incomplete');
    expect(s.missing).toBe(1);
    expect(h.failedTiles()).toEqual([{ z: 3, x: 4, y: 3 }]);
    expect(h.keepInView(new Set()).state).toBe('ok');
  });

  it('reads the held tile keys from the tile manager, or null when it is unreachable', () => {
    const tile = (z: number, x: number, y: number) => ({ tileID: { canonical: { z, x, y } } });
    const tiles: Record<string, ReturnType<typeof tile>> = { a: tile(3, 4, 2), b: tile(3, 4, 3) };
    const map = { style: { tileManagers: { openmaptiles: { getIds: () => Object.keys(tiles), getTileByID: (id: string) => tiles[id] } } } };
    expect([...heldTileKeys(map, 'openmaptiles')!]).toEqual(['3/4/2', '3/4/3']);
    expect(heldTileKeys(map, 'other')).toBeNull();
    expect(heldTileKeys({}, 'openmaptiles')).toBeNull();
  });
});

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

describe('basemap health: holes and stalls are reported (R3-M2, R3-m8)', () => {
  it('a failed tile among loaded ones reads INCOMPLETE until that tile loads', () => {
    const h = createBasemapHealth();
    h.tileLoaded(1, '2/1/1');
    const s = h.tileError('2/0/2');
    expect(s.state).toBe('incomplete');
    expect(s.retryInMs).toBe(BASEMAP_RETRY_BASE_MS);
    expect(basemapChipText(h.tileLoaded(2, '2/1/2'))).toBe('BASEMAP INCOMPLETE · 1 TILE MISSING · RETRYING');
    expect(h.tileLoaded(3, '2/0/2').state).toBe('ok');
  });

  it('forgets missing tiles after a camera move (the host re-requests the view)', () => {
    const h = createBasemapHealth();
    h.tileError('2/0/2');
    h.tileError('2/2/0');
    expect(h.get().missing).toBe(2);
    expect(h.forgetMissing().state).toBe('ok');
  });

  it('tiles still loading after the stall window read LOADING, with the last observed tile time only', () => {
    const h = createBasemapHealth();
    expect(basemapChipText(h.setStalled(true))).toBe('BASEMAP LOADING');
    h.tileLoaded(Date.UTC(2026, 9, 1, 4, 10));
    expect(basemapChipText(h.get())).toBe('BASEMAP LOADING · LAST TILE 04:10 UTC');
    expect(h.setStalled(false).state).toBe('ok');
  });
});
