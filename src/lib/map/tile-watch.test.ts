import { describe, expect, it } from 'vitest';
import { BASEMAP_RETRY_BASE_MS, BASEMAP_STALL_MS, type BasemapHealth, basemapChipText, imageryChipText, tilesDegraded } from './basemap-health';
import { ESRI_LABEL, ESRI_SOURCE_ID, GIBS_TRUECOLOR_SOURCE_ID, gibsTrueColorLabel } from './imagery';
import { NIGHT_SOURCE_ID } from './night-lights';
import { STALL_CHECK_MS, type TileWatchMap, watchTileSources } from './tile-watch';

const BASEMAP = 'openmaptiles';
type Handler = (e?: unknown) => void;

/** A MapLibre stand-in: events, per-source loading flags, refreshTiles calls and held tiles. */
function fakeMap(loadedAtStart = false) {
  const handlers = new Map<string, Set<Handler>>();
  const busy = new Set<string>();
  const refreshed: { id: string; tiles?: unknown }[] = [];
  const held = new Map<string, string[]>();
  const map: TileWatchMap & { style: unknown } = {
    on: (t, fn) => void (handlers.get(t) ?? handlers.set(t, new Set()).get(t)!).add(fn),
    off: (t, fn) => void handlers.get(t)?.delete(fn),
    getSource: () => ({}),
    isSourceLoaded: (id) => !busy.has(id),
    refreshTiles: (id, tiles) => void refreshed.push({ id, tiles }),
    loaded: () => loadedAtStart,
    style: {
      tileManagers: new Proxy(
        {},
        {
          get: (_t, id: string) =>
            held.has(id)
              ? {
                  getIds: () => held.get(id)!,
                  getTileByID: (k: string) => {
                    const [z, x, y] = k.split('/').map(Number);
                    return { tileID: { canonical: { z, x, y } } };
                  },
                }
              : undefined,
        },
      ),
    },
  };
  const fire = (t: string, e?: unknown) => [...(handlers.get(t) ?? [])].forEach((h) => h(e));
  const tile = (z: number, x: number, y: number) => ({ tileID: { canonical: { z, x, y } } });
  return {
    map,
    busy,
    refreshed,
    held,
    listeners: () => [...handlers.values()].reduce((n, s) => n + s.size, 0),
    tileLoaded: (sourceId: string, z: number, x: number, y: number) => fire('sourcedata', { sourceId, tile: tile(z, x, y) }),
    tileFailed: (sourceId: string, z: number, x: number, y: number) => fire('error', { sourceId, tile: tile(z, x, y), error: new Error('net::ERR_TOO_MANY_RETRIES') }),
    render: () => fire('render'),
    moveEnd: () => fire('moveend'),
  };
}

function fakeTimers() {
  let clock = Date.UTC(2026, 9, 1, 19, 0);
  let seq = 0;
  const timers = new Map<number, { at: number; cb: () => void; every?: number }>();
  return {
    timers: {
      setTimeout: (cb: () => void, ms: number) => (timers.set(++seq, { at: clock + ms, cb }), seq),
      clearTimeout: (id: unknown) => void timers.delete(id as number),
      setInterval: (cb: () => void, ms: number) => (timers.set(++seq, { at: clock + ms, cb, every: ms }), seq),
      clearInterval: (id: unknown) => void timers.delete(id as number),
      now: () => clock,
    },
    advance(ms: number) {
      const end = clock + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, t] = next;
        clock = t.at;
        if (t.every) t.at += t.every;
        else timers.delete(id);
        t.cb();
      }
      clock = end;
    },
    pending: () => timers.size,
  };
}

/** Mirrors MapView's WATCHED_TILE_SOURCES: only the vector basemap retries failed tiles by id. */
const SOURCES = [
  { id: BASEMAP, stall: true, firstPaint: true, retry: true },
  { id: ESRI_SOURCE_ID, retry: false },
  { id: GIBS_TRUECOLOR_SOURCE_ID, retry: false },
  { id: NIGHT_SOURCE_ID, retry: false },
];

