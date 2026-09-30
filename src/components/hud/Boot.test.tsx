// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ACTIVE_LAYERS } from '@/lib/layer-registry';
import { landingCityFor } from '@/lib/presets';
import { DEFAULT_SETTINGS, useUiStore } from '@/lib/store';
import Boot, { sameSet } from './Boot';

function health(caps: Record<string, boolean>) {
  return {
    status: 'ok',
    version: '0.1.0',
    uptimeS: 1,
    capabilities: Object.fromEntries(Object.entries(caps).map(([k, enabled]) => [k, { enabled, reason: enabled ? null : 'off' }])),
    feeds: {},
    geocoder: { queueDepth: 0, maxQueue: 50, cached: 0, served: 0, rejected: 0 },
    store: 'memory',
    timestamp: new Date().toISOString(),
  };
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Boot />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useUiStore.setState({ activeLayers: new Set(DEFAULT_ACTIVE_LAYERS), splashDone: false, cameraFromUrl: false, flyTo: null, settings: DEFAULT_SETTINGS });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Boot', () => {
  it('drops licence-gated defaults once /api/health reports the capability off', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(health({ nc_sources: false })), { status: 200 })));
    mount();
    await waitFor(() => expect(useUiStore.getState().activeLayers.has('sdk_sea')).toBe(false));
    expect(useUiStore.getState().activeLayers.has('earthquakes')).toBe(true);
  });

  it('leaves the layer set untouched when every default is deployable', async () => {
    const before = useUiStore.getState().activeLayers;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(health({ nc_sources: true })), { status: 200 })));
    mount();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(useUiStore.getState().activeLayers).toBe(before);
  });

  it('flies to the deterministic landing city after the splash unless the camera came from the URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    mount();
    useUiStore.getState().setSplashDone();
    const city = landingCityFor(new Date());
    await waitFor(() => expect(useUiStore.getState().flyTo).toMatchObject({ lat: city.lat, lng: city.lng }));
    cleanup();
    useUiStore.setState({ splashDone: false, flyTo: null, cameraFromUrl: true });
    mount();
    useUiStore.getState().setSplashDone();
    await new Promise((r) => setTimeout(r, 20));
    expect(useUiStore.getState().flyTo).toBeNull();
  });

  it('sameSet compares membership', () => {
    expect(sameSet(new Set(['a', 'b']), ['b', 'a'])).toBe(true);
    expect(sameSet(new Set(['a']), ['a', 'b'])).toBe(false);
  });
});
