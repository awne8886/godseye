/**
 * Live upstream checks (opt-in: RUN_LIVE_TESTS=1). Each keyless loader must return cameras from
 * the real operator, and the live-news check must parse at least one channel page.
 */
import { describe, expect, it } from 'vitest';
import { Camera } from '@/lib/schemas/surveillance';
import { checkLive, CHANNELS } from './live-news';
import { LOADERS } from './loaders';
import { PROVIDERS } from './registry';

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
