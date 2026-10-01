/**
 * Round-4 items 1 and 2 (R2 MINOR-2 / MINOR-1): a relayed frame carries the operator's own frame
 * time (published timestamp or Last-Modified) and the proxy's fetch time separately, never the
 * fetch time as the frame time; an operator answering with an HTML page is refused by content type
 * (SOURCE OFFLINE / not an image, never scraped) and counted in the frame-health ledger.
 * A loopback "operator" replays response headers recorded from the real stills on 2026-10-01.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FrameError } from '@/lib/schemas/surveillance';
import type { Camera } from '@/lib/types';
import { FX, json, text } from './__fixtures__';
import { jpeg } from './__fixtures__/helpers';
import { frameHealth, resetFrameHealth } from './frame-health';
import { acceptImage, declaredType, fetchFrame, frameErrorInfo, frameResponse, frameTime, probeCamera, type FrameDeps } from './frames';
import { PROVIDERS, type ProviderDef } from './registry';

type Recorded = { status: number; 'content-type': string; 'last-modified': string | null };
const REC = json<Record<string, Recorded>>(FX.frameHeaders);
const NSW_HTML = Buffer.from(text(FX.nswHtmlFrame));
const JPEG = jpeg();

let server: http.Server;
let port = 0;
/** Last-Modified served for /cams/future.jpg (set per test). */
let futureLm = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const name = new URL(req.url!, 'http://x').pathname.replace(/^\/cams\//, '').replace(/\.jpg$/, '');
    if (name === 'future') {
      res.writeHead(200, { 'content-type': 'image/jpeg', 'last-modified': futureLm });
      res.end(JPEG);
      return;
    }
    const r = REC[name];
    if (!r) {
      res.writeHead(404);
      res.end();
      return;
    }
    const headers: Record<string, string> = { 'content-type': r['content-type'] };
    if (r['last-modified']) headers['last-modified'] = r['last-modified'];
    res.writeHead(r.status, headers);
    res.end(name === 'nsw' ? NSW_HTML : JPEG);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
afterEach(resetFrameHealth);

const deps = (): FrameDeps => ({
  env: {},
  fetchOpts: { resolve: async () => [{ address: '127.0.0.1', family: 4 }], isBlocked: () => false, ports: new Set([String(port)]) },
});

/** The real provider row, with its rules pointed at the loopback operator. */
const def = (id: string): ProviderDef => ({
  ...PROVIDERS.find((p) => p.row.id === id)!,
  rules: [{ host: 'cams.test', pathPrefix: '/cams/', protocols: ['http:'], port: String(port) }],
  fileRules: undefined,
});

const cam = (providerId: string, n = 1, still = providerId): Camera => ({
  id: `${providerId}-${n}`, lat: 0, lng: 0, name: `${providerId} ${n}`, providerId, city: null, country: null, streamType: 'jpg',
  stillUrl: `http://cams.test:${port}/cams/${still}.jpg`, streamUrl: null, externalUrl: null, headingDeg: null, observedAt: null, source: providerId,
});

describe('item 1: frame time is the operator’s, fetch time is separate', () => {
  it('HK TD / Caltrans / Digitraffic: X-Frame-Observed-At = Last-Modified, X-Frame-Fetched-At = the fetch', async () => {
    for (const id of ['hktd', 'caltrans', 'digitraffic']) {
      const before = Date.now();
      const r = await fetchFrame(cam(id), def(id), deps());
      expect(r.ok, id).toBe(true);
      if (!r.ok) continue;
      expect(r.observedAt).toBe(new Date(REC[id]!['last-modified']!).toISOString());
      expect(r.timeSource).toBe('last-modified');
      expect(Date.parse(r.fetchedAt)).toBeGreaterThanOrEqual(before);
      expect(r.observedAt).not.toBe(r.fetchedAt);
      const res = frameResponse(r);
      expect(res.headers.get('x-frame-observed-at')).toBe(r.observedAt);
      expect(res.headers.get('x-frame-fetched-at')).toBe(r.fetchedAt);
      expect(res.headers.get('x-frame-time-source')).toBe('last-modified');
    }
  });

  it('a frame 1 h old (Digitraffic C0150301, probed) reports its real age, not ~0 s', async () => {
    const r = await fetchFrame(cam('digitraffic'), def('digitraffic'), deps());
    expect(r.ok).toBe(true);
    // The recorded Last-Modified (06:48:44Z) was 67 min older than the operator's Date header (07:49:51Z).
    const h = frameHealth(['digitraffic']).digitraffic!;
    expect(h.lastFrameAge_s).toBeGreaterThan(60 * 60);
    expect(h.untimed).toBe(0);
  });

  it('Ottawa / THB / Via Lietuva publish no frame time: untimed, only the fetch time is sent', async () => {
    for (const id of ['ottawa', 'thb', 'vialietuva']) {
      const r = await fetchFrame(cam(id), def(id), deps());
      expect(r, id).toMatchObject({ ok: true, observedAt: null, timeSource: 'none' });
      const res = frameResponse(r);
      expect(res.headers.get('x-frame-observed-at'), id).toBeNull();
      expect(res.headers.get('x-frame-time-source')).toBe('none');
      expect(res.headers.get('x-frame-fetched-at')).toMatch(/Z$/);
    }
    const h = frameHealth(['thb']).thb!;
    expect(h).toMatchObject({ state: 'available', untimed: 1, lastFrameAge_s: null });
  });

  it('a Last-Modified in the future is not an observation', async () => {
    futureLm = new Date(Date.now() + 3600_000).toUTCString();
    const r = await fetchFrame(cam('hktd', 9, 'future'), def('hktd'), deps());
    expect(r).toMatchObject({ ok: true, observedAt: null, timeSource: 'none' });
  });

  it('frameTime prefers the operator timestamp, then Last-Modified, never the fetch time', () => {
    const t = Date.parse('2026-10-01T07:49:41Z');
    expect(frameTime('2026-10-01T07:48:00Z', 'Thu, 01 Oct 2026 07:48:33 GMT', t)).toEqual({ observedAt: '2026-10-01T07:48:00.000Z', timeSource: 'operator' });
    expect(frameTime(null, 'Thu, 01 Oct 2026 07:48:33 GMT', t)).toEqual({ observedAt: '2026-10-01T07:48:33.000Z', timeSource: 'last-modified' });
    expect(frameTime(null, null, t)).toEqual({ observedAt: null, timeSource: 'none' });
    expect(frameTime('2026-10-01T09:00:00Z', 'garbage', t)).toEqual({ observedAt: null, timeSource: 'none' });
  });
});

describe('item 2: NSW HTML frames are refused by content type and reported offline', () => {
  it('the recorded 307-byte text/html answer → 502 not_an_image, state offline, nothing parsed or relayed', async () => {
    const r = await fetchFrame(cam('nsw', 1, 'nsw'), def('nsw'), deps());
    expect(r).toMatchObject({ ok: false, status: 502, error: 'not_an_image', upstreamType: 'text/html', httpStatus: 200 });
    const res = frameResponse(r);
    expect(res.status).toBe(502);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(res.headers.get('x-frame-error')).toBe('not_an_image');
    expect(res.headers.get('cache-control')).toBe('no-store, max-age=0');
    const body = await res.json();
    expect(FrameError.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ error: 'frame_unavailable', detail: 'not_an_image', state: 'offline', upstreamType: 'text/html' });
    // The operator's page text never reaches the client.
    expect(JSON.stringify(body)).not.toMatch(/temporarily unavailable|livetraffic/i);
  });

  it('the declared type is checked before the bytes (an HTML answer is never sniffed)', () => {
    expect(acceptImage('text/html', JPEG)).toBeNull();
    expect(acceptImage('text/html; charset=utf-8', NSW_HTML)).toBeNull();
    expect(acceptImage('image/jpg', JPEG)).toBe('image/jpeg');
    expect(declaredType('text/html; charset=UTF-8')).toBe('text/html');
    expect(declaredType('<script>')).toBeNull();
  });

  it('three NSW cameras failing → provider frames UNAVAILABLE; one other camera recovering flips it back', async () => {
    for (const n of [1, 2, 3]) await fetchFrame(cam('nsw', n, 'nsw'), def('nsw'), deps());
    expect(frameHealth(['nsw']).nsw).toMatchObject({ state: 'unavailable', cameras: 3, camerasFailing: 3, errors: { not_an_image: 3 }, lastError: 'not_an_image' });
    // The same operator serving a real image again (recorded HK TD headers) for a fourth camera.
    await fetchFrame(cam('nsw', 4, 'hktd'), def('nsw'), deps());
    expect(frameHealth(['nsw']).nsw!.state).toBe('available');
  });

  it('stream-status says offline with the reason and the upstream status', async () => {
    expect(await probeCamera(cam('nsw', 1, 'nsw'), def('nsw'), deps())).toMatchObject({ status: 'offline', httpStatus: 200, reason: 'not_an_image' });
  });

  it('plain-language reasons: offline for refusals, unavailable for transient failures', () => {
    expect(frameErrorInfo('not_an_image').state).toBe('offline');
    expect(frameErrorInfo('upstream_404').state).toBe('offline');
    expect(frameErrorInfo('timeout').state).toBe('unavailable');
    expect(frameErrorInfo('upstream_503').state).toBe('unavailable');
  });
});