function setup(loadedAtStart = false) {
  const m = fakeMap(loadedAtStart);
  const t = fakeTimers();
  const seen: Record<string, BasemapHealth> = {};
  const changes: string[] = [];
  const watch = watchTileSources(m.map, SOURCES, (id, h) => {
    seen[id] = h;
    changes.push(`${id}:${h.state}`);
  }, t.timers);
  return { ...m, ...t, watch, seen, changes };
}

describe('R1r5 visual-qa m3: BASEMAP LOADING from the first frame until the basemap has painted', () => {
  it('starts loading (neutral chip text) and ends at the first frame rendered after a basemap tile', () => {
    const s = setup();
    expect(s.seen[BASEMAP]!.state).toBe('loading');
    expect(basemapChipText(s.seen[BASEMAP]!)).toBe('BASEMAP LOADING');
    s.render(); // the globe's first frame: no basemap tile yet
    expect(s.seen[BASEMAP]!.state).toBe('loading');
    s.tileLoaded(BASEMAP, 2, 1, 1);
    expect(s.seen[BASEMAP]!.state).toBe('loading'); // arrived, not painted yet
    s.render();
    expect(s.seen[BASEMAP]!.state).toBe('ok');
    expect(basemapChipText(s.seen[BASEMAP]!)).toBeNull();
  });

  it('an imagery tile does not end the basemap’s loading state; a map already loaded starts ok', () => {
    const s = setup();
    s.tileLoaded(ESRI_SOURCE_ID, 2, 1, 1);
    s.render();
    expect(s.seen[BASEMAP]!.state).toBe('loading');
    expect(setup(true).seen[BASEMAP]!.state).toBe('ok');
  });

  it('a host that hangs from the start turns the neutral LOADING into the stalled (alert) LOADING after the stall window', () => {
    const s = setup();
    s.busy.add(BASEMAP);
    s.advance(BASEMAP_STALL_MS + STALL_CHECK_MS);
    expect(s.seen[BASEMAP]!.state).toBe('stalled');
    expect(basemapChipText(s.seen[BASEMAP]!)).toBe('BASEMAP LOADING');
  });

  it('failures before the first paint read OFFLINE (never LOADING forever)', () => {
    const s = setup();
    for (let i = 0; i < 3; i++) s.tileFailed(BASEMAP, 3, i, 0);
    expect(s.seen[BASEMAP]!.state).toBe('offline');
  });
});

