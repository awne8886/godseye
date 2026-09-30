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
});

describe('news channel card + embed', () => {
  const ch: NewsChannel = { id: 'aljazeera', name: 'Al Jazeera English', city: 'Doha', country: 'QA', lat: 25.3, lng: 51.5, youtubeChannelId: 'UCNye-wNBqNL5ZzHSJj3l8Bg', embedUrl: 'https://www.youtube-nocookie.com/embed/live_stream?channel=UCNye-wNBqNL5ZzHSJj3l8Bg', externalUrl: 'https://www.youtube.com/channel/UCNye-wNBqNL5ZzHSJj3l8Bg/live', embedAllowed: true, category: 'mainstream', language: 'en', live: null, observedAt: null, source: 'youtube' };

  it('never claims LIVE unless the check said so', () => {
    const sel: Selection = { kind: 'news_channel', id: ch.id, layer: 'live_news', source: 'youtube', observedAt: null, data: ch as unknown as Record<string, unknown>, lngLat: [ch.lng, ch.lat] };
    render(<NewsChannelCard selection={sel} />);
    expect(screen.getByTestId('news-card').textContent).toContain('LIVE STATUS UNKNOWN');
    expect(liveLabel(true)).toBe('LIVE NOW (checked)');
    expect(liveLabel(false)).toBe('NOT LIVE AT LAST CHECK');
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
    const u = new URL(removalUrl('https://github.com/awne8886/godseye', cam, 'Operator', 'https://terms.example/'));
    expect(u.pathname).toBe('/awne8886/godseye/issues/new');
    expect(u.searchParams.get('labels')).toBe('camera-removal');
    expect(u.searchParams.get('body')).toContain('Operator terms: https://terms.example/');
  });
});
