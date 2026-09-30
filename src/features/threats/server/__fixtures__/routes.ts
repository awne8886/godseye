/**
 * Test-only route helpers (kept apart from index.ts: the vi.mock('@/lib/http') factory imports
 * index.ts, and '@/lib/cache' imports '@/lib/http', so importing it there would deadlock).
 */
import { clearL1, MemoryStore, setStore } from '@/lib/cache';

let n = 0;
/** A request from a distinct client IP each time (per-IP route limits never interfere). */
export function req(path: string, init: RequestInit & { headers?: Record<string, string> } = {}): Request {
  n++;
  return new Request(`http://localhost${path}`, { ...init, headers: { 'x-forwarded-for': `10.88.${(n >> 8) & 255}.${n & 255}`, ...init.headers } });
}

export function freshCache(): void {
  clearL1();
  setStore(new MemoryStore());
}

export function resetCache(): void {
  setStore(undefined);
}
