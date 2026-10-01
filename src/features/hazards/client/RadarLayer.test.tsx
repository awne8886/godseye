// @vitest-environment jsdom
/**
 * visual-qa round 4 M2: the radar frame-time chip was an absolutely positioned overlay
 * (`absolute bottom-10 left-1/2`) that the phone attribution and bottom nav covered and that sat
 * ~2 px above the desktop hint row. It now joins MapLibre's bottom-right control stack (the imagery
 * chips' stack, placed by the HUD safe areas). Frames come from the recorded RainViewer fixture.
 */
import { act, cleanup, render } from '@testing-library/react';
import type { IControl } from 'maplibre-gl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RadarFramesResponse } from '@/lib/types';
import { FX, fixtureJson } from '../server/__fixtures__';
import { normalizeRainViewer } from '../server/radar';
import { RadarChipControl, radarFrameLabel } from './radar-chip';

/** A MapLibre-shaped stand-in: real DOM corners, MapLibre's insert order for bottom controls. */
function fakeMap() {
  const container = document.createElement('div');
  container.className = 'maplibregl-map';
  const corner = document.createElement('div');
  corner.className = 'maplibregl-ctrl-bottom-right';
  const attrib = document.createElement('div');
  attrib.className = 'maplibregl-ctrl maplibregl-ctrl-attrib';
  attrib.textContent = 'RainViewer | OpenFreeMap © OpenMapTiles Data from OpenStreetMap';
  const imagery = document.createElement('div');
  imagery.className = 'maplibregl-ctrl godseye-imagery-chips';
  corner.append(imagery, attrib);
  container.append(corner);
  document.body.append(container);
  const layers = new Set<string>();
  const sources = new Set<string>();
  const controls: IControl[] = [];
  const map = {
    corner,
    controls,
    getStyle: () => ({ layers: [] }),
    getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
    getSource: (id: string) => (sources.has(id) ? { id } : undefined),
    addSource: (id: string) => void sources.add(id),
    removeSource: (id: string) => void sources.delete(id),
    addLayer: (l: { id: string }) => void layers.add(l.id),
    removeLayer: (id: string) => void layers.delete(id),
    setPaintProperty: () => undefined,
    addControl: vi.fn((c: IControl, position: string) => {
      const el = c.onAdd(map as never);
      controls.push(c);
      // MapLibre: bottom corners insert new controls first (they stack above older ones).
      if (position.includes('bottom')) corner.insertBefore(el, corner.firstChild);
      else corner.append(el);
    }),
    removeControl: vi.fn((c: IControl) => {
      const i = controls.indexOf(c);
      if (i > -1) controls.splice(i, 1);
      c.onRemove(map as never);
    }),
  };
  return map;
}

let map: ReturnType<typeof fakeMap> | null = null;
let body: RadarFramesResponse | undefined;

vi.mock('@/lib/layer-host', () => ({ useMapInstance: () => map }));
vi.mock('./useHazardData', () => ({ useHazardData: () => body }));

const { default: RadarLayer } = await import('./RadarLayer');

function radarBody(): RadarFramesResponse {
  const { host, frames } = normalizeRainViewer(fixtureJson(FX.radar));
  return {
    meta: { feed: 'weather-radar', fetchedAt: '2026-09-30T05:25:30.000Z', observedAt: frames.at(-1)!.time, state: 'live' },
    providers: { rainviewer: { ok: true, count: frames.length, ms: 770, age_s: 0 } },
    host,
    frames,
    maxZoom: 7,
  } as unknown as RadarFramesResponse;
}

beforeEach(() => {
  map = fakeMap();
  body = radarBody();
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  map = null;
});

describe('radar frame-time chip placement (visual-qa r4 M2)', () => {
  it('renders inside the bottom-right control stack, above the imagery chips and the attribution', () => {
    render(<RadarLayer />);
    const chip = document.querySelector('[data-testid="radar-frame-chip"]');
    expect(chip).not.toBeNull();
    expect(chip!.closest('.maplibregl-ctrl-bottom-right')).toBe(map!.corner);
    expect(map!.addControl).toHaveBeenCalledWith(expect.any(RadarChipControl), 'bottom-right');
    const order = [...map!.corner.children].map((c) => c.className);
    expect(order).toEqual(['maplibregl-ctrl godseye-radar-chip', 'maplibregl-ctrl godseye-imagery-chips', 'maplibregl-ctrl maplibregl-ctrl-attrib']);
  });

  it('is no longer a free-floating overlay (the classes that overlapped the attribution, nav and hint row are gone)', () => {
    render(<RadarLayer />);
    const chip = document.querySelector('[data-testid="radar-frame-chip"]') as HTMLElement;
    for (const cls of ['absolute', 'fixed', 'bottom-10', 'left-1/2', '-translate-x-1/2']) expect(chip.classList.contains(cls)).toBe(false);
    expect(chip.className).toContain('hud-micro');
  });

  it('names the newest observed frame first, in UTC', () => {
    render(<RadarLayer />);
    const newest = body!.frames.at(-1)!.time;
    expect(document.querySelector('[data-testid="radar-frame-chip"]')!.textContent).toBe(radarFrameLabel(newest));
    expect(radarFrameLabel(newest)).toMatch(/^RADAR · RAINVIEWER · 2026-09-30 \d{2}:\d{2} UTC$/);
  });

  it('marks its control as a map inset and lets pointer events through to the map', () => {
    render(<RadarLayer />);
    const ctrl = map!.corner.firstElementChild as HTMLElement;
    expect(ctrl.dataset.mapInset).toBe('radar-frame');
    expect(ctrl.style.pointerEvents).toBe('none');
  });

  it('leaves the stack when the layer unmounts', () => {
    const { unmount } = render(<RadarLayer />);
    act(() => unmount());
    expect(map!.removeControl).toHaveBeenCalledTimes(1);
    expect(map!.corner.querySelector('.godseye-radar-chip')).toBeNull();
    expect(map!.corner.children).toHaveLength(2);
  });

  it('adds no (empty, margin-taking) control while there is no frame to name', () => {
    body = { ...radarBody(), frames: [] };
    render(<RadarLayer />);
    expect(map!.addControl).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="radar-frame-chip"]')).toBeNull();
  });

  it('renders nothing before the map exists', () => {
    const m = map!;
    map = null;
    render(<RadarLayer />);
    expect(m.addControl).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="radar-frame-chip"]')).toBeNull();
  });
});

describe('radarFrameLabel', () => {
  it('formats an observed ISO time as date + HH:MM UTC', () => {
    expect(radarFrameLabel('2026-10-01T06:20:00.000Z')).toBe('RADAR · RAINVIEWER · 2026-10-01 06:20 UTC');
  });
});
