// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Selection } from '@/lib/layer-host';
import type { Camera, CameraProvider, NewsChannel } from '@/lib/types';
import { CameraCard, liveLabel, NewsChannelCard } from './cards';
import { embedSrc } from './LiveNewsPanel';
import { removalUrl, rowToCamera } from './rows';

const provider: CameraProvider = {
  id: 'hktd', operator: 'Transport Department, HKSAR Government', region: 'Hong Kong', country: 'HK', list_endpoint: 'https://static.data.gov.hk/x.xml',
  frame_url_template: 'https://tdcctv.data.one.gov.hk/{key}.JPG', stream_type: 'jpg', licence: 'DATA.GOV.HK Terms and Conditions', attribution_string: 'Traffic snapshots: Transport Department, HKSAR Government, via DATA.GOV.HK',
  terms_url: 'https://data.gov.hk/en/terms-and-conditions', key_required: false, max_poll_interval: 60, proxy_allowed: true, link_out_only: false,
};
const cam: Camera = { id: 'hktd-H429F', lat: 22.24845, lng: 114.1505, name: 'Aberdeen Praya Road near Fish Market [H429F]', providerId: 'hktd', city: 'Southern', country: 'HK', streamType: 'jpg', stillUrl: 'https://tdcctv.data.one.gov.hk/H429F.JPG', streamUrl: null, externalUrl: null, headingDeg: null, observedAt: null, source: 'hktd' };

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('camera card', () => {
  it('sets long values (licence, operator) as a prose block, short ones as HUD mono', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [provider] }), { status: 200 })));
    const sel: Selection = { kind: 'camera', id: cam.id, layer: 'cctv', source: 'hktd', observedAt: null, data: cam as unknown as Record<string, unknown>, lngLat: [cam.lng, cam.lat] };
    render(wrap(<CameraCard selection={sel} />));
    const op = (await screen.findByTestId('camera-operator')).querySelector('dd')!;
    expect(op.className).toContain('font-sans');
    expect(op.className).toContain('normal-case');
    const feed = screen.getByText('SNAPSHOT');
    expect(feed.className).toContain('font-mono');
  });

  it('sends removals to the instance contact when the server publishes one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [provider], removal: { kind: 'email', href: 'mailto:ops@example.org' } }), { status: 200 })));
    const sel: Selection = { kind: 'camera', id: cam.id, layer: 'cctv', source: 'hktd', observedAt: null, data: cam as unknown as Record<string, unknown>, lngLat: [cam.lng, cam.lat] };
    render(wrap(<CameraCard selection={sel} />));
    await screen.findByTestId('camera-operator');
    const report = screen.getByTestId('camera-report') as HTMLAnchorElement;
    expect(report.href.startsWith('mailto:ops@example.org?')).toBe(true);
    expect(report.title).toBe('The operator of this instance handles removals');
  });

  it('shows operator, licence, attribution, terms, honest image time and report/remove', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [provider] }), { status: 200 })));
    const sel: Selection = { kind: 'camera', id: cam.id, layer: 'cctv', source: 'hktd', observedAt: null, data: cam as unknown as Record<string, unknown>, lngLat: [cam.lng, cam.lat] };
    render(wrap(<CameraCard selection={sel} />));
    expect(await screen.findByTestId('camera-operator')).toHaveProperty('textContent', expect.stringContaining('Transport Department'));
    expect(screen.getByTestId('camera-licence').textContent).toContain('DATA.GOV.HK');
    expect(screen.getByTestId('camera-attribution').textContent).toContain('via DATA.GOV.HK');
    expect(screen.getByTestId('camera-observed').textContent).toContain('Time not published by operator');
    const report = screen.getByTestId('camera-report') as HTMLAnchorElement;
    expect(report.href).toContain('https://github.com/awne8886/godseye/issues/new?');
    expect(decodeURIComponent(report.href)).toContain('hktd-H429F');
    expect(report.rel).toBe('noopener noreferrer');
    expect(screen.getByTestId('camera-open-viewer')).toBeTruthy();
  });

  it('R2 MINOR-1: an operator serving HTML instead of frames is marked FRAMES UNAVAILABLE on the card', async () => {
    const nsw = { ...provider, id: 'nsw', operator: 'Transport for NSW (Live Traffic NSW)' };
    const frames = { nsw: { state: 'unavailable', windowS: 600, attempts: 4, ok: 0, failed: 4, cameras: 4, camerasFailing: 4, errors: { not_an_image: 4 }, lastOkAt: null, lastFailAt: '2026-10-01T05:20:00.000Z', lastError: 'not_an_image', lastFrameAge_s: null, untimed: 0 } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [nsw], frames }), { status: 200 })));
    const c = { ...cam, id: 'nsw-5-ways-miranda', providerId: 'nsw', source: 'nsw' };
    const sel: Selection = { kind: 'camera', id: c.id, layer: 'cctv', source: 'nsw', observedAt: null, data: c as unknown as Record<string, unknown>, lngLat: [c.lng, c.lat] };
    render(wrap(<CameraCard selection={sel} />));
    expect((await screen.findByTestId('camera-frames')).textContent).toContain('UNAVAILABLE · 4/4 FAILING');
    expect(screen.getByTestId('camera-frames-note').textContent).toMatch(/web pages instead of camera images/);
  });

  it('a camera list frame time is labelled as such (the viewer shows the current frame’s own time)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [provider] }), { status: 200 })));
    const c = { ...cam, observedAt: '2026-10-01T07:20:00.000Z' };
    const sel: Selection = { kind: 'camera', id: c.id, layer: 'cctv', source: 'hktd', observedAt: c.observedAt, data: c as unknown as Record<string, unknown>, lngLat: [c.lng, c.lat] };
    render(wrap(<CameraCard selection={sel} />));
    const row = await screen.findByTestId('camera-observed');
    expect(row.querySelector('dt')!.textContent).toBe('Listed frame time');
    expect((await screen.findByTestId('camera-frames')).querySelector('dd')!.textContent).toBe('NOT CHECKED YET');
  });
});

