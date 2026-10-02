// @vitest-environment jsdom
/**
 * visual-qa round 5 m11: with a capability off, the browser still requested /api/frontlines and
 * /api/cloudflare-radar every poll and logged the 403s. Gated layers now read /api/health first
 * (the HUD's cached query) and are never requested while their capability is off; the row states
 * the skipped capability instead (NEEDS KEY for a missing key, a licence skip otherwise). Health
 * bodies follow the /api/health shape (capabilities: {enabled, reason}); no network.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createElement, type ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ThreatsLayer from '@/features/threats/client/ThreatsLayer';
import { capabilityGate, gatedStatus } from '@/features/threats/client/hooks';
import type { LayerComponentProps } from '@/lib/feature-module';
import type { LayerId } from '@/lib/layer-registry';
import { useLayerStatusStore, useMapInstanceStore } from '@/lib/layer-host';
import NetworkLayer from './NetworkLayer';

const at = '2026-09-30T20:00:00.000Z';
const envelope = (feed: string) => ({ meta: { feed, kind: 'live', state: 'live', fetchedAt: at, observedAt: at, lastGoodAt: at, stale: false, ttlSeconds: 300, attribution: [] }, providers: {} });
const OFF = {
  nc_sources: { enabled: false, reason: 'COMMERCIAL_DEPLOYMENT is "true"' },
  cloudflare: { enabled: false, reason: 'CLOUDFLARE_API_TOKEN not set' },
  deepstate: { enabled: false, reason: 'NONCOMMERCIAL is not "true"' },
};
const ON = {
  nc_sources: { enabled: true, reason: null },
  cloudflare: { enabled: true, reason: null },
  deepstate: { enabled: true, reason: null },
};
const health = (caps: Record<string, { enabled: boolean; reason: string | null }>) => ({ status: 'ok', routes: [], version: '0.1.0', uptimeS: 1, capabilities: caps, feeds: {}, geocoder: {}, store: 'memory', timestamp: at });

let urls: string[] = [];
let streams: string[] = [];
function serve(caps: Record<string, { enabled: boolean; reason: string | null }>) {
  urls = [];
  streams = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string) => {
      urls.push(u);
      if (u === '/api/health') return new Response(JSON.stringify(health(caps)), { status: 200 });
      if (u.startsWith('/api/cyber-threats')) return new Response(JSON.stringify({ items: [], catalogVersion: null, ...envelope('cyber-threats') }), { status: 200 });
      if (u.startsWith('/api/cloudflare-radar')) return new Response(JSON.stringify({ items: [], window: '7d', ...envelope('cloudflare-radar') }), { status: 200 });
      if (u.startsWith('/api/cyber-attacks')) return new Response(JSON.stringify({ items: [], ...envelope('cyber-attacks') }), { status: 200 });
      if (u.startsWith('/api/frontlines')) return new Response(JSON.stringify({ geojson: { type: 'FeatureCollection', features: [] }, asOf: at, ...envelope('frontlines') }), { status: 200 });
      return new Response('{}', { status: 404 });
    }),
  );
  class FakeEventSource {
    static readonly CLOSED = 2;
    readyState = 0;
    onerror: (() => void) | null = null;
    constructor(url: string) {
      streams.push(url);
    }
    addEventListener() {}
    close() {}
  }
  vi.stubGlobal('EventSource', FakeEventSource);
}

function mount(Comp: ComponentType<LayerComponentProps>, active: LayerId[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(createElement(QueryClientProvider, { client }, createElement(Comp, { active: new Set(active) })));
}
const status = (id: LayerId) => useLayerStatusStore.getState().status[id];

beforeEach(() => {
  useLayerStatusStore.setState({ status: {} });
  useMapInstanceStore.setState({ map: null, projection: 'globe', ready: false });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('capability-gated layers are not requested while their capability is off (visual-qa r5 m11)', () => {
  it('capabilityGate: keyless always, gated by /api/health, unknown until it loads, the route asked if health failed', () => {
    expect(capabilityGate('cf_outages', undefined)).toBe('enabled');
    expect(capabilityGate('cf_attacks', undefined)).toBe('unknown');
    expect(capabilityGate('cf_attacks', OFF)).toBe('disabled');
    expect(capabilityGate('cf_attacks', ON)).toBe('enabled');
    expect(capabilityGate('frontlines', OFF)).toBe('disabled');
    expect(capabilityGate('cyber_attacks', undefined, true)).toBe('enabled');
  });

  it('gatedStatus: a missing key reads NEEDS KEY (not-configured), a licence flag is a licence skip', () => {
    expect(gatedStatus('cf_attacks', OFF)).toMatchObject({ state: 'idle', count: null, error: 'capability_disabled', providers: { cloudflare: { ok: false, skipped: 'not-configured' } } });
    expect(gatedStatus('frontlines', OFF)).toMatchObject({ providers: { deepstate: { ok: false, skipped: 'licence' } } });
    expect(gatedStatus('malware', OFF)).toMatchObject({ providers: { nc_sources: { ok: false, skipped: 'licence' } } });
  });

  it('network: Cloudflare origins, Feodo C2 and the URLhaus stream stay unrequested when off', async () => {
    serve(OFF);
    await act(async () => {
      mount(NetworkLayer, ['cf_attacks', 'cyber_attacks', 'malware']);
    });
    await waitFor(() => expect(status('cf_attacks')?.error).toBe('capability_disabled'));
    await waitFor(() => expect(status('cyber_attacks')?.error).toBe('capability_disabled'));
    await waitFor(() => expect(status('malware')?.error).toBe('capability_disabled'));
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    expect(urls.filter((u) => /cloudflare-radar|cyber-attacks|malware/.test(u))).toEqual([]);
    expect(streams).toEqual([]);
    // One shared health request; the keyless KEV list (Intel Feed) is still fetched.
    expect(urls.filter((u) => u === '/api/health')).toHaveLength(1);
    expect(urls.some((u) => u.startsWith('/api/cyber-threats'))).toBe(true);
    expect(status('cf_attacks')).toMatchObject({ state: 'idle', providers: { cloudflare: { skipped: 'not-configured' } } });
    expect(status('cyber_attacks')).toMatchObject({ state: 'idle', providers: { nc_sources: { skipped: 'licence' } } });
  });

  it('network: the same layers are requested once /api/health reports them on', async () => {
    serve(ON);
    await act(async () => {
      mount(NetworkLayer, ['cf_attacks', 'cyber_attacks', 'malware']);
    });
    await waitFor(() => expect(urls.some((u) => u.startsWith('/api/cloudflare-radar'))).toBe(true));
    await waitFor(() => expect(urls.some((u) => u.startsWith('/api/cyber-attacks'))).toBe(true));
    await waitFor(() => expect(streams).toEqual(['/api/malware/stream']));
    await waitFor(() => expect(status('cf_attacks')?.state).toBe('live'));
  });

  it('threats: DeepState frontlines are not requested without NONCOMMERCIAL', async () => {
    serve(OFF);
    await act(async () => {
      mount(ThreatsLayer, ['frontlines']);
    });
    await waitFor(() => expect(status('frontlines')?.error).toBe('capability_disabled'));
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    expect(urls).toEqual(['/api/health']);
  });

  it('keyless layers never wait on or add a health request', async () => {
    serve(OFF);
    await act(async () => {
      mount(NetworkLayer, ['cf_outages']);
    });
    await waitFor(() => expect(urls).toContain('/api/outages'));
    expect(urls).not.toContain('/api/health');
  });
});
