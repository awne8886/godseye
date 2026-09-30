/**
 * Route-test helpers for panels-recon: a fresh client IP per request (so the catalogue rate limits
 * do not interfere unless a test wants them to) and OsintResponse validation. Test-only.
 */
import { expect } from 'vitest';
import { OsintResponse } from '@/lib/schemas';
import { MemoryStore, clearL1, setStore } from '@/lib/cache';
import { upstream } from './mock-http';

let n = 1;
export function req(url: string, ip?: string): Request {
  const a = n++;
  return new Request(url, { headers: { 'x-forwarded-for': ip ?? `11.${(a >> 16) & 255}.${(a >> 8) & 255}.${a & 255}` } });
}

export function freshState() {
  clearL1();
  setStore(new MemoryStore());
  upstream.reset();
}

type Handler = (req: Request, ctx: undefined) => Promise<Response> | Response;
export const get = (h: Handler, url: string, ip?: string) => h(req(url, ip), undefined);

export async function osint(res: Response, tool: string) {
  expect(res.status, await res.clone().text()).toBe(200);
  const body = await res.json();
  const parsed = OsintResponse.safeParse(body);
  expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 3))).toBe(true);
  expect(body.tool).toBe(tool);
  expect(Object.keys(body.providers).length).toBeGreaterThan(0);
  return body;
}

export async function error(res: Response, status: number) {
  expect(res.status).toBe(status);
  const body = await res.json();
  expect(typeof body.error).toBe('string');
  expect(res.headers.get('cache-control')).toContain('no-store');
  return body;
}
