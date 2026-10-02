/**
 * Optional scanner backend proxy (/api/scanner). Off unless the operator sets SCANNER_URL and
 * SCANNER_KEY (`scanner` capability). Scans run from the operator's backend — "proxied through
 * this server", never from the visitor's browser. Safety:
 *  - allow-listed scan types only; passive types by default, active types (port sweep, vuln
 *    probes) only with SCANNER_ALLOW_ACTIVE=true (`scanner_active`);
 *  - the target is validated by the SSRF guard (public addresses only) and the backend receives the
 *    pinned IP we validated, so a DNS answer cannot change between check and scan;
 *  - the key travels in the Authorization header, never in the URL.
 * Owner: panels-recon. Server-only.
 */
import 'server-only';
import net from 'node:net';
import { hasCapability } from '@/lib/capabilities';
import { HttpError, httpJson } from '@/lib/http';
import { validateHost, type Resolver } from '@/lib/ssrf';

export interface ScanType {
  endpoint: string;
  timeoutMs: number;
  active: boolean;
  label: string;
}

/** OSIRIS's nine allow-listed types; `quick` and `vuln` send packets to the target (active). */
export const SCAN_TYPES: Record<string, ScanType> = {
  ssl: { endpoint: '/scan/ssl', timeoutMs: 10_000, active: false, label: 'TLS certificate & protocols' },
  headers: { endpoint: '/scan/headers', timeoutMs: 10_000, active: false, label: 'HTTP headers' },
  rdns: { endpoint: '/scan/rdns', timeoutMs: 8_000, active: false, label: 'Reverse DNS' },
  subdomains: { endpoint: '/scan/subdomains', timeoutMs: 15_000, active: false, label: 'Subdomains (passive sources)' },
  tech: { endpoint: '/scan/tech', timeoutMs: 15_000, active: false, label: 'Web technology fingerprint' },
  whois: { endpoint: '/scan/whois', timeoutMs: 10_000, active: false, label: 'WHOIS' },
  geoloc: { endpoint: '/scan/geoloc', timeoutMs: 8_000, active: false, label: 'Geolocation' },
  quick: { endpoint: '/scan/quick', timeoutMs: 15_000, active: true, label: 'Top-ports sweep (active)' },
  vuln: { endpoint: '/scan/vuln', timeoutMs: 90_000, active: true, label: 'Vulnerability probes (active)' },
};

export type ScannerDecision =
  | { ok: false; status: number; error: string; detail: string; available?: string[] }
  | { ok: true; type: ScanType; host: string; ip: string };

export function availableScans(env: Record<string, string | undefined> = process.env): string[] {
  const active = hasCapability('scanner_active', env);
  return Object.entries(SCAN_TYPES)
    .filter(([, t]) => active || !t.active)
    .map(([k]) => k);
}

/** Decide whether a scan may run, and pin the target IP. No network except the guarded DNS lookup. */
export async function planScan(type: string, target: string, env: Record<string, string | undefined> = process.env, resolve?: Resolver): Promise<ScannerDecision> {
  if (!hasCapability('scanner', env)) {
    return { ok: false, status: 503, error: 'not_configured', detail: 'No scanner backend is configured on this server (SCANNER_URL and SCANNER_KEY).' };
  }
  const t = SCAN_TYPES[type];
  if (!t) return { ok: false, status: 400, error: 'invalid_request', detail: `Unknown scan type "${type}".`, available: availableScans(env) };
  if (t.active && !hasCapability('scanner_active', env)) {
    return { ok: false, status: 403, error: 'active_scan_disabled', detail: `"${type}" sends packets to the target; the operator has not enabled active scans (SCANNER_ALLOW_ACTIVE).`, available: availableScans(env) };
  }
  const host = target.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || /[\s/@:?#]/.test(host) && !net.isIPv6(host)) return { ok: false, status: 400, error: 'invalid_request', detail: 'Enter a bare hostname or IP address.' };
  const check = await validateHost(host, resolve);
  if (!check.ok) return { ok: false, status: 400, error: 'blocked_target', detail: `Target refused by the SSRF guard: ${check.reason}.` };
  return { ok: true, type: t, host, ip: check.addresses[0]! };
}

/** Call the operator's backend with the pinned IP; the key goes in the Authorization header. */
export async function runScan(plan: Extract<ScannerDecision, { ok: true }>, env: Record<string, string | undefined> = process.env): Promise<{ data: Record<string, unknown>; ms: number }> {
  const base = env.SCANNER_URL!.replace(/\/$/, '');
  const u = new URL(`${base}${plan.type.endpoint}`);
  u.searchParams.set('target', plan.ip);
  u.searchParams.set('host', plan.host);
  const res = await httpJson<Record<string, unknown>>(u, {
    timeoutMs: plan.type.timeoutMs,
    retries: 0,
    maxRedirects: 0,
    maxBytes: 2 * 1024 * 1024,
    headers: { authorization: `Bearer ${env.SCANNER_KEY}` },
  });
  if (!res.data || typeof res.data !== 'object') throw new HttpError('Scanner returned no JSON object', 'parse', u.origin);
  return { data: res.data, ms: res.ms };
}
