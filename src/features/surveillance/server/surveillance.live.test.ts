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
