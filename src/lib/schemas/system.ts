/** System contracts: /api/health and /api/stats. Owner: lead. */
import { z } from 'zod';
import { IsoTime, ProviderStatus } from './common';

export const CapabilityState = z.object({
  enabled: z.boolean(),
  /** Why it is off, e.g. "ANTHROPIC_API_KEY not set", "OPENSKY_LICENSED not true". */
  reason: z.string().nullable(),
});

export const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  /** API routes this build serves (catalogue notation), so clients never call an absent route. */
  routes: z.array(z.string()),
  version: z.string(),
  uptimeS: z.number().nonnegative(),
  capabilities: z.record(z.string(), CapabilityState),
  feeds: z.record(
    z.string(),
    z.object({
      state: z.enum(['live', 'recent', 'stale', 'offline', 'reference', 'idle']),
      fetchedAt: IsoTime.nullable(),
      lastGoodAt: IsoTime.nullable(),
      count: z.number().int().nonnegative(),
      providers: z.record(z.string(), ProviderStatus),
    }),
  ),
  geocoder: z.object({
    queueDepth: z.number().int().nonnegative(),
    maxQueue: z.number().int().positive(),
    cached: z.number().int().nonnegative(),
    served: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
  }),
  store: z.enum(['memory', 'filesystem', 'redis']),
  timestamp: IsoTime,
});

/** Counts only (no entity data). Null means the feed has never produced a snapshot. */
export const StatsResponse = z.object({
  counts: z.record(z.string(), z.number().int().nonnegative().nullable()),
  timestamp: IsoTime,
});
