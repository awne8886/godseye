// Phase 3 round 1 security audit regressions (cross-site POSTs, body caps, secret redaction,
// IPv6 bucket keys, SSE and snapshot memory budgets).
import { mkdtemp, readdir, rm, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { readBody } from '@/components/panels/intel/server/ai-route';
import { FileStore, MemoryStore, type StoredSnapshot } from '@/lib/cache';
import { HttpError, redactUrl } from '@/lib/http';
import { MemoryRateLimitStore, getClientIp, ipBucketKey, ipTrustFromEnv, rateLimit, setRateLimitStore } from '@/lib/ratelimit';
import { isCrossSite, readBodyCapped, withRoute } from '@/lib/respond';
import { SseHub, sseQueuedBytes } from '@/lib/sse';

afterEach(() => setRateLimitStore(undefined));

const post = (headers: Record<string, string>, body = '{}') => new Request('http://godseye.test/api/ai/overview', { method: 'POST', headers, body });

describe('cross-site requests', () => {
  it('classifies Sec-Fetch-Site and falls back to Origin vs Host', () => {
    expect(isCrossSite(post({ 'sec-fetch-site': 'same-origin' }))).toBe(false);
    expect(isCrossSite(post({ 'sec-fetch-site': 'none' }))).toBe(false);
    expect(isCrossSite(post({ 'sec-fetch-site': 'cross-site' }))).toBe(true);
    expect(isCrossSite(post({ 'sec-fetch-site': 'same-site' }))).toBe(true);
    expect(isCrossSite(post({ origin: 'http://godseye.test', host: 'godseye.test' }))).toBe(false);
    expect(isCrossSite(post({ origin: 'https://evil.example', host: 'godseye.test' }))).toBe(true);
    expect(isCrossSite(post({ origin: 'null' }))).toBe(true); // sandboxed iframe / data: URL
    expect(isCrossSite(post({}))).toBe(false); // curl, SDK clients: no browser, no ambient credentials
  });

  it('withRoute refuses a cross-site POST before the handler or the rate limiter runs', async () => {
    setRateLimitStore(new MemoryRateLimitStore());
    let ran = 0;
    const h = withRoute('/api/ai/overview', async () => {
      ran++;
      return new Response('ok');
    });
    const res = await h(post({ 'sec-fetch-site': 'cross-site', 'x-forwarded-for': '203.0.113.9' }), {});
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('cross_site_request');
    expect(ran).toBe(0);
    expect((await h(post({ 'sec-fetch-site': 'same-origin', 'x-forwarded-for': '203.0.113.9' }), {})).status).toBe(200);
    // GET stays open to other sites (read-only, cacheable, documented public API).
    expect((await h(new Request('http://godseye.test/api/ai/overview', { headers: { 'sec-fetch-site': 'cross-site' } }), {})).status).toBe(200);
  });
});

describe('request body caps', () => {
  const streamed = (bytes: number) =>
    new Request('http://x/', {
      method: 'POST',
      body: new ReadableStream({
        start(c) {
          for (let i = 0; i < bytes; i += 1024) c.enqueue(new Uint8Array(Math.min(1024, bytes - i)).fill(0x61));
          c.close();
        },
      }),
      // @ts-expect-error Node's fetch needs duplex for a streamed request body
      duplex: 'half',
    });

  it('stops reading at the cap even when Content-Length is absent', async () => {
    expect(await readBodyCapped(streamed(4096), 8192)).toHaveLength(4096);
    expect(await readBodyCapped(streamed(64 * 1024), 8192)).toBeNull();
    expect(await readBodyCapped(new Request('http://x/', { method: 'POST', body: 'x', headers: { 'content-length': '999999' } }), 8192)).toBeNull();
  });

  it('AI routes accept JSON only (415) and cap the body at 32 KB (413)', async () => {
    const S = z.object({ q: z.string() });
    const text = await readBody(post({ 'content-type': 'text/plain' }, '{"q":"x"}'), S);
    expect(text.ok || text.response.status).toBe(415);
    const big = await readBody(post({ 'content-type': 'application/json' }, JSON.stringify({ q: 'x'.repeat(40 * 1024) })), S);
    expect(big.ok || big.response.status).toBe(413);
    const ok = await readBody(post({ 'content-type': 'application/json; charset=utf-8' }, '{"q":"hi"}'), S);
    expect(ok.ok && ok.data).toEqual({ q: 'hi' });
  });
});

describe('secret redaction', () => {
  it('redacts key-like query values and URL passwords', () => {
    const r = redactUrl('https://user:pw@api.tfl.gov.uk/Place/Type/JamCam?app_key=abc123&modes=tube&apiKey=zz');
    expect(r).not.toMatch(/abc123|zz|pw@/);
    expect(r).toContain('modes=tube');
    expect(redactUrl('not a url')).toBe('not a url');
  });

  it('HttpError never carries the key in its url', () => {
    const e = new HttpError('boom', 'http', 'https://services.nvd.nist.gov/rest/json/cves/2.0?apiKey=SECRET&cveId=CVE-1', 500);
    expect(e.url).not.toContain('SECRET');
    expect(e.url).toContain('cveId=CVE-1');
  });
});

describe('IPv6 bucket keys', () => {
  it('drops zone ids instead of failing key derivation', () => {
    const h = new Headers({ 'x-forwarded-for': 'fe80::1%eth0' });
    expect(getClientIp(h, ipTrustFromEnv({}))).toBe('fe80::1');
  });

  it('keys /64 and /48 prefixes', () => {
    expect(ipBucketKey('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64');
    expect(ipBucketKey('2001:db8:1:2:3:4:5:6', 48)).toBe('2001:db8:1::/48');
    expect(ipBucketKey('203.0.113.1', 48)).toBe('203.0.113.1');
  });

  it('caps a whole /48 on fail-closed routes, so rotating /64s does not mint fresh buckets', async () => {
    setRateLimitStore(new MemoryRateLimitStore());
    const opts = { limit: 1, windowS: 60, failClosed: true, bucket: 'ai-test' };
    const mk = (n: number) => new Request('http://x/api/ai/overview', { headers: { 'x-forwarded-for': `2001:db8:77:${n.toString(16)}::1` } });
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await rateLimit(mk(i), '/api/ai/overview', opts))?.status ?? 200);
    expect(statuses.filter((s) => s === 200)).toHaveLength(8); // 8 × the per-/64 limit
    expect(statuses.slice(8).every((s) => s === 429)).toBe(true);
    // Non-fail-closed routes keep plain per-/64 keying.
    for (let i = 0; i < 12; i++) expect(await rateLimit(mk(100 + i), '/api/test-open', { limit: 1, windowS: 60 })).toBeNull();
  });
});

