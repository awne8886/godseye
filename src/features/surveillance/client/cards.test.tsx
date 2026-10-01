// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Selection } from '@/lib/layer-host';
import type { Camera, CameraProvider, FrameHealth, NewsChannel } from '@/lib/types';
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
    const frames = { nsw: { state: 'unavailable', windowS: 600, attempts: 5, ok: 0, failed: 5, cameras: 5, camerasFailing: 5, camerasOperatorFault: 5, errors: { not_an_image: 5 }, lastOkAt: null, lastFailAt: '2026-10-01T05:20:00.000Z', lastError: 'not_an_image', lastFrameAge_s: null, untimed: 0 } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [nsw], frames }), { status: 200 })));
    const c = { ...cam, id: 'nsw-5-ways-miranda', providerId: 'nsw', source: 'nsw' };
    const sel: Selection = { kind: 'camera', id: c.id, layer: 'cctv', source: 'nsw', observedAt: null, data: c as unknown as Record<string, unknown>, lngLat: [c.lng, c.lat] };
    render(wrap(<CameraCard selection={sel} />));
    expect((await screen.findByTestId('camera-frames')).textContent).toContain('UNAVAILABLE · 5/5 FAILING');
    expect(screen.getByTestId('camera-frames-note').textContent).toMatch(/web pages instead of camera images/);
  });

  it('round-4 review: one failed camera never labels its operator FAILING on other cameras’ cards', async () => {
    const frames = { hktd: { state: 'inconclusive', windowS: 600, attempts: 1, ok: 0, failed: 1, cameras: 1, camerasFailing: 1, camerasOperatorFault: 0, errors: { upstream_404: 1 }, lastOkAt: null, lastFailAt: '2026-10-01T10:30:00.000Z', lastError: 'upstream_404', lastFrameAge_s: null, untimed: 0 } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [provider], frames }), { status: 200 })));
    const sel: Selection = { kind: 'camera', id: cam.id, layer: 'cctv', source: 'hktd', observedAt: null, data: cam as unknown as Record<string, unknown>, lngLat: [cam.lng, cam.lat] };
    render(wrap(<CameraCard selection={sel} />));
    const row = (await screen.findByTestId('camera-frames')).querySelector('dd')!;
    expect(row.textContent).toBe('NO FRAME RELAYED · 1 TRIED');
    expect(row.textContent).not.toMatch(/FAILING|UNAVAILABLE/);
    expect(screen.queryByTestId('camera-frames-note')).toBeNull();
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
  const NOT_AN_IMAGE = { error: 'frame_unavailable', detail: 'not_an_image', state: 'offline', message: 'The operator answered with a web page instead of an image (a fault on the operator side). No frame to show.', upstreamType: 'text/html', fetchedAt: '2026-10-01T10:35:52.000Z' };
  const nswDown: FrameHealth = { state: 'unavailable', windowS: 600, attempts: 5, ok: 0, failed: 5, cameras: 5, camerasFailing: 5, camerasOperatorFault: 5, errors: { not_an_image: 5 }, lastOkAt: null, lastFailAt: '2026-10-01T10:35:52.000Z', lastError: 'not_an_image', lastFrameAge_s: null, untimed: 0 };

  it('show the tile’s own outcome; the operator state is only a label', async () => {
    const { tileState, tileNote } = await import('./CctvPreviews');
    const fail = { state: 'offline' as const, detail: 'not_an_image', message: '' };
    expect(tileState({ video: false, failure: null })).toBe('frame');
    expect(tileState({ video: false, failure: fail })).toBe('failed');
    expect(tileState({ video: true, failure: null })).toBe('video'); // an unavailable operator never hides a clip
    expect(tileNote(fail, undefined)).toEqual({ title: 'CAMERA OFFLINE', detail: 'NOT AN IMAGE' });
    expect(tileNote({ state: 'unavailable', detail: 'timeout', message: '' }, { state: 'available', lastOkAt: null, windowS: 600 })).toEqual({ title: 'FEED UNAVAILABLE', detail: 'TIMEOUT' });
    expect(tileNote({ state: 'unavailable', detail: 'queued', message: '' }, undefined).detail).toBe('SERVER BUSY');
    // SOURCE OFFLINE always carries the last good relay time, or says there was none in the window.
    expect(tileNote(fail, nswDown)).toEqual({ title: 'SOURCE OFFLINE', detail: 'NO FRAME IN 10 MIN' });
    expect(tileNote(fail, { ...nswDown, lastOkAt: '2026-10-01T10:31:07.000Z' })).toEqual({ title: 'SOURCE OFFLINE', detail: 'LAST GOOD 10:31Z' });
  });

  it('a tile of an unavailable operator still requests its own frame and shows it when it arrives', async () => {
    const { PreviewTile } = await import('./CctvPreviews');
    // The recorded TxDOT snapshot JPEG (jsdom cannot resolve the fixture module's own file URLs).
    const snap = JSON.parse(readFileSync(join(process.cwd(), 'src/features/surveillance/server/__fixtures__/txdot-snapshot.2026-09-30.json'), 'utf8')) as { snippet: string };
    const jpeg = Buffer.from(snap.snippet, 'base64');
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:tile-1');
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (calls.push(u), new Response(new Uint8Array(jpeg), { status: 200, headers: { 'content-type': 'image/jpeg' } }))));
    const nswCam = { ...cam, id: 'nsw-5-ways-miranda', providerId: 'nsw', source: 'nsw' };
    render(<PreviewTile cam={nswCam} video={false} bucket={2} health={nswDown} tileRef={() => undefined} />);
    const img = await screen.findByRole('img');
    expect(img.getAttribute('src')).toBe('blob:tile-1');
    expect(calls).toEqual(['/api/cctv/proxy?id=nsw-5-ways-miranda&r=2']);
    expect(screen.queryByTestId('cctv-tile-unavailable')).toBeNull();
    created.mockRestore();
  });

  it('a refused tile frame is a labelled placeholder, never a broken image', async () => {
    const { PreviewTile } = await import('./CctvPreviews');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(NOT_AN_IMAGE), { status: 502, headers: { 'content-type': 'application/json' } })));
    const nswCam = { ...cam, id: 'nsw-5-ways-miranda', providerId: 'nsw', source: 'nsw' };
    const { rerender } = render(<PreviewTile cam={nswCam} video={false} bucket={0} health={undefined} tileRef={() => undefined} />);
    expect((await screen.findByTestId('cctv-tile-unavailable')).textContent).toBe('CAMERA OFFLINE' + 'NOT AN IMAGE');
    expect(screen.queryByRole('img')).toBeNull();
    rerender(<PreviewTile cam={nswCam} video={false} bucket={1} health={nswDown} tileRef={() => undefined} />);
    await vi.waitFor(() => expect(screen.getByTestId('cctv-tile-detail').textContent).toBe('NO FRAME IN 10 MIN'));
    expect(screen.getByTestId('cctv-tile-unavailable').textContent).toContain('SOURCE OFFLINE');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2); // retried at the next refresh
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
