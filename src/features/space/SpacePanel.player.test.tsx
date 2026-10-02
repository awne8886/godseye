// @vitest-environment jsdom
/**
 * Verification round 8 (MINORs):
 *  1. The NASA embed was marked ready on the iframe's `load` event, which Chrome also fires for its
 *     own network-error page, so a blocked YouTube showed a grey sad-page box instead of the
 *     "did not load" note. Ready now needs the YouTube IFrame Player API to answer the panel's
 *     "listening" handshake from the YouTube origin and from this very frame.
 *  2. The SPACE panel header had no state chip (§7). It now reports the ISS readout's state.
 * The player messages below are shaped like the ones the embed client sends (probed 2026-10-02).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IssResponse } from '@/lib/types';
import { fx } from './__fixtures__';

const NOW = Date.parse('2026-10-02T07:20:00Z');
let issResult: () => Promise<IssResponse>;
const chips: { text: string; tone: string; title?: string }[] = [];

vi.mock('./client/data', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchIss: () => issResult(),
  fetchSatelliteById: () => new Promise(() => undefined),
  useNow: () => NOW,
}));
vi.mock('@/components/hud/PanelChrome', () => ({
  usePanelChip: (text: string, tone: string, title?: string) => {
    chips.push({ text, tone, title });
  },
}));

const { SpacePanel, PLAYER_HANDSHAKE_MS, PLAYER_LATE_HANDSHAKE_MS, PLAYER_TIMEOUT_MS, YOUTUBE_EMBED_ORIGIN, isPlayerReadyMessage, spaceChip } = await import('./SpacePanel');
const { FeedOfflineError } = await import('./client/data');

function issBody(): IssResponse {
  const r = fx.iss as Record<string, number | string>;
  const at = new Date(NOW - 3_000).toISOString();
  return {
    meta: { feed: 'iss', kind: 'live', state: 'live', fetchedAt: at, observedAt: at, lastGoodAt: at, stale: false, ttlSeconds: 5, attribution: [] },
    providers: { wheretheiss: { ok: true, count: 1, ms: 300, age_s: 0 } },
    lat: r.latitude as number,
    lng: r.longitude as number,
    altKm: r.altitude as number,
    velocityKmH: r.velocity as number,
    visibility: 'eclipsed',
    position: { method: 'propagated', by: 'wheretheiss.at', elementsEpoch: '2026-09-30T20:27:19.352Z' },
    groundTrack: null,
  } as IssResponse;
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SpacePanel {...({} as Parameters<typeof SpacePanel>[0])} />
    </QueryClientProvider>,
  );
}

const frame = () => screen.getByTestId('space-player').querySelector('iframe')!;
const playerState = () => screen.getByTestId('space-player').getAttribute('data-state');
const reply = (data: unknown, origin = YOUTUBE_EMBED_ORIGIN, source: Window | null = frame().contentWindow) =>
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
  });

beforeEach(() => {
  chips.length = 0;
  issResult = () => new Promise(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SPACE panel: the NASA player is ready only when the YouTube player API answers', () => {
  it('embeds with enablejsapi and this page as the origin', () => {
    mount();
    const src = new URL(frame().src);
    expect(src.origin).toBe(YOUTUBE_EMBED_ORIGIN);
    expect(src.searchParams.get('enablejsapi')).toBe('1');
    expect(src.searchParams.get('origin')).toBe(window.location.origin);
  });

  it('an iframe load alone (Chrome fires it for its own error page) never shows the player; the timeout says it did not load', () => {
    vi.useFakeTimers();
    mount();
    fireEvent.load(frame());
    act(() => void vi.advanceTimersByTime(2_000));
    expect(playerState()).toBe('loading');
    expect(screen.getByTestId('space-player').style.height).toBe('0px');
    act(() => void vi.advanceTimersByTime(PLAYER_TIMEOUT_MS));
    expect(playerState()).toBe('failed');
    expect(screen.getByTestId('space-player-status').textContent).toMatch(/did not load here; open it on YouTube/);
  });

  it('after load the panel sends the API "listening" handshake to the YouTube origin only, until the player answers', () => {
    vi.useFakeTimers();
    mount();
    const post = vi.spyOn(frame().contentWindow!, 'postMessage');
    expect(post).not.toHaveBeenCalled(); // nothing before the frame loaded
    fireEvent.load(frame());
    act(() => void vi.advanceTimersByTime(PLAYER_HANDSHAKE_MS * 2));
    expect(post.mock.calls.length).toBeGreaterThanOrEqual(3);
    for (const [msg, target] of post.mock.calls) {
      expect(target).toBe(YOUTUBE_EMBED_ORIGIN);
      expect(JSON.parse(msg as string)).toMatchObject({ event: 'listening', channel: 'widget' });
    }
    reply(JSON.stringify({ event: 'initialDelivery', info: {}, channel: 'widget', id: 1 }));
    expect(playerState()).toBe('ready');
    const sent = post.mock.calls.length;
    act(() => void vi.advanceTimersByTime(PLAYER_HANDSHAKE_MS * 4));
    expect(post.mock.calls.length).toBe(sent); // handshake stops once the player answered
    expect(screen.queryByTestId('space-player-status')).toBeNull();
  });

  it('a player that answers after the timeout still becomes ready (round 8: onReady seen at 18 s)', () => {
    vi.useFakeTimers();
    mount();
    const post = vi.spyOn(frame().contentWindow!, 'postMessage');
    fireEvent.load(frame());
    act(() => void vi.advanceTimersByTime(PLAYER_TIMEOUT_MS));
    expect(playerState()).toBe('failed');
    const atTimeout = post.mock.calls.length;
    act(() => void vi.advanceTimersByTime(PLAYER_LATE_HANDSHAKE_MS * 2));
    const late = post.mock.calls.length - atTimeout;
    expect(late).toBeGreaterThanOrEqual(2); // handshake keeps going after the timeout
    expect(late).toBeLessThanOrEqual(3); // at the slower pace
    for (const [, target] of post.mock.calls) expect(target).toBe(YOUTUBE_EMBED_ORIGIN);
    reply(JSON.stringify({ event: 'onReady', channel: 'widget', id: 1 }));
    expect(playerState()).toBe('ready');
    expect(screen.queryByTestId('space-player-status')).toBeNull();
    const sent = post.mock.calls.length;
    act(() => void vi.advanceTimersByTime(PLAYER_LATE_HANDSHAKE_MS * 3));
    expect(post.mock.calls.length).toBe(sent);
  });

  it('ignores messages from another origin, another window, or that are not player events', () => {
    mount();
    fireEvent.load(frame());
    reply(JSON.stringify({ event: 'onReady', channel: 'widget' }), 'https://evil.example');
    reply(JSON.stringify({ event: 'onReady', channel: 'widget' }), YOUTUBE_EMBED_ORIGIN, window);
    reply(JSON.stringify({ event: 'command', func: 'playVideo' }));
    reply('not json');
    expect(playerState()).toBe('loading');
    reply(JSON.stringify({ event: 'onReady', channel: 'widget', id: 1 }));
    expect(playerState()).toBe('ready');
  });

  it('isPlayerReadyMessage reads only the event name of a player API message', () => {
    expect(isPlayerReadyMessage('{"event":"onReady","channel":"widget"}')).toBe(true);
    expect(isPlayerReadyMessage('{"event":"infoDelivery","info":{"playerState":1}}')).toBe(true);
    expect(isPlayerReadyMessage('{"event":"alreadyInitialized"}')).toBe(true);
    expect(isPlayerReadyMessage({ event: 'onReady' })).toBe(true);
    expect(isPlayerReadyMessage('{"event":"listening"}')).toBe(false);
    expect(isPlayerReadyMessage('{"event":"onError","info":150}')).toBe(false);
    expect(isPlayerReadyMessage('<html>')).toBe(false);
    expect(isPlayerReadyMessage(null)).toBe(false);
    expect(isPlayerReadyMessage(`{"event":"onReady","pad":"${'x'.repeat(70_000)}"}`)).toBe(false);
  });
});

describe('SPACE panel header chip (§7)', () => {
  it('CONNECTING while /api/iss has not answered', () => {
    mount();
    expect(chips.at(-1)).toMatchObject({ text: 'CONNECTING', tone: 'busy' });
    expect(chips.at(-1)?.title).toMatch(/NASA stream connecting/);
  });

  it('COMPUTED (never LIVE) once the ISS position arrives', async () => {
    issResult = () => Promise.resolve(issBody());
    mount();
    await screen.findByText('2026-09-30 20:27 UTC');
    expect(chips.at(-1)).toMatchObject({ text: 'COMPUTED', tone: 'live' });
    expect(chips.at(-1)?.text).not.toMatch(/LIVE/);
    expect(chips.at(-1)?.title).toMatch(/not observed/);
  });

  it('SOURCE OFFLINE with the last-good time when /api/iss answers 503', async () => {
    const meta = { ...issBody().meta, state: 'offline' as const, lastGoodAt: '2026-10-02T07:10:05.000Z' };
    issResult = () => Promise.reject(new FeedOfflineError(503, meta, null));
    mount();
    await screen.findByText(/SOURCE OFFLINE — wheretheiss\.at did not answer; last good 07:10:05 UTC/);
    expect(chips.at(-1)).toMatchObject({ text: 'SOURCE OFFLINE', tone: 'error' });
    expect(chips.at(-1)?.title).toMatch(/last good 07:10:05 UTC/);
  });

  it('a network error (not a 503) is SOURCE OFFLINE too, never an endless "acquiring"', async () => {
    issResult = () => Promise.reject(new TypeError('Failed to fetch'));
    mount();
    await screen.findByText(/SOURCE OFFLINE — wheretheiss\.at did not answer\./);
    expect(chips.at(-1)).toMatchObject({ text: 'SOURCE OFFLINE', tone: 'error' });
  });

  it('spaceChip: a failed refetch outranks the older answer still on screen; ageing reads warn', () => {
    const badge = { label: 'Computed' };
    expect(spaceChip({ badge, state: 'live', pending: false, failed: true, lastGoodAt: '2026-10-02T07:10:05Z' }, 'ready')).toMatchObject({ text: 'SOURCE OFFLINE', tone: 'error' });
    expect(spaceChip({ badge: { label: 'Computed · 2m' }, state: 'recent', pending: false, failed: false, lastGoodAt: null }, 'failed')).toMatchObject({ text: 'COMPUTED · 2M', tone: 'warn' });
    expect(spaceChip({ badge: { label: 'STALE' }, state: 'stale', pending: false, failed: false, lastGoodAt: null }, 'ready').tone).toBe('warn');
    expect(spaceChip({ badge: null, state: 'offline', pending: false, failed: false, lastGoodAt: null }, 'failed')).toMatchObject({ text: 'SOURCE OFFLINE', tone: 'error' });
    expect(spaceChip({ badge, state: 'live', pending: false, failed: false, lastGoodAt: null }, 'failed').title).toMatch(/NASA stream did not load here/);
  });
});