describe('SSE process-wide buffer accounting', () => {
  it('counts bytes queued for a client that never reads and releases them when it is dropped', async () => {
    const base = sseQueuedBytes();
    const hub = new SseHub('c-sec-queued', () => null, 100, 4);
    const res = hub.subscribe(new Request('http://x/api/stream', { headers: { 'x-forwarded-for': '192.0.2.77' } }), undefined, '192.0.2.77');
    await new Promise((r) => setTimeout(r, 0));
    hub.broadcast('update', { blob: 'x'.repeat(300 * 1024) });
    hub.broadcast('update', { blob: 'y' });
    expect(sseQueuedBytes() - base).toBeGreaterThan(64 * 1024);
    await res.body!.cancel();
    expect(sseQueuedBytes()).toBe(base);
  });
});

describe('snapshot store budgets', () => {
  const snap = (n: number): StoredSnapshot<string> => ({ data: 'x'.repeat(n), fetchedAt: Date.now(), lastAttemptAt: Date.now(), error: null });

  it('MemoryStore evicts per-query entries by bytes, never pinned feed snapshots', async () => {
    const m = new MemoryStore(1000, 10_000);
    await m.set('feed', snap(50_000), 60_000, { pinned: true });
    for (let i = 0; i < 10; i++) await m.set(`q${i}`, snap(2_000), 60_000);
    expect(m.evictableBytes).toBeLessThanOrEqual(10_000);
    expect(await m.get('q0')).toBeNull();
    expect(await m.get('q9')).not.toBeNull();
    expect(await m.get('feed')).not.toBeNull();
    await m.set('huge', snap(20_000), 60_000); // larger than the whole budget: not cached, nothing evicted
    expect(await m.get('huge')).toBeNull();
    expect(await m.get('q9')).not.toBeNull();
  });

  describe('FileStore', () => {
    let dir = '';
    afterEach(async () => {
      if (dir) await rm(dir, { recursive: true, force: true });
    });

    it('keeps pinned snapshots apart and sweeps expired and excess per-query files', async () => {
      dir = await mkdtemp(path.join(os.tmpdir(), 'godseye-fs-'));
      const fs = new FileStore(dir, 3);
      await fs.set('feed', snap(10), 60_000, { pinned: true });
      await fs.set('old', snap(10), 1);
      for (let i = 0; i < 5; i++) await fs.set(`q${i}`, snap(10), 60_000);
      // Age the files so "oldest" is deterministic regardless of filesystem timestamp resolution.
      const names = await readdir(path.join(dir, 'lru'));
      let t = Date.now() / 1000 - 1000;
      for (const n of names) await utimes(path.join(dir, 'lru', n), t, t++);
      const removed = await fs.sweep();
      expect(removed).toBeGreaterThanOrEqual(3); // 'old' expired + 2 beyond maxFiles
      expect(await readdir(path.join(dir, 'lru'))).toHaveLength(3);
      expect(await fs.get('feed')).not.toBeNull();
      expect(await readdir(path.join(dir, 'pinned'))).toHaveLength(1);
      // Re-pinning a key moves it between tiers instead of leaving a stale twin behind.
      await fs.set('q4', snap(10), 60_000, { pinned: true });
      expect(await readdir(path.join(dir, 'pinned'))).toHaveLength(2);
      await fs.delete('q4');
      expect(await fs.get('q4')).toBeNull();
    });
  });
});
