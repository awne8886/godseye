/**
 * RIPEstat Data API client. RIPE asks for ≤ 8 concurrent requests per client and publishes a
 * 1000 requests/day soft budget for anonymous use: every call takes a slot in an 8-wide
 * semaphore and one unit of a UTC-day budget; answers are cached 1 h per URL. When the budget is
 * spent the provider reports `skipped: 'budget'` instead of hammering the service.
 * `sourceapp` identifies GODSEYE as RIPE requests. Owner: panels-recon. Server-only.
 */
import 'server-only';
import { HttpError, httpJson } from '@/lib/http';
import type { ProviderStatus } from '@/lib/types';
import { probe, skipped, type Probe } from './lookup';

export const RIPE_MAX_CONCURRENT = 8;
export const RIPE_DAILY_BUDGET = 1000;
const RIPE_TTL_MS = 3600_000;

/** Counting semaphore (FIFO). */
export class Semaphore {
  private active = 0;
  private readonly waiters: (() => void)[] = [];
  constructor(readonly max: number) {}
  get inFlight() {
    return this.active;
  }
  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.waiters.push(r));
    this.active++;
    try {
      return await job();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }
}

/** Requests per UTC day. */
export class DailyBudget {
  private day = '';
  used = 0;
  constructor(readonly limit: number) {}
  tryTake(now = Date.now()): boolean {
    const d = new Date(now).toISOString().slice(0, 10);
    if (d !== this.day) {
      this.day = d;
      this.used = 0;
    }
    if (this.used >= this.limit) return false;
    this.used++;
    return true;
  }
}

const G = globalThis as unknown as { __godseyeRipe?: { sem: Semaphore; budget: DailyBudget } };
export const ripeState = (G.__godseyeRipe ??= { sem: new Semaphore(RIPE_MAX_CONCURRENT), budget: new DailyBudget(RIPE_DAILY_BUDGET) });

export class BudgetError extends Error {
  constructor() {
    super('RIPEstat daily budget spent');
    this.name = 'BudgetError';
  }
}

export interface RipeEnvelope<T> {
  status?: string;
  data?: T;
  messages?: [string, string][];
}

export function ripeUrl(endpoint: string, resource: string, extra: Record<string, string> = {}): string {
  const u = new URL(`https://stat.ripe.net/data/${endpoint}/data.json`);
  u.searchParams.set('resource', resource);
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  u.searchParams.set('sourceapp', 'godseye');
  return u.toString();
}

async function fetchRipe<T>(endpoint: string, resource: string, extra?: Record<string, string>): Promise<T> {
  if (!ripeState.budget.tryTake()) throw new BudgetError();
  const url = ripeUrl(endpoint, resource, extra);
  return ripeState.sem.run(async () => {
    const { data } = await httpJson<RipeEnvelope<T>>(url, { timeoutMs: 10_000, retries: 1, deadlineMs: 20_000 });
    if (!data || data.status !== 'ok' || !data.data) throw new HttpError(`RIPEstat ${endpoint} status ${data?.status ?? 'none'}`, 'parse', url);
    return data.data;
  });
}

/** One cached RIPEstat call with an honest status (`skipped: 'budget'` when the day's budget is spent). */
export async function ripe<T>(endpoint: string, resource: string, count: (d: T) => number, extra?: Record<string, string>): Promise<Probe<T>> {
  const p = await probe(`ripe:${endpoint}:${resource}:${JSON.stringify(extra ?? {})}`, RIPE_TTL_MS, () => fetchRipe<T>(endpoint, resource, extra), { count, allowEmpty: true });
  if (!p.status.ok && p.status.error === 'error' && ripeState.budget.used >= ripeState.budget.limit) {
    return { value: null, status: skipped('budget'), fetchedAt: null };
  }
  return p;
}

/** Merge several RIPEstat calls into one provider row. */
export function mergeStatus(parts: ProviderStatus[]): ProviderStatus {
  const ok = parts.some((p) => p.ok);
  const ages = parts.map((p) => p.age_s).filter((a): a is number => a !== null);
  const failed = parts.find((p) => !p.ok);
  return {
    ok,
    count: parts.reduce((n, p) => n + p.count, 0),
    ms: Math.max(0, ...parts.map((p) => p.ms)),
    age_s: ok && ages.length ? Math.max(...ages) : null,
    ...(!ok && failed?.error ? { error: failed.error } : {}),
    ...(!ok && failed?.skipped ? { skipped: failed.skipped } : {}),
  };
}
