// @vitest-environment jsdom
/**
 * Verification round 6 (MAJOR): Style Studio SATELLITES swatches rewrite `--map-sat-*` without
 * changing the preset theme. The worker colours every frame from the palette it was last sent, and
 * the palette was only re-posted when the view, selection, theme or catalogue changed, so the
 * satellites never took the new colours. A `godseye:style` bump now re-posts the view with the
 * re-read palette (the worker re-filters its newest propagation with it at once).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAP_STYLE_EVENT } from '@/lib/map/style-version';
import { SAT_CATEGORIES } from './lib/catalog';
import type { WorkerIn } from './lib/propagator';

/** Records what the layer posts to the tle-propagate worker; it never answers (no frames). */
class RecordingWorker {
  static last: RecordingWorker | null = null;
  posted: WorkerIn[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  constructor() {
    RecordingWorker.last = this;
  }
  postMessage(msg: WorkerIn) {
    this.posted.push(msg);
  }
  terminate() {}
}

vi.stubGlobal('Worker', RecordingWorker);
vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));

const { default: SatelliteLayer } = await import('./SatelliteLayer');

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('style');
});

describe('satellite palette follows Style Studio (style version)', () => {
  it('a style-version bump re-posts the view with the re-read --map-sat-* palette', () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <SatelliteLayer active={new Set(['satellites'])} />
      </QueryClientProvider>,
    );
    const w = RecordingWorker.last!;
    const views = () => w.posted.filter((m): m is Extract<WorkerIn, { type: 'view' }> => m.type === 'view');
    const before = views().length;
    expect(before).toBeGreaterThan(0);

    act(() => {
      document.documentElement.style.setProperty('--map-sat-comms', '#123456');
      window.dispatchEvent(new CustomEvent(MAP_STYLE_EVENT));
    });
    expect(views().length).toBe(before + 1);
    const palette = views().at(-1)!.palette;
    expect(palette).toHaveLength(SAT_CATEGORIES.length);
    expect(palette.some((c) => c[0] === 0x12 && c[1] === 0x34 && c[2] === 0x56)).toBe(true);
    expect(views()[before - 1]!.palette.some((c) => c[0] === 0x12 && c[1] === 0x34 && c[2] === 0x56)).toBe(false);
  });
});

describe('r10 MAJOR 1: the worker draws flat in mercator', () => {
  it('the view says `flat` exactly when the map is in mercator', async () => {
    const { useMapInstanceStore } = await import('@/lib/layer-host');
    const qc = new QueryClient();
    act(() => useMapInstanceStore.getState().setProjection('globe'));
    render(
      <QueryClientProvider client={qc}>
        <SatelliteLayer active={new Set(['satellites'])} />
      </QueryClientProvider>,
    );
    const w = RecordingWorker.last!;
    const views = () => w.posted.filter((m): m is Extract<WorkerIn, { type: 'view' }> => m.type === 'view');
    expect(views().at(-1)!.flat).toBe(false);
    act(() => useMapInstanceStore.getState().setProjection('mercator'));
    expect(views().at(-1)!.flat).toBe(true);
    expect(views().at(-1)!.camera).toBeNull();
    act(() => useMapInstanceStore.getState().setProjection('globe'));
    expect(views().at(-1)!.flat).toBe(false);
  });
});
