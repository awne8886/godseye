/**
 * Test-only helpers for the surveillance route tests (imported only from *.test.ts files):
 * fixture-backed loaders (recorded 2026-09-30), distinct client IPs, and cache/feed resets.
 */
import { clearL1, MemoryStore, setStore } from '@/lib/cache';
import { resetFeeds } from '@/lib/feeds';
import { resetRegionFeeds } from '../catalog';
import { FX, json } from './index';

export { fixtureLoaders } from './loaders';

let n = 0;

export function req(path: string, headers: Record<string, string> = {}): Request {
  n++;
  return new Request(`http://localhost${path}`, { headers: { 'x-forwarded-for': `10.88.${(n >> 8) & 255}.${n & 255}`, ...headers } });
}

export function fresh(): void {
  resetFeeds();
  resetRegionFeeds();
  clearL1();
  setStore(new MemoryStore());
}

export function done(): void {
  resetFeeds();
  resetRegionFeeds();
  setStore(undefined);
}

/** A real JPEG (the TxDOT snapshot fixture decoded). */
export function jpeg(): Buffer {
  return Buffer.from(json<{ snippet: string }>(FX.txdotSnapshot).snippet, 'base64');
}
