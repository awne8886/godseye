// @vitest-environment jsdom
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LayerRow } from '@/components/hud/LayerRows';
import { useLayerStatusStore } from '@/lib/layer-host';
import { getLayer } from '@/lib/layer-registry';
import { useUiStore } from '@/lib/store';
import { unplacedCountOf, useWeatherUnplaced } from './weather-status';

beforeEach(() => useLayerStatusStore.setState({ status: {} }));
afterEach(cleanup);

const status = () => useLayerStatusStore.getState().status.weather;

describe('weather unplacedCount (L107)', () => {
  it('reads body.unplacedAlerts, defaulting to 0', () => {
    expect(unplacedCountOf({ unplacedAlerts: 7 })).toBe(7);
    expect(unplacedCountOf({})).toBe(0);
    expect(unplacedCountOf(null)).toBe(0);
  });

  it('publishes the count, follows refreshes, resets when offline and clears on unmount', () => {
    const { rerender, unmount } = renderHook(({ body }: { body: { unplacedAlerts?: number } | null }) => useWeatherUnplaced(body), {
      initialProps: { body: { unplacedAlerts: 12 } as { unplacedAlerts?: number } | null },
    });
    expect(status()?.unplacedCount).toBe(12);
    rerender({ body: { unplacedAlerts: 3 } });
    expect(status()?.unplacedCount).toBe(3);
    rerender({ body: null });
    expect(status()?.unplacedCount).toBe(0);
    rerender({ body: { unplacedAlerts: 5 } });
    unmount();
    expect(status()?.unplacedCount).toBe(0);
  });

  it('patches without clobbering the feed status fields', () => {
    useLayerStatusStore.getState().update('weather', { state: 'live', count: 40 });
    renderHook(() => useWeatherUnplaced({ unplacedAlerts: 2 }));
    expect(status()).toMatchObject({ state: 'live', count: 40, unplacedCount: 2 });
  });

  it('the rail row shows N ALERTS AWAITING ZONE OUTLINES only when the count is positive', () => {
    useUiStore.getState().setLayer('weather', true);
    useLayerStatusStore.getState().update('weather', { state: 'live', count: 40, unplacedCount: 1234 });
    render(
      <ul>
        <LayerRow layer={getLayer('weather')!} />
      </ul>,
    );
    expect(screen.getByTestId('unplaced-weather').textContent).toBe('1,234 ALERTS AWAITING ZONE OUTLINES');
    cleanup();
    useLayerStatusStore.getState().update('weather', { unplacedCount: 0 });
    render(
      <ul>
        <LayerRow layer={getLayer('weather')!} />
      </ul>,
    );
    expect(screen.queryByTestId('unplaced-weather')).toBeNull();
  });
});
