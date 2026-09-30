/**
 * Input validation for RECON targets. Passive OSINT on infrastructure only (§0.7): domains, public
 * IPs, ASNs, CVE ids, MAC prefixes, wallet addresses. Personal identifiers (email addresses, phone
 * numbers, usernames) are refused with an explanation, never looked up.
 * Owner: panels-recon. Pure (no I/O) so the client can share it.
 */
import { z } from 'zod';

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const BLOCKED_SUFFIX = /(^|\.)(localhost|local|internal|localdomain|home\.arpa|lan|intranet|corp|test|invalid|example\.invalid|onion)$/;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export const PERSONAL_REFUSAL =
  'GODSEYE only runs passive lookups on infrastructure (domains, IPs, ASNs, CVEs, wallets). Email addresses, phone numbers and usernames are not looked up.';

/** True for input that identifies a person rather than infrastructure. */
export function looksPersonal(raw: string): boolean {
  const s = raw.trim();
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(s)) return true; // email
  if (/^\+\d[\d\s().-]{6,}$/.test(s) || /^\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}$/.test(s)) return true; // phone
  if (/^@[\w.]{2,}$/.test(s)) return true; // @handle
  return false;
}

/**
 * Normalise a domain name: lower-case, IDN → punycode (WHATWG IDNA), trailing dot removed.
 * Refuses URLs with credentials/ports/paths, IP literals, single labels and private suffixes.
 */
export function parseDomain(raw: string): { ok: true; domain: string } | { ok: false; reason: string } {
  const s = raw.trim();
  if (!s) return { ok: false, reason: 'domain is required' };
  if (looksPersonal(s)) return { ok: false, reason: PERSONAL_REFUSAL };
  if (/[\s/@:?#\\]/.test(s)) return { ok: false, reason: 'Enter a bare domain name (no scheme, credentials, port or path)' };
  let host: string;
  try {
    host = new URL(`http://${s}/`).hostname;
  } catch {
    return { ok: false, reason: 'Not a valid domain name' };
  }
  host = host.replace(/\.$/, '');
  if (IPV4.test(host) || host.startsWith('[')) return { ok: false, reason: 'Enter a domain name, not an IP address' };
  const labels = host.split('.');
  if (host.length > 253 || labels.length < 2 || !labels.every((l) => LABEL.test(l))) return { ok: false, reason: 'Not a valid domain name' };
  if (/^\d+$/.test(labels.at(-1)!)) return { ok: false, reason: 'Not a valid domain name' };
  if (BLOCKED_SUFFIX.test(host)) return { ok: false, reason: 'Private or reserved names cannot be looked up' };
  return { ok: true, domain: host };
}

/** zod helper: a domain query parameter, normalised. */
export const DomainParam = z.string().transform((v, ctx) => {
  const r = parseDomain(v);
  if (!r.ok) {
    ctx.addIssue({ code: 'custom', message: r.reason });
    return z.NEVER;
  }
  return r.domain;
});

export const CVE_RE = /^CVE-\d{4}-\d{4,7}$/;

/** `00:1A:2B`, `00-1a-2b-3c-4d-5e`, `001A2B` → upper-case hex OUI/MAC without separators (6–12 digits). */
export function parseMac(raw: string): string | null {
  const hex = raw.trim().replace(/[:.\-\s]/g, '').toUpperCase();
  return /^[0-9A-F]{6,12}$/.test(hex) ? hex : null;
}

export type Chain = 'btc' | 'eth' | 'sol';

/** Detect a wallet's chain from its format (no network). */
export function detectChain(addr: string): Chain | null {
  const a = addr.trim();
  if (/^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(a)) return 'btc';
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return 'eth';
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return 'sol';
  return null;
}

/** `AS15169`, `as15169`, `15169` → 15169. */
export function parseAsn(raw: string): number | null {
  const m = raw.trim().match(/^(?:AS)?(\d{1,10})$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n < 4_294_967_296 ? n : null;
}

export type IocKind = 'ipv4' | 'ipv6' | 'domain' | 'url' | 'md5' | 'sha1' | 'sha256';

export function iocKind(raw: string): IocKind | null {
  const s = raw.trim();
  if (IPV4.test(s)) return 'ipv4';
  if (/^[0-9a-f:]+$/i.test(s) && s.includes(':') && s.split(':').length > 2) return 'ipv6';
  if (/^[a-f0-9]{32}$/i.test(s)) return 'md5';
  if (/^[a-f0-9]{40}$/i.test(s)) return 'sha1';
  if (/^[a-f0-9]{64}$/i.test(s)) return 'sha256';
  if (/^https?:\/\//i.test(s)) return 'url';
  return parseDomain(s).ok ? 'domain' : null;
}
