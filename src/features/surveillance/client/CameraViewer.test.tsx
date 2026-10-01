// @vitest-environment jsdom
/**
 * Round-4 items 1–2 in the camera viewer: the frame on screen shows its own operator time and age,
 * separately from the proxy's fetch time; an untimed frame says so (never LIVE, and the camera
 * list's older frame time is not borrowed); an operator HTML page (502 not_an_image from the proxy)
 * shows CAMERA OFFLINE with the reason and no image at all.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Camera, CameraProvider } from '@/lib/types';

const chips = vi.hoisted(() => [] as { text: string; tone: string }[]);
vi.mock('@/components/hud/PanelChrome', () => ({
  usePanelChip: (text: string, tone: string) => {
    chips.push({ text, tone });
  },
}));

const { CameraViewerBody, frameInfoFrom, statusText, stillChip } = await import('./CameraViewer');

const provider: CameraProvider = {
  id: 'hktd', operator: 'Transport Department, HKSAR Government', region: 'Hong Kong', country: 'HK', list_endpoint: 'https://static.data.gov.hk/x.xml',
  frame_url_template: 'https://tdcctv.data.one.gov.hk/{key}.JPG', stream_type: 'jpg', licence: 'DATA.GOV.HK Terms and Conditions', attribution_string: 'Traffic snapshots: Transport Department, HKSAR Government, via DATA.GOV.HK',
  terms_url: 'https://data.gov.hk/en/terms-and-conditions', key_required: false, max_poll_interval: 60, proxy_allowed: true, link_out_only: false,
};
const nswProvider: CameraProvider = { ...provider, id: 'nsw', operator: 'Transport for NSW (Live Traffic NSW)', country: 'AU', attribution_string: 'Traffic cameras: Transport for NSW (Live Traffic NSW)', terms_url: 'https://www.livetraffic.com/' };
const hk: Camera = { id: 'hktd-H429F', lat: 22.24845, lng: 114.1505, name: 'Aberdeen Praya Road near Fish Market [H429F]', providerId: 'hktd', city: 'Southern', country: 'HK', streamType: 'jpg', stillUrl: 'https://tdcctv.data.one.gov.hk/H429F.JPG', streamUrl: null, externalUrl: null, headingDeg: null, observedAt: null, source: 'hktd' };
const nsw: Camera = { ...hk, id: 'nsw-5-ways-miranda', providerId: 'nsw', name: '5 Ways Miranda', country: 'AU', stillUrl: 'https://webcams.transport.nsw.gov.au/livetraffic-webcams/cameras/5_ways_miranda.jpeg', source: 'nsw' };

type Frame = { status: number; headers: Record<string, string>; body: BodyInit };

function stubApi(cam: Camera, prov: CameraProvider, frame: Frame, frames: Record<string, unknown> = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url.startsWith('/api/cctv/resolve')) return new Response(JSON.stringify({ camera: cam, provider: prov, playable: { type: 'jpg', url: `/api/cctv/proxy?id=${cam.id}` }, timestamp: '2026-10-01T07:49:40.000Z' }), { status: 200 });
      if (url.startsWith('/api/cctv/stream-status')) return new Response(JSON.stringify({ id: cam.id, status: 'online', checkedAt: '2026-10-01T07:49:40.000Z', httpStatus: 200 }), { status: 200 });
      if (url.startsWith('/api/cctv/providers')) return new Response(JSON.stringify({ items: [prov], frames }), { status: 200 });
      if (url.startsWith('/api/cctv/proxy')) return new Response(frame.body, { status: frame.status, headers: frame.headers });
      return new Response('{}', { status: 404 });
    }),
  );
  return calls;
}

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

beforeEach(() => {
  chips.length = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-10-01T07:49:41Z'));
  URL.createObjectURL = vi.fn(() => 'blob:frame');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('camera viewer frame time (item 1)', () => {
  it('shows the operator frame time, its source, its age and the fetch time separately', async () => {
    stubApi(hk, provider, {
      status: 200,
      headers: { 'content-type': 'image/jpeg', 'x-frame-observed-at': '2026-10-01T07:48:33.000Z', 'x-frame-fetched-at': '2026-10-01T07:49:41.000Z', 'x-frame-time-source': 'last-modified' },
      body: JPEG,
    });
    render(wrap(<CameraViewerBody camera={hk} />));
    await screen.findByTestId('viewer-frame');
    expect(screen.getByTestId('viewer-observed').querySelector('dd')!.textContent).toBe('2026-10-01 07:48:33Z');
    expect(screen.getByTestId('viewer-time-source').querySelector('dd')!.textContent).toBe('File Last-Modified');
    expect(screen.getByTestId('viewer-age').querySelector('dd')!.textContent).toBe('1m');
    expect(screen.getByTestId('viewer-fetched').querySelector('dd')!.textContent).toBe('2026-10-01 07:49:41Z');
    await waitFor(() => expect(chips.at(-1)).toEqual({ text: 'SNAPSHOT · 1m', tone: 'idle' }));
    expect(chips.some((c) => /LIVE/.test(c.text))).toBe(false);
  });

  it('an untimed frame is UNTIMED with only its fetch time; the camera list’s older frame time is not borrowed', async () => {
    const listed = { ...hk, observedAt: '2026-10-01T07:20:00.000Z' };
    stubApi(listed, provider, { status: 200, headers: { 'content-type': 'image/jpeg', 'x-frame-fetched-at': '2026-10-01T07:49:41.000Z', 'x-frame-time-source': 'none' }, body: JPEG });
    render(wrap(<CameraViewerBody camera={listed} />));
    await screen.findByTestId('viewer-frame');
    expect(screen.getByTestId('viewer-observed').querySelector('dd')!.textContent).toBe('Not published by operator');
    expect(screen.getByTestId('viewer-age').querySelector('dd')!.textContent).toBe('Unknown');
    expect(screen.getByTestId('viewer-fetched').querySelector('dd')!.textContent).toBe('2026-10-01 07:49:41Z');
    expect(screen.getByTestId('camera-viewer').textContent).not.toContain('07:20:00');
    await waitFor(() => expect(chips.at(-1)).toEqual({ text: 'SNAPSHOT · UNTIMED', tone: 'idle' }));
  });

  it('stillChip / frameInfoFrom never produce LIVE and drop malformed times', () => {
    const now = Date.parse('2026-10-01T07:51:07Z');
    expect(stillChip('playing', null, { observedAt: '2026-09-30T15:51:07.000Z', fetchedAt: null, timeSource: 'last-modified' }, 60, now)).toEqual({ text: 'SNAPSHOT · STALE · 16h', tone: 'warn' });
    expect(stillChip('playing', null, { observedAt: null, fetchedAt: null, timeSource: 'none' }, 60, now).text).toBe('SNAPSHOT · UNTIMED');
    expect(stillChip('error', { state: 'offline', detail: 'not_an_image', message: 'x' }, null, 60, now)).toEqual({ text: 'CAMERA OFFLINE', tone: 'error' });
    expect(stillChip('error', { state: 'unavailable', detail: 'timeout', message: 'x' }, null, 60, now)).toEqual({ text: 'FEED UNAVAILABLE', tone: 'error' });
    const h = new Headers({ 'x-frame-observed-at': 'yesterday', 'x-frame-time-source': 'last-modified' });
    expect(frameInfoFrom(h)).toEqual({ observedAt: null, fetchedAt: null, timeSource: 'none' });
  });
});

describe('camera viewer refused frames (item 2)', () => {
  it('NSW HTML page (proxy 502 not_an_image) → CAMERA OFFLINE with the reason, no broken image, RETRY offered', async () => {
    const body = JSON.stringify({ error: 'frame_unavailable', detail: 'not_an_image', state: 'offline', message: 'The operator answered with a web page instead of an image (a fault on the operator side). No frame to show.', upstreamType: 'text/html', fetchedAt: '2026-10-01T07:49:54.000Z' });
    stubApi(nsw, nswProvider, { status: 502, headers: { 'content-type': 'application/json; charset=utf-8', 'x-frame-error': 'not_an_image' }, body }, {
      nsw: { state: 'unavailable', windowS: 600, attempts: 4, ok: 0, failed: 4, cameras: 4, camerasFailing: 4, errors: { not_an_image: 4 }, lastOkAt: null, lastFailAt: '2026-10-01T07:49:54.000Z', lastError: 'not_an_image', lastFrameAge_s: null, untimed: 0 },
    });
    render(wrap(<CameraViewerBody camera={nsw} />));
    const box = await screen.findByTestId('viewer-unavailable');
    expect(box.dataset.state).toBe('offline');
    expect(box.textContent).toContain('CAMERA OFFLINE');
    expect(box.textContent).toContain('web page instead of an image');
    expect(box.querySelector('button')!.textContent).toContain('Retry');
    expect(screen.queryByTestId('viewer-frame')).toBeNull();
    expect(screen.getByTestId('camera-viewer').querySelector('img')).toBeNull();
    expect(screen.getByTestId('viewer-observed').querySelector('dd')!.textContent).toBe('No frame');
    await waitFor(() => expect(chips.at(-1)).toEqual({ text: 'CAMERA OFFLINE', tone: 'error' }));
    expect((await screen.findByTestId('viewer-operator-frames')).textContent).toContain('UNAVAILABLE · 4/4 FAILING');
  });

  it('a transient failure reads FEED UNAVAILABLE', async () => {
    stubApi(hk, provider, { status: 502, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'frame_unavailable', detail: 'timeout', state: 'unavailable', message: 'The operator did not answer in time. Try again.', upstreamType: null, fetchedAt: '2026-10-01T07:49:41.000Z' }) });
    render(wrap(<CameraViewerBody camera={hk} />));
    const box = await screen.findByTestId('viewer-unavailable');
    expect(box.dataset.state).toBe('unavailable');
    expect(box.textContent).toContain('FEED UNAVAILABLE');
  });

  it('stream check names the reason', () => {
    expect(statusText({ id: 'nsw-1', status: 'offline', checkedAt: '2026-10-01T07:49:54.000Z', httpStatus: 200, reason: 'not_an_image' }, false).text).toBe('CAMERA OFFLINE · NOT AN IMAGE');
  });
});