describe('preview tiles', () => {
  it('never draw a refused frame: FEED UNAVAILABLE for this bucket, SOURCE OFFLINE for an unavailable operator', async () => {
    const { tileState } = await import('./CctvPreviews');
    expect(tileState({ video: false, health: undefined, failedBucket: undefined, bucket: 3 })).toBe('frame');
    expect(tileState({ video: false, health: undefined, failedBucket: 3, bucket: 3 })).toBe('failed');
    expect(tileState({ video: false, health: undefined, failedBucket: 3, bucket: 4 })).toBe('frame'); // retried next refresh
    expect(tileState({ video: false, health: { state: 'unavailable' }, failedBucket: undefined, bucket: 0 })).toBe('source-offline');
    expect(tileState({ video: true, health: { state: 'unavailable' }, failedBucket: undefined, bucket: 0 })).toBe('source-offline');
    expect(tileState({ video: true, health: { state: 'available' }, failedBucket: undefined, bucket: 0 })).toBe('video');
  });
});

describe('news channel card + embed', () => {
  const ch: NewsChannel = { id: 'aljazeera', name: 'Al Jazeera English', city: 'Doha', country: 'QA', lat: 25.3, lng: 51.5, youtubeChannelId: 'UCNye-wNBqNL5ZzHSJj3l8Bg', embedUrl: 'https://www.youtube-nocookie.com/embed/live_stream?channel=UCNye-wNBqNL5ZzHSJj3l8Bg', externalUrl: 'https://www.youtube.com/channel/UCNye-wNBqNL5ZzHSJj3l8Bg/live', embedAllowed: true, category: 'mainstream', language: 'en', live: null, observedAt: null, source: 'youtube' };

  it('never claims LIVE unless the check said so', () => {
    const sel: Selection = { kind: 'news_channel', id: ch.id, layer: 'live_news', source: 'youtube', observedAt: null, data: ch as unknown as Record<string, unknown>, lngLat: [ch.lng, ch.lat] };
    render(<NewsChannelCard selection={sel} />);
    expect(screen.getByTestId('news-card').textContent).toContain('LIVE STATUS UNKNOWN');
    // LIVE only with an observed check time.
    expect(liveLabel(true)).toBe('LIVE STATUS UNKNOWN');
    expect(liveLabel(true, '2026-09-30T21:05:09.000Z')).toBe('LIVE · CHECKED 21:05Z');
    expect(liveLabel(false, '2026-09-30T21:05:09.000Z')).toBe('NOT LIVE · CHECKED 21:05Z');
    expect(liveLabel(null, '2026-09-30T21:05:09.000Z')).toBe('LIVE STATUS UNKNOWN');
  });

  it('renders the check time of a live channel', () => {
    const live = { ...ch, live: true, observedAt: '2026-09-30T21:05:09.000Z' };
    const sel: Selection = { kind: 'news_channel', id: ch.id, layer: 'live_news', source: 'youtube', observedAt: live.observedAt, data: live as unknown as Record<string, unknown>, lngLat: [ch.lng, ch.lat] };
    render(<NewsChannelCard selection={sel} />);
    expect(screen.getByTestId('news-live').querySelector('dd')!.textContent).toBe('LIVE · CHECKED 21:05Z');
    expect(screen.getByTestId('news-card').textContent).toContain('2026-09-30 21:05:09Z');
  });

  it('embeds only youtube-nocookie URLs, muted, autoplay per settings', () => {
    expect(embedSrc(ch, false)).toBe('https://www.youtube-nocookie.com/embed/live_stream?channel=UCNye-wNBqNL5ZzHSJj3l8Bg&autoplay=0&mute=1&playsinline=1&rel=0');
    expect(embedSrc({ ...ch, embedUrl: 'https://evil.example/embed/x' }, true)).toBeNull();
    expect(embedSrc({ ...ch, embedAllowed: false }, true)).toBeNull();
  });
});

describe('rows', () => {
  it('rebuilds a camera from a columnar row and builds a removal link', () => {
    const row = ['hktd-H429F', 22.24845, 114.1505, 'Name', 'hktd', 'Southern', 'HK', 'jpg', 'https://tdcctv.data.one.gov.hk/H429F.JPG', null, null, null, 'hktd'];
    expect(rowToCamera(row)).toMatchObject({ id: 'hktd-H429F', lat: 22.24845, streamType: 'jpg', observedAt: null, source: 'hktd' });
    const u = new URL(removalUrl({ kind: 'tracker', href: 'https://github.com/awne8886/godseye/issues' }, cam, 'Operator', 'https://terms.example/'));
    expect(u.pathname).toBe('/awne8886/godseye/issues/new');
    expect(u.searchParams.get('labels')).toBe('camera-removal');
    expect(u.searchParams.get('body')).toContain('Operator terms: https://terms.example/');
    // GODSEYE_CONTACT set: the operator of this instance handles removals.
    const mail = new URL(removalUrl({ kind: 'email', href: 'mailto:ops@example.org' }, cam, 'Operator', null));
    expect(mail.protocol).toBe('mailto:');
    expect(mail.pathname).toBe('ops@example.org');
    expect(mail.searchParams.get('subject')).toBe('Camera removal request: hktd-H429F');
    expect(removalUrl({ kind: 'url', href: 'https://ops.example.org/contact' }, cam, null, null)).toBe('https://ops.example.org/contact');
  });
});
