import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore, setStore } from '@/lib/cache';
import { FX, fixtureJson } from './__fixtures__';
import { ZONE_TTL_MS, resetZoneCache, resolveZones } from './nws-zones';

const ZONE = 'https://api.weather.gov/zones/county/ILC007';

beforeEach(() => {
  resetZoneCache();
  setStore(new MemoryStore());
});
afterEach(() => setStore(undefined));

describe('NWS zone geometry cache (30 days)', () => {
  it('fetches a zone once and serves it from cache within 30 days', async () => {
    const fetcher = vi.fn(async () => fixtureJson(FX.zone));
    const now = Date.parse('2026-09-30T18:00:00Z');
    const a = await resolveZones([ZONE, ZONE], { fetcher, now });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a.zones.get(ZONE)?.name).toBe('Boone');
    expect(a.fetched).toBe(1);
    const b = await resolveZones([ZONE], { fetcher, now: now + ZONE_TTL_MS - 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(b.zones.has(ZONE)).toBe(true);
    await resolveZones([ZONE], { fetcher, now: now + ZONE_TTL_MS + 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('persists to the snapshot store so a restart reuses it', async () => {
    const fetcher = vi.fn(async () => fixtureJson(FX.zone));
    await resolveZones([ZONE], { fetcher });
    resetZoneCache();
    const again = await resolveZones([ZONE], { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(again.zones.has(ZONE)).toBe(true);
  });

  it('budgets lookups per call and reports the rest as pending', async () => {
    const urls = Array.from({ length: 10 }, (_, i) => `https://api.weather.gov/zones/forecast/TXZ${String(i).padStart(3, '0')}`);
    const fetcher = vi.fn(async () => fixtureJson(FX.zone));
    const r = await resolveZones(urls, { fetcher, budget: 4, concurrency: 2 });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(r.pending).toBe(6);
  });

  it('only looks up api.weather.gov zone URLs and survives failures', async () => {
    const fetcher = vi.fn(async (u: string) => {
      if (u.endsWith('BAD')) throw new Error('http_500');
      return { geometry: null };
    });
    const r = await resolveZones(['https://evil.example/zones/x', 'https://api.weather.gov/zones/forecast/BAD', 'https://api.weather.gov/zones/forecast/NOGEOM'], { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(r.failed).toBe(1);
    expect(r.zones.size).toBe(0);
    // A zone without geometry is remembered for a day, not re-requested every refresh.
    await resolveZones(['https://api.weather.gov/zones/forecast/NOGEOM'], { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
