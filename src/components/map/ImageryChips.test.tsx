// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { basemapChipText } from '@/lib/map/basemap-health';
import { TERRAIN_STATUS_TEXT } from '@/lib/map/terrain';

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
    const offline = basemapChipText({ state: 'offline', lastGoodAt: null, retryInMs: 4000 })!;
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
});
