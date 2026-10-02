// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EntityCardFrame from '@/components/cards/EntityCardFrame';
import { useLayerStatusStore, type Selection } from '@/lib/layer-host';
import type { Earthquake, WeatherEvent } from '@/lib/types';
import { EarthquakeCard, FireCard, GpsJamCard, WeatherEventCard } from './cards';

vi.mock('next/image', () => ({ default: () => null }));

const NOW = Date.parse('2026-09-30T18:00:00Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  useLayerStatusStore.setState({ status: {} });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const quake: Earthquake = {
  id: 'us6000tyke',
  lat: -0.7769,
  lng: 122.3906,
  observedAt: '2026-09-30T16:29:32.799Z',
  source: 'usgs',
  magnitude: 4.4,
  magType: 'mb',
  depthKm: 10,
  place: '48 km WNW of Luwuk, Indonesia',
  url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us6000tyke',
  tsunami: false,
  felt: null,
  alert: null,
  significance: 298,
};

const sel = (kind: Selection['kind'], layer: Selection['layer'], data: object, source = 'usgs', observedAt: string | null = null): Selection => ({
  kind,
  id: 'x',
  layer,
  source,
  observedAt,
  data: data as Record<string, unknown>,
  lngLat: null,
});

describe('hazards cards', () => {
  it('earthquake card names the originator with a safe link and the event details', () => {
    render(<EarthquakeCard selection={sel('earthquake', 'earthquakes', quake, 'usgs', quake.observedAt)} />);
    expect(screen.getByTestId('card-source').textContent).toMatch(/USGS Earthquake Hazards Program/);
    expect(screen.getByText(/M4\.4/)).toBeTruthy();
    const link = screen.getByText('USGS event page').closest('a')!;
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('does not repeat the frame SOURCE / OBSERVED / freshness badge in the body (visual-qa m7)', () => {
    useLayerStatusStore.getState().update('earthquakes', { state: 'live', fetchedAt: '2026-09-30T17:59:30.000Z', count: 33 });
    const s = sel('earthquake', 'earthquakes', quake, 'usgs', quake.observedAt);
    const { container } = render(
      <EntityCardFrame selection={s} feed={useLayerStatusStore.getState().status.earthquakes} onClose={() => {}}>
        <EarthquakeCard selection={s} />
      </EntityCardFrame>,
    );
    const text = container.textContent ?? '';
    expect(text.match(/OBSERVED/g)).toHaveLength(1);
    expect(text.match(/SOURCE(?! OFFLINE)/g)).toHaveLength(1);
    expect(container.querySelectorAll('[data-state]')).toHaveLength(1);
    expect(screen.queryByTestId('card-freshness')).toBeNull();
    expect(screen.queryByTestId('card-observed')).toBeNull();
  });

  it('fire card states the overpass time and the FRP sampling', () => {
    const f = { frpMw: 3200.5, brightnessK: 400, confidence: 'high', dayNight: 'D', satellite: 'NOAA20', lat: 1, lng: 2, source: 'firms', observedAt: '2026-09-30T12:03:00.000Z' };
    render(<FireCard selection={sel('fire', 'fires', f, 'firms', f.observedAt)} />);
    expect(screen.getByText(/3,200\.5 MW/)).toBeTruthy();
    expect(screen.getByText(/strongest pixels by fire radiative power/)).toBeTruthy();
    expect(screen.getByTestId('card-source').textContent).toMatch(/NASA FIRMS/);
  });

  it('weather card renders upstream text as text and explains zone placement', () => {
    const e: WeatherEvent = { id: 'nws-1', lat: 42, lng: -88, observedAt: '2026-09-30T18:02:00.000Z', source: 'nws', title: '<b>Flood Warning</b>', type: 'flood', severity: 'high', provider: 'NOAA/NWS', expiresAt: null, area: 'Boone, IL', url: 'javascript:alert(1)', geometry: null, positionBasis: 'zone-centroid' };
    const { container } = render(<WeatherEventCard selection={sel('weather_event', 'weather', e, 'nws', e.observedAt)} />);
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByText('<b>Flood Warning</b>')).toBeTruthy();
    expect(screen.queryByText('Source report')).toBeNull();
    expect(screen.getByText(/centre of an affected NWS zone/)).toBeTruthy();
  });

  it('gps jam card names the basis, the licence and the UTC day of a daily aggregate', () => {
    const c = { h3: '8400ec3ffffffff', lat: 1, lng: 2, badRatio: 0.5, aircraft: 2, bad: 1, basis: 'gpsjam-daily', date: '2026-09-29', suspect: false };
    render(<GpsJamCard selection={sel('gps_jam_cell', 'gps_jam', c, 'gpsjam', '2026-09-29T23:59:59.000Z')} />);
    expect(screen.getByTestId('card-source').textContent).toMatch(/licence unstated/);
    expect(screen.getByText('50.0 %')).toBeTruthy();
    expect(screen.getByText(/daily aggregate for 2026-09-29/)).toBeTruthy();
    expect(screen.getByTestId('card-observed-day').textContent).toBe('UTC DAY 2026-09-29 · DAILY AGGREGATE');
  });

  it('live NACp cell has no daily-aggregate day line', () => {
    const c = { h3: '8400ec3ffffffff', lat: 1, lng: 2, badRatio: 0.34, aircraft: 3, bad: 1, basis: 'live-nacp', date: null };
    render(<GpsJamCard selection={sel('gps_jam_cell', 'gps_jam', c, 'live_nacp', '2026-09-30T17:59:00.000Z')} />);
    expect(screen.queryByTestId('card-observed-day')).toBeNull();
    expect(screen.getByText(/NACp ≤ 4/)).toBeTruthy();
  });
});
