import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Camera } from '@/lib/types';
import { FX, json } from './__fixtures__';
import { jpeg } from './__fixtures__/helpers';
import { acceptImage, FRAME_ACCEPT, fetchFrame, fetchTxdotSnapshot, frameResponse, MAX_FRAME_BYTES, mediaRules, playableFor, probeCamera, publicCamera, sniffImage, zonedToUtc, type FrameDeps } from './frames';
import { PROVIDERS, providerRow, type ProviderDef } from './registry';

// A local camera operator: `cams.test` resolves to the loopback server (test-only resolver).
let server: http.Server;
let port = 0;
const JPEG = jpeg();

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url!, 'http://x');
    if (u.pathname === '/cams/ok.jpg') {
      res.writeHead(200, { 'content-type': 'image/jpeg', 'last-modified': 'Wed, 30 Sep 2026 20:02:17 GMT' });
      res.end(JPEG);
    } else if (u.pathname === '/cams/octet.jpg') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(JPEG);
    } else if (u.pathname === '/cams/html.jpg') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<h4>Page not found</h4>');
    } else if (u.pathname === '/cams/huge.jpg') {
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      res.end(Buffer.concat([JPEG, Buffer.alloc(MAX_FRAME_BYTES + 10)]));
    } else if (u.pathname === '/cams/redirect-off.jpg') {
      res.writeHead(302, { location: `http://cams.test:${port}/private/admin` });
      res.end();
    } else if (u.pathname === '/cams/redirect-on.jpg') {
      res.writeHead(302, { location: `http://cams.test:${port}/cams/ok.jpg` });
      res.end();
    } else if (u.pathname === '/cams/live.m3u8') {
      res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
      res.end('#EXTM3U\n#EXT-X-VERSION:3\n');
    } else if (u.pathname === '/cams/gone.m3u8') {
      res.writeHead(404);
      res.end();
    } else if (u.pathname.startsWith('/its/DistrictIts/GetCctvSnapshotByIcdId')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json(FX.txdotSnapshot)));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const deps = (): FrameDeps => ({
  env: {},
  fetchOpts: { resolve: async () => [{ address: '127.0.0.1', family: 4 }], isBlocked: () => false, ports: new Set([String(port)]) },
});

const def = (): ProviderDef => ({
  region: 'europe',
  row: { ...PROVIDERS.find((p) => p.row.id === 'dgt')!.row, id: 'testcam', max_poll_interval: 90 },
  rules: [{ host: 'cams.test', pathPrefix: '/cams/', protocols: ['http:'], port: String(port) }],
});

const cam = (still: string, extra: Partial<Camera> = {}): Camera => ({
  id: 'testcam-1', lat: 40, lng: -3, name: 'Test', providerId: 'testcam', city: null, country: 'ES', streamType: 'jpg',
  stillUrl: `http://cams.test:${port}${still}`, streamUrl: null, externalUrl: null, headingDeg: null, observedAt: null, source: 'testcam', ...extra,
});

