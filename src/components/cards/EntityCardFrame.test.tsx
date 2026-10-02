// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LayerStatus, Selection } from '@/lib/layer-host';
import { trackFor } from './CardHost';
import EntityCardFrame from './EntityCardFrame';
import { sourceDisplayName } from './source-name';

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

  it('gives the aircraft card OVERVIEW / TRACK / SOURCES and an earthquake card OVERVIEW / SOURCES (§7)', () => {
    // The registry decides: aviation registers tracks.aircraft, hazards registers no earthquake track.
    expect(trackFor('aircraft')).not.toBeNull();
    expect(trackFor('satellite')).not.toBeNull();
    expect(trackFor('vessel')).not.toBeNull();
    expect(trackFor('earthquake')).toBeNull();
    const aircraft = sel({ kind: 'aircraft', id: '77058f', layer: 'flights', source: 'adsblol' });
    const Track = () => <p>flown track</p>;
    render(
      <EntityCardFrame selection={aircraft} feed={feed()} onClose={() => {}} track={trackFor('aircraft') ? <Track /> : undefined}>
        <p>body</p>
      </EntityCardFrame>,
    );
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['overview', 'track', 'sources']);
    fireEvent.click(screen.getByRole('tab', { name: 'track' }));
    expect(screen.getByRole('tabpanel', { name: 'track' }).textContent).toBe('flown track');
    cleanup();
    render(
      <EntityCardFrame selection={sel()} feed={feed()} onClose={() => {}} track={trackFor('earthquake') ? <Track /> : undefined}>
        <p>body</p>
      </EntityCardFrame>,
    );
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['overview', 'sources']);
  });

  it('moves between tabs with the arrow keys, Home and End (roving tabindex, ARIA tabs)', () => {
    render(
      <EntityCardFrame selection={sel()} feed={feed()} onClose={() => {}} track={<p>track body</p>}>
        <p>body</p>
      </EntityCardFrame>,
    );
    const tab = (name: string) => screen.getByRole('tab', { name });
    expect(tab('overview').getAttribute('aria-selected')).toBe('true');
    expect(tab('overview').tabIndex).toBe(0);
    expect(tab('track').tabIndex).toBe(-1);
    expect(screen.getByRole('tabpanel', { name: 'overview' }).id).toBe(tab('overview').getAttribute('aria-controls'));
    tab('overview').focus();
    fireEvent.keyDown(tab('overview'), { key: 'ArrowRight' });
    expect(tab('track').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('track'));
    expect(screen.getByText('track body')).toBeTruthy();
    fireEvent.keyDown(tab('track'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tab('sources'));
    fireEvent.keyDown(tab('sources'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tab('overview'));
    fireEvent.keyDown(tab('overview'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tab('sources'));
    fireEvent.keyDown(tab('sources'), { key: 'Home' });
    expect(document.activeElement).toBe(tab('overview'));
    fireEvent.keyDown(tab('overview'), { key: 'End' });
    expect(tab('sources').getAttribute('aria-selected')).toBe('true');
    // Touch targets: 28 px desktop, 44 px on the phone layout.
    expect(tab('track').className).toContain('phone:min-h-[44px]');
  });

  it('shows skipped providers as NOT CONFIGURED / LICENCE GATE, never FAILED (r10 MINOR 2)', () => {
    const cctv = sel({ kind: 'camera', id: 'tfl:1', layer: 'cctv', source: 'tfl' });
    render(
      <EntityCardFrame
        selection={cctv}
        feed={feed({
          providers: {
            tfl: { ok: false, count: 0, ms: 0, age_s: null, skipped: 'not-configured' },
            opensky: { ok: false, count: 0, ms: 0, age_s: null, skipped: 'licence' },
            usgs: { ok: false, count: 0, ms: 812, age_s: null, error: 'timeout' },
          },
        })}
        onClose={() => {}}
      >
        <p>body</p>
      </EntityCardFrame>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'sources' }));
    const row = (id: string) => document.querySelector(`[data-provider="${id}"]`)?.textContent;
    expect(row('tfl')).toMatch(/: NOT CONFIGURED · NEEDS KEY$/);
    expect(row('tfl')).not.toContain('FAILED');
    expect(row('opensky')).toMatch(/: LICENCE GATE$/);
    expect(row('usgs')).toBe('USGS Earthquake Hazards Program: FAILED · 0 · 812 ms');
  });

  it('names each FIRMS instrument on its own row instead of four identical FIRMS rows', () => {
    const ids = ['firms_viirs_snpp', 'firms_viirs_noaa20', 'firms_viirs_noaa21', 'firms_modis'];
    expect(ids.map((id) => sourceDisplayName(id))).toEqual(['NASA FIRMS VIIRS S-NPP', 'NASA FIRMS VIIRS NOAA-20', 'NASA FIRMS VIIRS NOAA-21', 'NASA FIRMS MODIS']);
    render(
      <EntityCardFrame
        selection={sel({ kind: 'fire', id: 'f1', layer: 'fires', source: 'firms' })}
        feed={feed({ providers: Object.fromEntries(ids.map((id) => [id, { ok: true, count: 10, ms: 100, age_s: 5 }])) })}
        onClose={() => {}}
      >
        <p>body</p>
      </EntityCardFrame>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'sources' }));
    const rows = ids.map((id) => document.querySelector(`[data-provider="${id}"]`)?.textContent);
    expect(new Set(rows).size).toBe(4);
    expect(rows[0]).toBe('NASA FIRMS VIIRS S-NPP: OK · 10 · 100 ms');
  });
});
