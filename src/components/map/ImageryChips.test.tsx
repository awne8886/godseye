// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
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

const { default: ImageryChips, summarizeChips } = await import('./ImageryChips');

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

describe('round 8: the phone layout folds the stack into one summary chip (worst tone, tap to expand)', () => {
  const night = { id: 'night', text: 'BLACK MARBLE 2016 · REFERENCE' };
  const gibs = { id: 'gibs', text: 'VIIRS TRUE COLOUR 2026-10-01 · REFERENCE' };
  const terrainDown = { id: 'terrain', text: TERRAIN_STATUS_TEXT.error };
  const items = () => [...document.querySelectorAll('[data-testid^="imagery-chip-"]')].map((el) => el.getAttribute('data-testid'));

  it('summarizes: a source that is down leads (alert tone), else the first chip; the rest are counted', () => {
    expect(summarizeChips([])).toBeNull();
    expect(summarizeChips([night, gibs])).toEqual({ lead: night, tone: 'reference', more: 1 });
    expect(summarizeChips([night, gibs, terrainDown])).toEqual({ lead: terrainDown, tone: 'offline', more: 2 });
    const holes = { id: 'esri', text: 'ESRI WORLD IMAGERY · REFERENCE · 3 TILES MISSING', tone: 'offline' as const };
    expect(summarizeChips([night, holes])!.lead).toBe(holes);
  });

  it('two or more chips: one summary row with the worst chip and a count; a tap shows every chip, another folds them', () => {
    render(<ImageryChips chips={[night, gibs, terrainDown]} collapse />);
    expect(items()).toEqual(['imagery-chip-summary']);
    const summary = document.querySelector('[data-testid="imagery-chip-summary"]')!;
    expect(summary.getAttribute('data-tone')).toBe('offline');
    expect(summary.textContent).toBe(`${TERRAIN_STATUS_TEXT.error}+2`);
    // One row for the route framing / HUD inset measurements (`.godseye-imagery-chips li`).
    expect(document.querySelectorAll('.godseye-imagery-chips li')).toHaveLength(1);
    const button = document.querySelector('button')!;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe(`Imagery on the map: ${TERRAIN_STATUS_TEXT.error} and 2 more. Show all`);
    // 44 px touch target (phone layout only).
    expect(button.className).toContain('min-h-11');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(items()).toEqual(['imagery-chip-night', 'imagery-chip-gibs', 'imagery-chip-terrain', 'imagery-chip-summary']);
    expect(tone('terrain')).toBe('offline');
    fireEvent.click(button);
    expect(items()).toEqual(['imagery-chip-summary']);
  });

  it('a single chip is shown as it is; desktop never folds', () => {
    render(<ImageryChips chips={[night]} collapse />);
    expect(items()).toEqual(['imagery-chip-night']);
    expect(document.querySelector('button')).toBeNull();
    cleanup();
    document.body.innerHTML = '';
    render(<ImageryChips chips={[night, gibs, terrainDown]} />);
    expect(items()).toEqual(['imagery-chip-night', 'imagery-chip-gibs', 'imagery-chip-terrain']);
    expect(document.querySelector('button')).toBeNull();
  });
});