describe('R1r5 visual-qa m10: holes in the imagery overlays are announced', () => {
  it('a failed Esri tile among loaded ones reads N TILES MISSING until it loads (never refreshed: raster retry crashes the draw)', () => {
    const s = setup(true);
    s.tileLoaded(ESRI_SOURCE_ID, 4, 8, 5);
    s.tileFailed(ESRI_SOURCE_ID, 4, 8, 6);
    s.tileFailed(ESRI_SOURCE_ID, 4, 9, 6);
    const h = s.seen[ESRI_SOURCE_ID]!;
    expect(h.state).toBe('incomplete');
    expect(imageryChipText(ESRI_LABEL, h)).toBe('ESRI WORLD IMAGERY · REFERENCE · 2 TILES MISSING');
    expect(tilesDegraded(h)).toBe(true);
    s.advance(BASEMAP_RETRY_BASE_MS * 8);
    // Round-5 BLOCKING 4: refreshTiles on a failed raster tile leaves MapLibre drawing a tile with
    // no texture (TypeError in the raster draw, whole frame lost). The hole stays reported instead.
    expect(s.refreshed).toEqual([]);
    expect(s.pending()).toBe(1); // only the stall check interval
    s.tileLoaded(ESRI_SOURCE_ID, 4, 8, 6);
    expect(imageryChipText(ESRI_LABEL, s.seen[ESRI_SOURCE_ID])).toBe('ESRI WORLD IMAGERY · REFERENCE · 1 TILE MISSING');
    s.tileLoaded(ESRI_SOURCE_ID, 4, 9, 6);
    expect(imageryChipText(ESRI_LABEL, s.seen[ESRI_SOURCE_ID])).toBe(ESRI_LABEL);
    expect(tilesDegraded(s.seen[ESRI_SOURCE_ID])).toBe(false);
    // The basemap is not touched by imagery failures.
    expect(s.seen[BASEMAP]!.state).toBe('ok');
  });

  it('a GIBS host that keeps failing reads SOURCE OFFLINE with the last tile that really arrived', () => {
    const s = setup(true);
    const label = gibsTrueColorLabel('2026-09-30');
    s.tileLoaded(GIBS_TRUECOLOR_SOURCE_ID, 3, 4, 3);
    s.advance(5 * 60_000);
    for (let i = 0; i < 3; i++) s.tileFailed(GIBS_TRUECOLOR_SOURCE_ID, 3, i, 2);
    expect(imageryChipText(label, s.seen[GIBS_TRUECOLOR_SOURCE_ID])).toBe('VIIRS TRUE COLOUR 2026-09-30 · REFERENCE · SOURCE OFFLINE · LAST TILE 19:00 UTC');
    expect(imageryChipText(label, null)).toBe(label);
  });

  it('Black Marble holes count too; holes that left the view are forgotten on moveend; reset() clears a switched-off overlay', () => {
    const s = setup(true);
    s.tileLoaded(NIGHT_SOURCE_ID, 3, 1, 1);
    s.tileFailed(NIGHT_SOURCE_ID, 3, 1, 2);
    s.tileFailed(NIGHT_SOURCE_ID, 3, 7, 7);
    expect(s.seen[NIGHT_SOURCE_ID]!.missing).toBe(2);
    s.held.set(NIGHT_SOURCE_ID, ['3/1/1', '3/1/2']);
    s.moveEnd();
    expect(s.seen[NIGHT_SOURCE_ID]!.missing).toBe(1);
    s.watch.reset(NIGHT_SOURCE_ID);
    expect(s.seen[NIGHT_SOURCE_ID]!.state).toBe('ok');
    expect(s.watch.get(NIGHT_SOURCE_ID)!.missing).toBe(0);
    // No retry is left behind for the overlay that was switched off.
    s.advance(120_000);
    expect(s.refreshed.filter((r) => r.id === NIGHT_SOURCE_ID)).toEqual([]);
  });

  it('Black Marble and GIBS failures (the default night layer) never call refreshTiles', () => {
    const s = setup(true);
    s.tileLoaded(NIGHT_SOURCE_ID, 3, 1, 1);
    for (let i = 0; i < 3; i++) s.tileFailed(NIGHT_SOURCE_ID, 3, 2, i);
    s.tileLoaded(GIBS_TRUECOLOR_SOURCE_ID, 3, 1, 1);
    s.tileFailed(GIBS_TRUECOLOR_SOURCE_ID, 3, 2, 2);
    s.held.set(NIGHT_SOURCE_ID, ['3/1/1', '3/2/0', '3/2/1', '3/2/2']);
    s.held.set(GIBS_TRUECOLOR_SOURCE_ID, ['3/1/1', '3/2/2']);
    s.moveEnd();
    s.advance(10 * 60_000);
    expect(s.refreshed).toEqual([]);
    expect(s.seen[NIGHT_SOURCE_ID]!.missing).toBeGreaterThan(0);
  });

  it('the vector basemap still retries its failed tiles by id', () => {
    const s = setup(true);
    s.tileLoaded(BASEMAP, 4, 8, 5);
    s.tileFailed(BASEMAP, 4, 8, 6);
    s.advance(BASEMAP_RETRY_BASE_MS);
    expect(s.refreshed).toEqual([{ id: BASEMAP, tiles: [{ z: 4, x: 8, y: 6 }] }]);
  });

  it('dispose removes every listener and timer', () => {
    const s = setup();
    s.tileFailed(BASEMAP, 2, 0, 0);
    s.watch.dispose();
    expect(s.listeners()).toBe(0);
    expect(s.pending()).toBe(0);
  });
});
