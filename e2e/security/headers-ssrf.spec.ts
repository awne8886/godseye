import { expect, test, type APIRequestContext, type TestInfo } from '@playwright/test';

/**
 * Security audit (round 8), against the real production server: security headers on every kind of
 * response, the SSRF guard on the one user-URL route, the image optimiser's exact host list, and the
 * per-route rate limit keyed on the proxy-appended X-Forwarded-For entry (other client-IP headers
 * never mint fresh buckets). API-only: no browser page is opened.
 */

/** A client address unique to this project and run, so the rate-limit buckets never collide. */
function clientNet(info: TestInfo): string {
  const run = (Date.now() % 0xfff0).toString(16);
  return `2001:db8:${run}:${info.project.name === 'mobile' ? 'b' : 'a'}`;
}

async function headersOf(request: APIRequestContext, path: string) {
  const res = await request.get(path, { maxRedirects: 0 });
  return { status: res.status(), h: res.headers() };
}

test.describe('security headers on real responses', () => {
  test('page, API JSON, API 404 and a static chunk all carry CSP, HSTS, XFO, nosniff', async ({ request }) => {
    const html = await (await request.get('/')).text();
    const chunk = /\/_next\/static\/[^"'\s]+\.js/.exec(html)?.[0];
    expect(chunk, 'a static chunk referenced by /').toBeTruthy();
    for (const path of ['/', '/api/health', '/api/does-not-exist', '/docs', chunk!]) {
      const { h } = await headersOf(request, path);
      const csp = h['content-security-policy'] ?? '';
      expect(csp, path).toMatch(/(^|;\s*)worker-src 'self'( |;|$)/);
      expect(csp, path).toMatch(/frame-ancestors 'none'/);
      expect(csp, path).toMatch(/object-src 'none'/);
      expect(csp, path).not.toMatch(/'unsafe-eval'/);
      expect(csp, path).not.toMatch(/(^|\s)\*(\s|;|$)/);
      expect(h['strict-transport-security'], path).toMatch(/max-age=\d{7,}/);
      expect(h['x-frame-options'], path).toBe('DENY');
      expect(h['x-content-type-options'], path).toBe('nosniff');
      expect(h['x-powered-by'], path).toBeUndefined();
    }
  });
});

test.describe('SSRF guard on /api/osint/headers', () => {
  const targets = [
    'http://127.0.0.1/',
    'http://localhost/',
    'http://169.254.169.254/latest/meta-data/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://2130706433/',
    'http://0x7f.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[fd00::1]/',
    'http://100.64.0.1/',
    'http://10.0.0.1:8080/',
    'http://example.com:6379/',
    'http://user:pw@example.com/',
    'file:///etc/passwd',
    'gopher://example.com/',
  ];
  test('private, loopback, metadata, non-canonical and odd-scheme targets answer 400 blocked_target', async ({ request }, info) => {
    const net = clientNet(info);
    let i = 0;
    for (const url of targets) {
      // A fresh /64 per probe keeps the 20/min OSINT limit out of the way (8 × 20 per /48 > 15).
      const res = await request.get(`/api/osint/headers?url=${encodeURIComponent(url)}`, { headers: { 'x-forwarded-for': `${net}${(i++).toString(16)}::1` } });
      expect(res.status(), url).toBe(400);
      expect((await res.json()).error, url).toBe('blocked_target');
    }
  });
});

test.describe('image optimiser host list', () => {
  for (const url of ['http://169.254.169.254/latest/meta-data/', 'https://example.com/a.png', 'https://upload.wikimedia.org.evil.example/wikipedia/commons/a.png', '//127.0.0.1/api/health']) {
    test(`refuses ${url}`, async ({ request }) => {
      const res = await request.get(`/_next/image?url=${encodeURIComponent(url)}&w=64&q=75`);
      expect(res.status()).toBe(400);
      // Refused for its host, not for the width or quality (that 400 would pass for the wrong reason).
      expect((await res.text()).trim()).toMatch(/^"url" parameter (is not allowed|cannot be a protocol-relative URL \(\/\/\))$/);
    });
  }
});

test.describe('per-route rate limit and client-IP trust order', () => {
  test('21st OSINT call from one client is 429; x-real-ip / cf-connecting-ip / leftmost XFF do not reset it', async ({ request }, info) => {
    const ip = `${clientNet(info)}f::7`;
    const call = (extra: Record<string, string> = {}) => request.get('/api/osint/mac?mac=zz', { headers: { 'x-forwarded-for': ip, ...extra } });
    for (let n = 1; n <= 20; n++) expect((await call()).status(), `call ${n}`).toBe(400);
    const limited = await call();
    expect(limited.status()).toBe(429);
    expect(Number(limited.headers()['retry-after'])).toBeGreaterThan(0);
    expect(limited.headers()['x-ratelimit-limit']).toBe('20');
    expect((await call({ 'x-real-ip': '8.8.4.4' })).status()).toBe(429);
    expect((await call({ 'cf-connecting-ip': '8.8.4.4' })).status()).toBe(429);
    expect((await request.get('/api/osint/mac?mac=zz', { headers: { 'x-forwarded-for': `9.9.9.9, ${ip}` } })).status()).toBe(429);
    // Another route keeps its own bucket for the same client.
    expect((await request.get('/api/osint/cve?id=bad', { headers: { 'x-forwarded-for': ip } })).status()).toBe(400);
  });
});
