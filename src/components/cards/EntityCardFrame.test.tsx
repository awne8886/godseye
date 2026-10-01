// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LayerStatus, Selection } from '@/lib/layer-host';
import EntityCardFrame from './EntityCardFrame';

const sel = (over: Partial<Selection> = {}): Selection => ({
  kind: 'earthquake',
  id: 'us7000abcd',
  layer: 'earthquakes',
  source: 'usgs',
  observedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
  data: {},
  lngLat: [10, 20],
  ...over,
});

const feed = (over: Partial<LayerStatus> = {}): LayerStatus => ({
  state: 'live',
  count: 12,
  fetchedAt: new Date().toISOString(),
  observedAt: new Date().toISOString(),
  lastGoodAt: '2026-09-30T11:58:00.000Z',
  providers: { usgs: { ok: true, count: 12, ms: 210, age_s: 5 } },
  ...over,
});

afterEach(cleanup);

describe('entity card frame', () => {
  it('shows source, observed-at and the freshness badge', () => {
    render(
      <EntityCardFrame selection={sel()} feed={feed()} onClose={() => {}}>
        <p>body</p>
      </EntityCardFrame>,
    );
    // n7: the catalogue name, never the raw id.
    expect(screen.getByTestId('card-source').textContent).toBe('USGS Earthquake Hazards Program');
    expect(screen.queryByText('usgs')).toBeNull();
    expect(screen.getByText('3m ago')).toBeTruthy();
    // A 3-minute-old quake is older than the 60 s refresh: RECENT, not LIVE.
    expect(document.querySelector('[data-state]')?.getAttribute('data-state')).toBe('recent');
    expect(screen.getByText('body')).toBeTruthy();
    cleanup();
    render(
      <EntityCardFrame selection={sel({ observedAt: new Date(Date.now() - 20_000).toISOString() })} feed={feed()} onClose={() => {}}>
        <p>body</p>
      </EntityCardFrame>,
    );
    expect(document.querySelector('[data-state]')?.getAttribute('data-state')).toBe('live');
  });

  it('shows SOURCE OFFLINE with the last-good time when the feed failed', () => {
    render(
      <EntityCardFrame selection={sel()} feed={feed({ state: 'offline' })} onClose={() => {}}>
        <p>body</p>
      </EntityCardFrame>,
    );
    expect(screen.getByText(/SOURCE OFFLINE · LAST GOOD 2026-09-30 11:58:00Z/)).toBeTruthy();
    expect(document.querySelector('[data-state]')?.textContent).toContain('OFFLINE');
  });

  it('badges reference data as REFERENCE and never shows an observation time for it', () => {
    render(
      <EntityCardFrame selection={sel({ kind: 'nuclear_site', layer: 'infrastructure', observedAt: null })} feed={feed()} onClose={() => {}}>
        <p>body</p>
      </EntityCardFrame>,
    );
    expect(document.querySelector('[data-state]')?.getAttribute('data-state')).toBe('reference');
    expect(screen.getByText('REFERENCE DATA')).toBeTruthy();
  });

  it('lists providers on the Sources tab and closes', () => {
    const onClose = vi.fn();
    render(
      <EntityCardFrame selection={sel()} feed={feed()} onClose={onClose}>
        <p>body</p>
      </EntityCardFrame>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'sources' }));
    expect(screen.getByText(/USGS Earthquake Hazards Program: OK · 12 · 210 ms/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close card' }));
    expect(onClose).toHaveBeenCalled();
  });
});
