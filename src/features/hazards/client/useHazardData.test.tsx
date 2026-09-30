// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayerStatusStore } from '@/lib/layer-host';
import { useHazardData } from './useHazardData';

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  useLayerStatusStore.setState({ status: {} });
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in unit tests'))));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useHazardData idle state (R2 minor 1)', () => {
  it('publishes idle with the zoom reason, not ACQUIRING/loading, while nothing is fetched', () => {
    renderHook(() => useHazardData('sentinel', null, () => 0, 'zoom_min_6'), { wrapper });
    expect(useLayerStatusStore.getState().status.sentinel).toMatchObject({ state: 'idle', count: null, error: 'zoom_min_6' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('goes back to idle with the reason when the url is cleared after a fetch', () => {
    const { rerender } = renderHook(({ url }: { url: string | null }) => useHazardData('sentinel', url, () => 0, 'zoom_min_6'), { wrapper, initialProps: { url: '/api/sentinel?lat=1&lng=2' as string | null } });
    expect(useLayerStatusStore.getState().status.sentinel?.state).toBe('loading');
    rerender({ url: null });
    expect(useLayerStatusStore.getState().status.sentinel).toMatchObject({ state: 'idle', error: 'zoom_min_6' });
  });
});