describe('stills-only frame relay', () => {
  it('relays an image with the operator frame time and poll-interval caching, storing nothing', async () => {
    const r = await fetchFrame(cam('/cams/ok.jpg'), def(), deps());
    expect(r).toMatchObject({ ok: true, contentType: 'image/jpeg', observedAt: '2026-09-30T20:02:17.000Z', maxAgeS: 90 });
    const res = frameResponse(r);
    expect(res.headers.get('cache-control')).toBe('public, max-age=90, s-maxage=90');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-observed-at')).toBe('2026-09-30T20:02:17.000Z');
    expect(Buffer.from(await res.arrayBuffer()).equals(JPEG)).toBe(true);
  });

  it('sniffs octet-stream JPEGs (Singapore) and refuses non-images', async () => {
    expect(await fetchFrame(cam('/cams/octet.jpg'), def(), deps())).toMatchObject({ ok: true, contentType: 'image/jpeg' });
    expect(await fetchFrame(cam('/cams/html.jpg'), def(), deps())).toMatchObject({ ok: false, status: 502, error: 'not_an_image' });
    expect(acceptImage('image/jpeg', Buffer.from('<html>'))).toBeNull();
    expect(acceptImage('text/html', JPEG)).toBeNull();
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
  });

  it('caps the size', async () => {
    expect(await fetchFrame(cam('/cams/huge.jpg'), def(), deps())).toMatchObject({ ok: false, status: 502, error: 'too_large' });
  });

  it('re-checks every redirect hop against the allow-list', async () => {
    expect(await fetchFrame(cam('/cams/redirect-off.jpg'), def(), deps())).toMatchObject({ ok: false, status: 403, error: 'blocked' });
    expect(await fetchFrame(cam('/cams/redirect-on.jpg'), def(), deps())).toMatchObject({ ok: true });
  });

  it('refuses URLs off the allow-list, other ports and reserved addresses', async () => {
    expect(await fetchFrame(cam('/private/x.jpg'), def(), deps())).toMatchObject({ ok: false, status: 403 });
    const wrongPort = { ...cam('/cams/ok.jpg'), stillUrl: `http://cams.test:${port + 1}/cams/ok.jpg` };
    expect(await fetchFrame(wrongPort, def(), deps())).toMatchObject({ ok: false, status: 403 });
    // Production guard: loopback is reserved even when the host is allow-listed.
    const guarded: FrameDeps = { env: {}, fetchOpts: { resolve: async () => [{ address: '127.0.0.1', family: 4 }], ports: new Set([String(port)]) } };
    expect(await fetchFrame(cam('/cams/ok.jpg'), def(), guarded)).toMatchObject({ ok: false, status: 403, error: 'blocked' });
  });

  it('serves nothing for link-out-only providers or regions', async () => {
    expect(await fetchFrame(cam('/cams/ok.jpg'), def(), { ...deps(), env: { CCTV_LINK_OUT_ONLY: 'ES' } })).toMatchObject({ ok: false, status: 404, error: 'link_out_only' });
    const rws = PROVIDERS.find((p) => p.row.id === 'rws')!;
    expect(await fetchFrame(cam('/cams/ok.jpg', { providerId: 'rws' }), rws, deps())).toMatchObject({ ok: false, error: 'link_out_only' });
  });
});

describe('TxDOT snapshots', () => {
  it('decodes the base64 JPEG and converts the Texas local time to UTC', async () => {
    const tx: ProviderDef = { ...PROVIDERS.find((p) => p.row.id === 'txdot')!, rules: [{ host: 'its.test', pathPrefix: '/its/DistrictIts/GetCctvSnapshotByIcdId', protocols: ['http:'], port: String(port) }] };
    const c = cam('', { id: 'txdot-AUS-FM-734 @ US-290 EB', providerId: 'txdot', stillUrl: `http://its.test:${port}/its/DistrictIts/GetCctvSnapshotByIcdId?districtCode=AUS&icdId=FM-734%20%40%20US-290%20EB` });
    const r = await fetchTxdotSnapshot(c, tx, deps());
    expect(r).toMatchObject({ ok: true, contentType: 'image/jpeg', observedAt: '2026-09-30T20:02:00.000Z', maxAgeS: 30 });
  });

  it('zonedToUtc handles CDT/CST/MDT and rejects junk', () => {
    expect(zonedToUtc('9/30/2026 3:02 PM', 'America/Chicago')).toBe('2026-09-30T20:02:00.000Z');
    expect(zonedToUtc('1/15/2026 12:05 AM', 'America/Chicago')).toBe('2026-01-15T06:05:00.000Z');
    expect(zonedToUtc('9/30/2026 3:02 PM', 'America/Denver')).toBe('2026-09-30T21:02:00.000Z');
    expect(zonedToUtc('yesterday', 'America/Chicago')).toBeNull();
  });
});

