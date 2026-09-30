/**
 * Test-only request/cache helpers (kept apart from index.ts, which vi.mock factories import: pulling
 * @/lib/cache into a factory would re-enter the mocked @/lib/http).
 */
import { clearL1, MemoryStore, setStore } from '@/lib/cache';

let n = 0;

/** A request from a distinct client IP each time (per-IP limits never interfere) unless `ip` is given. */
export function req(path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown; ip?: string } = {}): Request {
  n++;
  const ip = init.ip ?? `10.88.${(n >> 8) & 255}.${n & 255}`;
  return new Request(`http://localhost${path}`, {
    method: init.method ?? 'GET',
    headers: { 'x-forwarded-for': ip, ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...init.headers },
    ...(init.body !== undefined ? { body: typeof init.body === 'string' ? init.body : JSON.stringify(init.body) } : {}),
  });
}

export function freshCache(): void {
  clearL1();
  setStore(new MemoryStore());
}

export function resetCache(): void {
  setStore(undefined);
}

