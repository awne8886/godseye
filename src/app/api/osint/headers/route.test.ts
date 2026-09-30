import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HttpModule from '@/lib/http';
import type * as RateLimitModule from '@/lib/ratelimit';
import { upstream } from '@/components/panels/recon/__fixtures__/mock-http';
import { error, freshState, get, osint } from '@/components/panels/recon/__fixtures__/route-helpers';
import { gradeHeaders } from '@/components/panels/recon/server/headers';

// SSRF behaviour through the real safeFetch()/assertPublicUrl(); only the socket layer (httpRequest)
// and DNS are doubles. Header set modelled on the example.com HEAD probe of 2026-09-30.
vi.mock('@/lib/http', async (orig) => (await import('@/components/panels/recon/__fixtures__/mock-http')).mockHttp(await orig<typeof HttpModule>()));
vi.mock('@/lib/ratelimit', async (orig) => ({ ...(await orig<typeof RateLimitModule>()), providerBucket: () => ({ take: async () => undefined }) }));
const DNS: Record<string, string> = { 'good.example.org': '93.184.215.14', 'rebind.example.org': '10.1.2.3', 'xn--bcher-kva.example': '93.184.215.15' };
vi.mock('node:dns', () => {
  const lookup = async (host: string) => {
    const a = DNS[host];
    if (!a) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    return [{ address: a, family: 4 }];
  };
  return { default: { promises: { lookup } }, promises: { lookup } };
});

const { GET } = await import('./route');
const call = (target: string) => get(GET, `http://localhost/api/osint/headers?url=${encodeURIComponent(target)}`);

describe('GET /api/osint/headers', () => {
  beforeEach(() => {
    freshState();
    upstream.on('good.example.org', { status: 200, headers: { server: 'cloudflare', 'content-type': 'text/html' } });
    upstream.on('93.184.215.14', {
      status: 200,
      headers: { 'strict-transport-security': 'max-age=31536000', 'content-security-policy': "default-src 'self'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'permissions-policy': 'camera=()', 'x-powered-by': 'PHP/8.1.2' },
    });
  });

  it('grades a public URL transparently, proxied through this server', async () => {
    const body = await osint(await call('good.example.org'), 'headers');
    expect(body.query).toBe('https://good.example.org/');
    expect(body.data.grade).toBe('F');
    expect(body.data.via).toBe('proxied through this server');
    expect(body.findings.map((f: { label: string }) => f.label)).toEqual(expect.arrayContaining(['No HSTS (−20)', 'No Content-Security-Policy (−25)']));
    expect(body.providers.target.ok).toBe(true);
    expect(upstream.calls[0]!.method).toBe('HEAD');

    const good = await osint(await call('https://93.184.215.14/'), 'headers');
    expect(good.data.grade).toBe('A');
    expect(good.findings).toEqual([expect.objectContaining({ label: 'Version disclosed in x-powered-by (−5)' })]);
  });

  it('refuses private, loopback, metadata, bad-port, credentialed and non-http targets with 400 and no request', async () => {
    for (const bad of [
      'http://10.0.0.1/',
      'http://127.0.0.1:8080/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://2130706433/',
      'http://0x7f.1/',
      'https://localhost/',
      'https://printer.local/',
      `https://${'bücher'}.local/`,
      'https://good.example.org:22/',
      'https://user:pw@good.example.org/',
      'ftp://good.example.org/',
      'file:///etc/passwd',
      'https://rebind.example.org/',
      'https://no-such-host.example.org/',
    ]) {
      const body = await error(await call(bad), 400);
      expect(body.error, bad).toMatch(/blocked_target|invalid_request/);
    }
    expect(upstream.calls).toEqual([]);
  });

  it('re-validates every redirect hop (public → metadata / private is refused)', async () => {
    upstream.reset();
    upstream.on('93.184.215.20', { redirect: 'http://169.254.169.254/latest/meta-data/' });
    const a = await error(await call('http://93.184.215.20/'), 400);
    expect(a.error).toBe('blocked_target');
    upstream.on('93.184.215.21', { redirect: 'https://rebind.example.org/' });
    await error(await call('https://93.184.215.21/'), 400);
    upstream.on('93.184.215.22', { redirect: 'http://93.184.215.14/' });
    await error(await call('https://93.184.215.22/'), 400); // https → http downgrade
    expect(upstream.calls.every((c) => !c.url.includes('169.254') && !c.url.includes('rebind'))).toBe(true);
  });

  it('accepts IDN hosts after punycode conversion', async () => {
    upstream.on('xn--bcher-kva.example', { status: 200, headers: {} });
    const body = await osint(await call('https://bücher.example/'), 'headers');
    expect(body.data.url).toBe('https://xn--bcher-kva.example/');
  });

  it('does not count HSTS against plain-http final URLs but deducts for HTTP', () => {
    const g = gradeHeaders({}, false);
    expect(g.findings.some((f) => f.label.startsWith('No HSTS'))).toBe(false);
    expect(g.findings.some((f) => f.label.startsWith('Served over HTTP'))).toBe(true);
  });
});