describe('stream status probe', () => {
  it('HLS: online only for a real #EXTM3U playlist', async () => {
    const d = def();
    expect(await probeCamera(cam('/cams/ok.jpg', { streamType: 'hls', streamUrl: `http://cams.test:${port}/cams/live.m3u8` }), d, deps())).toMatchObject({ status: 'online', httpStatus: 200 });
    expect(await probeCamera(cam('/cams/ok.jpg', { streamType: 'hls', streamUrl: `http://cams.test:${port}/cams/gone.m3u8` }), d, deps())).toMatchObject({ status: 'offline', httpStatus: 404 });
  });

  it('stills: online when the frame is an image; link-out is unknown', async () => {
    expect(await probeCamera(cam('/cams/ok.jpg'), def(), deps())).toMatchObject({ status: 'online' });
    expect(await probeCamera(cam('/cams/html.jpg'), def(), deps())).toMatchObject({ status: 'offline' });
    expect(await probeCamera(cam('/cams/ok.jpg'), def(), { ...deps(), env: { CCTV_LINK_OUT_ONLY: 'europe' } })).toMatchObject({ status: 'unknown', httpStatus: null });
  });
});

describe('playback resolution', () => {
  const caltrans = providerRow(PROVIDERS.find((p) => p.row.id === 'caltrans')!, {});
  const tfl = providerRow(PROVIDERS.find((p) => p.row.id === 'tfl')!, {});
  const hls: Camera = { ...cam('/x.jpg'), id: 'caltrans-d7-1', providerId: 'caltrans', streamType: 'hls', stillUrl: 'https://cwwp2.dot.ca.gov/data/d7/cctv/image/a/a.jpg', streamUrl: 'https://wzmedia.dot.ca.gov/D7/CCTV-196.stream/playlist.m3u8' };

  it('plays direct video only from MEDIA_HOSTS, else the proxied still', () => {
    expect(playableFor(hls, caltrans, [])).toEqual({ type: 'jpg', url: '/api/cctv/proxy?id=caltrans-d7-1' });
    expect(playableFor(hls, caltrans, ['https://wzmedia.dot.ca.gov/'])).toEqual({ type: 'hls', url: hls.streamUrl });
    const clip: Camera = { ...hls, id: 'tfl-00002.00865', providerId: 'tfl', streamType: 'mp4', streamUrl: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00002.00865.mp4' };
    expect(playableFor(clip, tfl)).toEqual({ type: 'mp4', url: clip.streamUrl });
    expect(playableFor({ ...clip, streamUrl: 'https://s3-eu-west-1.amazonaws.com/other-bucket/x.mp4' }, tfl)).toEqual({ type: 'jpg', url: '/api/cctv/proxy?id=tfl-00002.00865' });
  });

  it('link-out-only cameras expose no frame or stream URL and nothing to play', () => {
    const lo = { ...caltrans, link_out_only: true, proxy_allowed: false };
    expect(publicCamera(hls, lo)).toMatchObject({ streamType: 'link', stillUrl: null, streamUrl: null });
    expect(playableFor(hls, lo)).toBeNull();
  });

  it('turns MEDIA_HOSTS entries (incl. wildcards) into allow rules', () => {
    expect(mediaRules(['https://*.its.nv.gov', 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/'])).toEqual([
      { host: '*.its.nv.gov', pathPrefix: '/' },
      { host: 's3-eu-west-1.amazonaws.com', pathPrefix: '/jamcams.tfl.gov.uk/' },
    ]);
  });
});

describe('frame request headers', () => {
  it('lists image types explicitly (eismoinfo.lt answers 406 to a bare image/*)', () => {
    expect(FRAME_ACCEPT).not.toBe('image/*');
    expect(FRAME_ACCEPT.split(',')[0]).toBe('image/jpeg');
  });
});
