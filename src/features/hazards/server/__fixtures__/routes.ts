/**
 * Test-only helpers shared by the hazards route tests (imported only from *.test.ts files).
 */
import { clearL1, MemoryStore, setStore } from '@/lib/cache';

let n = 0;

/** A GET request from a distinct client IP each time (per-IP route limits never interfere). */
export function req(path: string, headers: Record<string, string> = {}): Request {
  n++;
  return new Request(`http://localhost${path}`, { headers: { 'x-forwarded-for': `10.77.${(n >> 8) & 255}.${n & 255}`, ...headers } });
}

export function freshCache(): void {
  clearL1();
  setStore(new MemoryStore());
}

export function resetCache(): void {
  setStore(undefined);
}
