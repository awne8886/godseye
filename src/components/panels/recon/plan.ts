/**
 * Which /api/osint/* lookups the RECON panel runs for a target, by the target's shape. Pure and
 * unit-tested. Person identifiers (email, phone, @handle) are refused, never looked up (§0.7).
 * Owner: panels-recon.
 */
import { CVE_RE, detectChain, iocKind, looksPersonal, parseAsn, parseDomain, parseMac, PERSONAL_REFUSAL } from './targets';

export type TargetKind = 'domain' | 'ip' | 'asn' | 'cve' | 'mac' | 'wallet' | 'url' | 'hash';

export interface Lookup {
  tool: string;
  label: string;
  path: string;
}

export type Plan = { ok: true; kind: TargetKind; target: string; lookups: Lookup[] } | { ok: false; reason: string };

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const enc = encodeURIComponent;

export function planLookups(raw: string): Plan {
  const s = raw.trim();
  if (!s) return { ok: false, reason: 'Enter a domain, IP, ASN, CVE id, MAC prefix, wallet address or URL.' };
  if (looksPersonal(s)) return { ok: false, reason: PERSONAL_REFUSAL };
  if (CVE_RE.test(s.toUpperCase())) return { ok: true, kind: 'cve', target: s.toUpperCase(), lookups: [{ tool: 'cve', label: 'CVE', path: `/api/osint/cve?id=${enc(s.toUpperCase())}` }] };
  if (IPV4.test(s) || (s.includes(':') && /^[0-9a-f:]+$/i.test(s) && s.split(':').length > 2 && !parseMac(s))) {
    return {
      ok: true,
      kind: 'ip',
      target: s,
      lookups: [
        { tool: 'ip', label: 'IP intel', path: `/api/osint/ip?ip=${enc(s)}` },
        { tool: 'bgp', label: 'BGP / ASN', path: `/api/osint/bgp?query=${enc(s)}` },
        { tool: 'shodan', label: 'InternetDB', path: `/api/osint/shodan?ip=${enc(s)}` },
        { tool: 'threats', label: 'Threat intel', path: `/api/osint/threats?ioc=${enc(s)}` },
      ],
    };
  }
  if (/^AS\d+$/i.test(s) && parseAsn(s)) return { ok: true, kind: 'asn', target: s.toUpperCase(), lookups: [{ tool: 'bgp', label: 'BGP / ASN', path: `/api/osint/bgp?query=${enc(s)}` }] };
  if (/^[0-9a-f]{2}([:-][0-9a-f]{2}){2,5}$/i.test(s)) return { ok: true, kind: 'mac', target: s, lookups: [{ tool: 'mac', label: 'MAC vendor', path: `/api/osint/mac?mac=${enc(s)}` }] };
  const chain = detectChain(s);
  if (chain && !parseDomain(s).ok) return { ok: true, kind: 'wallet', target: s, lookups: [{ tool: 'crypto', label: `Wallet (${chain.toUpperCase()})`, path: `/api/osint/crypto?address=${enc(s)}&chain=${chain}` }] };
  if (/^https?:\/\//i.test(s)) {
    return {
      ok: true,
      kind: 'url',
      target: s,
      lookups: [
        { tool: 'headers', label: 'Security headers', path: `/api/osint/headers?url=${enc(s)}` },
        { tool: 'threats', label: 'Threat intel', path: `/api/osint/threats?ioc=${enc(s)}` },
      ],
    };
  }
  const kind = iocKind(s);
  if (kind === 'md5' || kind === 'sha1' || kind === 'sha256') return { ok: true, kind: 'hash', target: s.toLowerCase(), lookups: [{ tool: 'threats', label: 'Threat intel', path: `/api/osint/threats?ioc=${enc(s)}` }] };
  const d = parseDomain(s);
  if (d.ok) {
    const q = enc(d.domain);
    return {
      ok: true,
      kind: 'domain',
      target: d.domain,
      lookups: [
        { tool: 'dns', label: 'DNS', path: `/api/osint/dns?domain=${q}` },
        { tool: 'whois', label: 'RDAP / WHOIS', path: `/api/osint/whois?domain=${q}` },
        { tool: 'certs', label: 'Certificates', path: `/api/osint/certs?domain=${q}` },
        { tool: 'headers', label: 'Security headers', path: `/api/osint/headers?url=${enc(`https://${d.domain}/`)}` },
        { tool: 'threats', label: 'Threat intel', path: `/api/osint/threats?ioc=${q}` },
        { tool: 'leaks', label: 'Domain breaches', path: `/api/osint/leaks?domain=${q}` },
      ],
    };
  }
  return { ok: false, reason: d.reason };
}
