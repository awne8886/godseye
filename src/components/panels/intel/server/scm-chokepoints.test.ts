import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore, clearL1, setStore } from '@/lib/cache';
import { defineFeed, resetFeeds } from '@/lib/feeds';
import { chokepointAlerts } from './scm';

beforeEach(() => setStore(new MemoryStore()));
afterEach(() => {
  resetFeeds();
  clearL1();
  setStore(undefined);
});

const feedWith = (chokepoints: unknown[]) =>
  defineFeed({
    key: 'maritime',
    ttlMs: 60_000,
    kind: 'mixed',
    attribution: [{ text: 'test' }],
    count: () => 1,
    run: async () => ({ data: { chokepoints }, providers: {} }),
  });

describe('SCM chokepoint alerts', () => {
  it('never turns a curated (reference) base risk into an alert', async () => {
    feedWith([{ name: 'Strait of Hormuz', baseRisk: 'HIGH', risk: 'HIGH' }]);
    expect((await chokepointAlerts()).alerts).toEqual([]);
  });
  it('alerts when live AIS raises the risk above the base level', async () => {
    feedWith([{ name: 'Suez Canal', baseRisk: 'MODERATE', risk: 'HIGH', message: '42 ships waiting' }]);
    expect((await chokepointAlerts()).alerts).toEqual([{ chokepoint: 'Suez Canal', risk: 'HIGH', message: '42 ships waiting' }]);
  });
});
