// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { basemapChipText, type BasemapHealth, imageryChipText, tilesDegraded } from '@/lib/map/basemap-health';
import { ESRI_LABEL } from '@/lib/map/imagery';
import { TERRAIN_STATUS_TEXT } from '@/lib/map/terrain';
import BasemapPending from './BasemapPending';

// The chip control lives in the map's control container; outside a map, mount it in the body.
vi.mock('react-map-gl/maplibre', () => ({
  useControl: (make: () => { el: HTMLElement }) => {
    const c = make();
    if (!c.el.isConnected) document.body.appendChild(c.el);
    return c;
  },
}));

const { default: ImageryChips } = await import('./ImageryChips');

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

const tone = (id: string) => document.querySelector(`[data-testid="imagery-chip-${id}"]`)?.getAttribute('data-tone');

describe('ImageryChips tones (m3: a source that is down uses the alert tone)', () => {
  it('BASEMAP OFFLINE and terrain unavailable are offline; dated imagery and other terrain states are reference', () => {
    const offline = basemapChipText({ state: 'offline', lastGoodAt: null, retryInMs: 4000, missing: 0 })!;
    render(
      <ImageryChips
        chips={[
          { id: 'basemap', text: offline },
          { id: 'night', text: 'BLACK MARBLE 2016 · REFERENCE' },
          { id: 'terrain', text: TERRAIN_STATUS_TEXT.error },
        ]}
      />,
    );
    expect(tone('basemap')).toBe('offline');
    expect(tone('night')).toBe('reference');
    expect(tone('terrain')).toBe('offline');
  });

  it.each(['idle', 'waiting', 'loading', 'ready'] as const)('terrain %s is a reference chip', (st) => {
    render(<ImageryChips chips={[{ id: 'terrain', text: TERRAIN_STATUS_TEXT[st] }]} />);
    expect(tone('terrain')).toBe('reference');
  });

  it('R1r5 m10/m3: an imagery overlay with holes takes the alert tone; BASEMAP LOADING before the first paint stays neutral', () => {
    const holes: BasemapHealth = { state: 'incomplete', lastGoodAt: 1, retryInMs: 2000, missing: 3 };
    render(
      <ImageryChips
        chips={[
          { id: 'basemap-loading', text: basemapChipText({ state: 'loading', lastGoodAt: null, retryInMs: null, missing: 0 })!, tone: 'reference' },
          { id: 'esri', text: imageryChipText(ESRI_LABEL, holes), tone: tilesDegraded(holes) ? 'offline' : undefined },
        ]}
      />,
    );
    expect(tone('basemap-loading')).toBe('reference');
    expect(tone('esri')).toBe('offline');
    expect(document.querySelector('[data-testid="imagery-chip-esri"]')!.textContent).toBe('ESRI WORLD IMAGERY · REFERENCE · 3 TILES MISSING');
  });
});

describe('R1r5 m3: BASEMAP LOADING from the first frame (before the map exists)', () => {
  it('the pending map area shows the neutral LOADING chip as a map inset, where the chip stack will be', () => {
    render(<BasemapPending phone={false} />);
    const chip = document.querySelector('[data-testid="imagery-chip-basemap-loading"]')!;
    expect(chip.textContent).toBe('BASEMAP LOADING');
    expect(chip.getAttribute('data-tone')).toBe('reference');
    expect(chip.getAttribute('data-map-inset')).toBe('imagery-chip');
    expect(document.querySelector('[data-testid="map-pending"]')!.getAttribute('data-basemap-state')).toBe('loading');
    // Never a second "status" region: the HUD splash is the page's loading status.
    expect(document.querySelector('[role="status"]')).toBeNull();
    cleanup();
    render(<BasemapPending phone />);
    expect((document.querySelector('.godseye-imagery-chips') as HTMLElement).style.bottom).toContain('safe-area-inset-bottom');
  });
});
