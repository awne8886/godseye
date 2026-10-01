// @vitest-environment jsdom
/**
 * perf m-g: keyless, /api/maritime answers REFERENCE ports + chokepoints only, yet the browser
 * re-polled it every 10 s (11–12 requests a minute in the round-4 bench). The schedule is now:
 * fetch once and refresh on an hours-long TTL keyless; poll at the registry cadence only while the
 * server relays AIS. The bodies are what the real route serves keyless (bundled reference data, no
 * network); the keyed case flips `aisConfigured` on that body because a unit test must not open
 * the AISStream socket.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { maritimeFeed, resetAis } from '@/features/maritime/server/maritime';
import { freshCache, req, resetCache } from '@/features/threats/server/__fixtures__/routes';
import { useLayerStatusStore } from '@/lib/layer-host';
import type { MaritimeResponse } from '@/lib/types';
import { GET } from '@/app/api/maritime/route';
import { useFeedData } from '../../threats/client/hooks';
import { MARITIME_LIVE_MS, MARITIME_REFERENCE_MS, maritimePollMs } from './poll';

const count = (b: MaritimeResponse) => b.ports.length + b.vessels.length;
let keyless: MaritimeResponse;

beforeAll(async () => {
  freshCache();
  resetAis();
  delete process.env.AIS_API_KEY;
  const res = await GET(req('/api/maritime'), undefined);
  expect(res.status).toBe(200);
  keyless = (await res.json()) as MaritimeResponse;
  maritimeFeed.stop();
  resetCache();
});
afterAll(() => resetAis());

/** The app's QueryClient defaults (src/app/providers.tsx). */
const newClient = () => new QueryClient({ defaultOptions: { queries: { refetchIntervalInBackground: false, refetchOnWindowFocus: false, retry: 2, staleTime: 10_000 } } });
const wrapperFor = (client: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

function serve(body: unknown, status = 200) {
  const f = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', f);
  return f;
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  useLayerStatusStore.setState({ status: {} });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('maritime poll schedule (perf m-g)', () => {
  it('the keyless route answer is REFERENCE only: ports + chokepoints, no vessels, AIS not configured', () => {
    expect(keyless.aisConfigured).toBe(false);
    expect(keyless.vessels).toEqual([]);
    expect(keyless.ports.length).toBeGreaterThan(500);
    expect(keyless.chokepoints).toHaveLength(10);
  });

  it('picks hours for the REFERENCE-only answer and the registry cadence for a keyed relay or no answer yet', () => {
    expect(MARITIME_LIVE_MS).toBe(10_000);
    expect(MARITIME_REFERENCE_MS).toBeGreaterThanOrEqual(60 * 60_000);
    expect(maritimePollMs(keyless)).toBe(MARITIME_REFERENCE_MS);
    expect(maritimePollMs({ aisConfigured: true })).toBe(MARITIME_LIVE_MS);
    expect(maritimePollMs(null)).toBe(MARITIME_LIVE_MS);
  });

  it('keyless: one request, none in the next 60 s (bench window), one refresh per TTL', async () => {
    const f = serve(keyless);
    renderHook(() => useFeedData<MaritimeResponse>('maritime', '/api/maritime', count, maritimePollMs), { wrapper: wrapperFor(newClient()) });
    await advance(30_000);
    expect(f).toHaveBeenCalledTimes(1);
    await advance(60_000);
    expect(f).toHaveBeenCalledTimes(1);
    await advance(MARITIME_REFERENCE_MS);
    expect(f).toHaveBeenCalledTimes(2);
    expect(useLayerStatusStore.getState().status.maritime).toMatchObject({ count: keyless.ports.length });
  });

  it('keyless: toggling the layer off and on within the TTL reuses the reference answer', async () => {
    const f = serve(keyless);
    const client = newClient();
    const first = renderHook(() => useFeedData<MaritimeResponse>('maritime', '/api/maritime', count, maritimePollMs), { wrapper: wrapperFor(client) });
    await advance(1_000);
    first.unmount();
    await advance(2 * 60_000);
    renderHook(() => useFeedData<MaritimeResponse>('maritime', '/api/maritime', count, maritimePollMs), { wrapper: wrapperFor(client) });
    await advance(60_000);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('keyed AIS relay: polls at the registry cadence, at most 6 requests a minute', async () => {
    const f = serve({ ...keyless, aisConfigured: true });
    renderHook(() => useFeedData<MaritimeResponse>('maritime', '/api/maritime', count, maritimePollMs), { wrapper: wrapperFor(newClient()) });
    await advance(30_000);
    const before = f.mock.calls.length;
    await advance(60_000);
    const inWindow = f.mock.calls.length - before;
    expect(inWindow).toBeGreaterThanOrEqual(5);
    expect(inWindow).toBeLessThanOrEqual(6);
  });

  it('SOURCE OFFLINE (503): retries at the live cadence until a good answer, then backs off to the TTL', async () => {
    let offline = true;
    const f = vi.fn(async () =>
      offline
        ? new Response(JSON.stringify({ error: 'source_offline', meta: keyless.meta, providers: keyless.providers }), { status: 503 })
        : new Response(JSON.stringify(keyless), { status: 200 }),
    );
    vi.stubGlobal('fetch', f);
    renderHook(() => useFeedData<MaritimeResponse>('maritime', '/api/maritime', count, maritimePollMs), { wrapper: wrapperFor(newClient()) });
    await advance(25_000);
    expect(f.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(useLayerStatusStore.getState().status.maritime?.state).toBe('offline');
    offline = false;
    await advance(MARITIME_LIVE_MS);
    const settled = f.mock.calls.length;
    await advance(60_000);
    expect(f).toHaveBeenCalledTimes(settled);
  });

  it('MaritimeLayer is the only browser requester of /api/maritime', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name !== 'api' && name !== 'server' && name !== '__fixtures__') walk(p);
        } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && readFileSync(p, 'utf8').includes("'/api/maritime")) hits.push(p.slice(p.indexOf('src/')));
      }
    };
    walk(join(process.cwd(), 'src'));
    // The registry and the API catalogue name the route; only the layer fetches it.
    expect(hits.sort()).toEqual(['src/features/maritime/client/MaritimeLayer.tsx', 'src/lib/api-catalog.ts', 'src/lib/layer-registry.ts']);
  });
});
