/**
 * Live upstream checks (opt-in: RUN_LIVE_TESTS=1). Each keyless loader must return cameras from
 * the real operator, and the live-news check must parse at least one channel page.
 */
import { describe, expect, it } from 'vitest';
import { Camera } from '@/lib/schemas/surveillance';
import { checkLive, CHANNELS } from './live-news';
import { LOADERS } from './loaders';
import { matchesAllowList } from '@/lib/ssrf';
import { PROVIDERS, providerDef, rulesFor } from './registry';

const live = process.env.RUN_LIVE_TESTS === '1';
const keyless = PROVIDERS.filter((p) => !p.capability).map((p) => p.row.id);

describe('camera providers (live)', () => {
  for (const id of keyless) {
    it.runIf(live)(`${id} returns valid cameras`, { timeout: 60_000 }, async () => {
      const rows = await LOADERS[id]!(AbortSignal.timeout(55_000));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.slice(0, 50).every((r) => Camera.safeParse(r).success)).toBe(true);
    });
  }

  it.runIf(live)('live-news check answers for at least one channel', { timeout: 60_000 }, async () => {
    const results = await Promise.all(CHANNELS.slice(0, 3).map((c) => checkLive(c.youtubeChannelId).catch(() => null)));
    expect(results.some((r) => r !== null)).toBe(true);
  });
});

// Needs a running server too: CCTV_BASE_URL=http://127.0.0.1:3000.
const served = live && !!process.env.CCTV_BASE_URL;
const allowed = (id: string, url: string) => matchesAllowList(new URL(url), rulesFor(providerDef(id)!, url));

describe('live: every row served by /api/cctv is inside its allow-list', () => {
  it.runIf(served)('all regions', { timeout: 300_000 }, async () => {
    const misses: string[] = [];
    for (const region of ['us-west', 'texas', 'us-midwest', 'canada', 'europe', 'nordics', 'asia', 'oceania']) {
      const d = (await (await fetch(`${process.env.CCTV_BASE_URL}/api/cctv?region=${region}`)).json()) as { fields?: string[]; rows?: unknown[][] };
      if (!d.fields || !d.rows) continue;
      const I = Object.fromEntries(d.fields.map((f, i) => [f, i]));
      for (const r of d.rows) {
        const id = r[I.providerId!] as string;
        const s = r[I.stillUrl!] as string | null;
        if (s && providerDef(id) && !allowed(id, s)) misses.push(s);
      }
    }
    expect(misses.slice(0, 5)).toEqual([]);
  });
});

// Round 4: one official still per provider type through the real relay (2 s apart).
describe('live: frame time and refusals through fetchFrame', () => {
  const still = (providerId: string, id: string, url: string) => ({
    id, lat: 0, lng: 0, name: id, providerId, city: null, country: null, streamType: 'jpg' as const, stillUrl: url, streamUrl: null, externalUrl: null, headingDeg: null, observedAt: null, source: providerId,
  });
  it.runIf(live)('HK TD / Caltrans / Fintraffic frames carry the operator time; NSW HTML is refused, never relayed', { timeout: 90_000 }, async () => {
    const { fetchFrame } = await import('./frames');
    const cases = [
      still('hktd', 'hktd-H429F', 'https://tdcctv.data.one.gov.hk/H429F.JPG'),
      still('caltrans', 'caltrans-d7-live', 'https://cwwp2.dot.ca.gov/data/d7/cctv/image/i110196avenue26offramp/i110196avenue26offramp.jpg'),
      still('digitraffic', 'digitraffic-C0150301', 'https://weathercam.digitraffic.fi/C0150301.jpg'),
      still('nsw', 'nsw-5-ways-miranda', 'https://webcams.transport.nsw.gov.au/livetraffic-webcams/cameras/5_ways_miranda.jpeg'),
    ];
    let relayed = 0;
    for (const c of cases) {
      const r = await fetchFrame(c, providerDef(c.providerId)!);
      console.info(c.id, r.ok ? { ok: true, type: r.contentType, observedAt: r.observedAt, timeSource: r.timeSource, fetchedAt: r.fetchedAt } : { ok: false, error: r.error, upstreamType: r.upstreamType ?? null });
      if (r.ok) {
        relayed++;
        expect(r.contentType, c.id).toMatch(/^image\//);
        expect(['operator', 'last-modified', 'none']).toContain(r.timeSource);
        if (r.observedAt) expect(Date.parse(r.observedAt)).toBeLessThanOrEqual(Date.parse(r.fetchedAt) + 60_000);
      } else {
        // Only an outage may fail, and an HTML page must be classified as one.
        expect(['not_an_image', 'timeout', 'network'], `${c.id}: ${r.error}`).toContain(r.error);
      }
      await new Promise((res) => setTimeout(res, 2_000));
    }
    expect(relayed, 'no operator reachable: the check proved nothing').toBeGreaterThan(0);
  });
});
