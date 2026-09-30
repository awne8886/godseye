/**
 * Passive OSINT adapters behind /api/osint/* (infrastructure only, §0.7). Each returns the
 * OsintResponse pieces (data, transparent findings, per-provider status); routes wrap them.
 * Upstreams (probed 2026-09-30, docs/data-sources/panels-recon.md): dns.google DoH, rdap.org,
 * crt.sh (slow/flaky: 20 s timeout + 1 retry), ipwho.is, freeipapi (v1 path), ip-api (nc),
 * RIPEstat, Shodan InternetDB (nc), maclookup.app, MITRE CVE Services, CIRCL, NVD 2.0, the Tor
 * bulk exit list, Feodo Tracker (nc), ThreatFox/URLhaus (Auth-Key since 2026), OTX (key),
 * mempool.space, Blockscout, Solana RPC, xposedornot (domain breaches only).
 * Suspected-malicious domains are never resolved by this server: DNS answers come from DoH only
 * for the record type requested, and threat lookups send the indicator to the intel APIs only.
 * Owner: panels-recon. Server-only.
 */
import 'server-only';
import { hasCapability } from '@/lib/capabilities';
import { normalizeUtc } from '@/lib/freshness';
import { HttpError, httpJson, httpText } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import type { Providers } from '@/lib/types';
import { probe, skipped, type Finding } from './lookup';
import { ipwhoBucket } from './geo';
import { mergeStatus, ripe } from './ripe';
import type { Chain } from './targets';

export interface ToolResult {
  data: Record<string, unknown>;
  findings: Finding[];
  providers: Providers;
}

const HOUR = 3600_000;
const f = (level: Finding['level'], label: string, detail: string): Finding => ({ level, label, detail });

// ── DNS (dns.google DoH) ────────────────────────────────────────────────────────
export const DNS_TYPES = ['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME', 'SOA', 'CAA'] as const;
export type DnsType = (typeof DNS_TYPES)[number];
const DEFAULT_DNS_TYPES: DnsType[] = ['A', 'AAAA', 'MX', 'NS', 'TXT', 'CAA'];
const dohBucket = () => providerBucket('dns.google', 10, 10);

interface DohAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}
interface DohBody {
  Status: number;
  Answer?: DohAnswer[];
}

async function doh(name: string, type: string): Promise<DohBody> {
  const u = new URL('https://dns.google/resolve');
  u.searchParams.set('name', name);
  u.searchParams.set('type', type);
  const { data } = await httpJson<DohBody>(u, { timeoutMs: 6000, retries: 1, limiter: dohBucket() });
  if (!data || typeof data.Status !== 'number') throw new HttpError('Unexpected DoH body', 'parse', u.toString());
  return data;
}

const RCODE: Record<number, string> = { 0: 'NOERROR', 1: 'FORMERR', 2: 'SERVFAIL', 3: 'NXDOMAIN', 5: 'REFUSED' };

export async function dnsLookup(domain: string, type?: DnsType): Promise<ToolResult> {
  const types = type ? [type] : DEFAULT_DNS_TYPES;
  const p = await probe(
    `dns:${domain}:${types.join(',')}`,
    5 * 60_000,
    async () => {
      const out: Record<string, { name: string; ttl: number; data: string }[]> = {};
      const answers = await Promise.all(types.map((t) => doh(domain, t)));
      types.forEach((t, i) => {
        out[t] = (answers[i]!.Answer ?? []).map((a) => ({ name: a.name, ttl: a.TTL, data: a.data }));
      });
      const dmarc = type ? null : await doh(`_dmarc.${domain}`, 'TXT').catch(() => null);
      return { rcode: RCODE[answers[0]!.Status] ?? String(answers[0]!.Status), records: out, dmarc: dmarc?.Answer?.map((a) => a.data) ?? null };
    },
    { count: (v) => Object.values(v.records).reduce((n, r) => n + r.length, 0), allowEmpty: true },
  );
  const findings: Finding[] = [];
  const v = p.value;
  if (v) {
    if (v.rcode === 'NXDOMAIN') findings.push(f('info', 'Domain does not exist', 'The resolver answered NXDOMAIN.'));
    if (!type && v.rcode === 'NOERROR') {
      const txt = v.records.TXT ?? [];
      if (!txt.some((r) => /v=spf1/i.test(r.data))) findings.push(f('low', 'No SPF record', 'No TXT record starting with v=spf1: anyone can claim to send mail for this domain.'));
      if (!(v.dmarc ?? []).some((r) => /v=DMARC1/i.test(r))) findings.push(f('low', 'No DMARC policy', `No v=DMARC1 TXT record at _dmarc.${domain}.`));
      if (!(v.records.CAA ?? []).length) findings.push(f('info', 'No CAA record', 'Any certificate authority may issue certificates for this domain.'));
    }
  }
  return { data: v ? { domain, ...v } : { domain }, findings, providers: { 'dns.google': p.status } };
}

// ── RDAP (rdap.org → registry) ──────────────────────────────────────────────────
interface RdapEntity {
  roles?: string[];
  vcardArray?: [string, [string, Record<string, unknown>, string, unknown][]];
  publicIds?: { type: string; identifier: string }[];
}
interface RdapBody {
  ldhName?: string;
  handle?: string;
  status?: string[];
  events?: { eventAction: string; eventDate: string }[];
  nameservers?: { ldhName?: string }[];
  secureDNS?: { delegationSigned?: boolean };
  entities?: RdapEntity[];
}

const vcardName = (e: RdapEntity) => {
  const fn = e.vcardArray?.[1]?.find((x) => x[0] === 'fn');
  return typeof fn?.[3] === 'string' ? fn[3] : null;
};

export function normalizeRdap(b: RdapBody) {
  const ev = (a: string) => normalizeUtc(b.events?.find((e) => e.eventAction === a)?.eventDate ?? null);
  const registrar = b.entities?.find((e) => e.roles?.includes('registrar'));
  return {
    domain: b.ldhName?.toLowerCase() ?? null,
    handle: b.handle ?? null,
    registrar: registrar ? vcardName(registrar) : null,
    registrarIanaId: registrar?.publicIds?.find((p) => /iana/i.test(p.type))?.identifier ?? null,
    status: b.status ?? [],
    registered: ev('registration'),
    expires: ev('expiration'),
    updated: ev('last changed'),
    nameservers: (b.nameservers ?? []).map((n) => n.ldhName?.toLowerCase()).filter(Boolean),
    dnssec: b.secureDNS?.delegationSigned ?? null,
  };
}

export async function whoisLookup(domain: string, now = Date.now()): Promise<ToolResult> {
  const p = await probe(`rdap:${domain}`, HOUR, async () => {
    const { data } = await httpJson<RdapBody>(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      timeoutMs: 10_000,
      retries: 1,
      maxRedirects: 3,
      headers: { accept: 'application/rdap+json, application/json' },
      limiter: providerBucket('rdap.org', 2, 2),
    });
    if (!data) throw new HttpError('Empty RDAP body', 'parse', 'https://rdap.org/');
    return normalizeRdap(data);
  });
  const findings: Finding[] = [];
  const d = p.value;
  if (d) {
    if (d.expires) {
      const days = Math.floor((Date.parse(d.expires) - now) / 86_400_000);
      if (days < 0) findings.push(f('high', 'Registration expired', `Expired ${-days} days ago (${d.expires}).`));
      else if (days < 30) findings.push(f('medium', 'Expires soon', `Registration expires in ${days} days (${d.expires}).`));
    }
    if (d.dnssec === false) findings.push(f('info', 'DNSSEC not signed', 'The registry reports delegationSigned = false.'));
    if (!d.status.some((s) => /transfer prohibited/i.test(s))) findings.push(f('low', 'No transfer lock', 'No clientTransferProhibited/serverTransferProhibited status.'));
  }
  return { data: d ?? { domain }, findings, providers: { 'rdap.org': p.status } };
}

// ── Certificate transparency (crt.sh) ───────────────────────────────────────────
interface CrtRow {
  id: number;
  issuer_name: string;
  common_name: string;
  name_value: string;
  not_before: string;
  not_after: string;
}

/** crt.sh is slow and flaky (404/13 s seen): 20 s per attempt, one retry, 45 s overall. */
export const CRTSH_HTTP = { timeoutMs: 20_000, retries: 1, deadlineMs: 45_000, maxBytes: 20 * 1024 * 1024 } as const;

export function summarizeCerts(domain: string, rows: CrtRow[], now = Date.now()) {
  const names = new Set<string>();
  const issuers = new Map<string, number>();
  for (const r of rows) {
    for (const n of r.name_value.split('\n')) {
      const name = n.trim().toLowerCase().replace(/^\*\./, '');
      if (name === domain || name.endsWith(`.${domain}`)) names.add(name);
    }
    const issuer = r.issuer_name.match(/O=([^,]+)/)?.[1]?.trim() ?? r.issuer_name;
    issuers.set(issuer, (issuers.get(issuer) ?? 0) + 1);
  }
  const certs = rows
    .map((r) => ({ id: r.id, commonName: r.common_name, issuer: r.issuer_name, notBefore: normalizeUtc(r.not_before), notAfter: normalizeUtc(r.not_after) }))
    .sort((a, b) => (b.notBefore ?? '').localeCompare(a.notBefore ?? ''));
  const expiringSoon = certs.filter((c) => c.notAfter && Date.parse(c.notAfter) > now && Date.parse(c.notAfter) - now < 14 * 86_400_000).length;
  return {
    domain,
    certificates: rows.length,
    subdomains: [...names].sort().slice(0, 500),
    subdomainCount: names.size,
    issuers: [...issuers].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count })),
    recent: certs.slice(0, 25),
    expiringSoon,
  };
}

export async function certsLookup(domain: string): Promise<ToolResult> {
  const p = await probe(
    `crtsh:${domain}`,
    HOUR,
    async () => {
      const u = new URL('https://crt.sh/');
      u.searchParams.set('q', `%.${domain}`);
      u.searchParams.set('output', 'json');
      u.searchParams.set('exclude', 'expired');
      const { data } = await httpJson<CrtRow[]>(u, { ...CRTSH_HTTP, limiter: providerBucket('crt.sh', 0.5, 1) });
      if (!Array.isArray(data)) throw new HttpError('crt.sh did not return a JSON array', 'parse', u.toString());
      return summarizeCerts(domain, data);
    },
    { count: (v) => v.certificates, allowEmpty: true },
  );
  const findings: Finding[] = [];
  if (p.value) {
    findings.push(f('info', `${p.value.subdomainCount} names in CT logs`, 'Unexpired certificates logged for this domain and its subdomains.'));
    if (p.value.expiringSoon) findings.push(f('low', 'Certificates expiring', `${p.value.expiringSoon} logged certificates expire within 14 days.`));
  }
  return { data: p.value ?? { domain }, findings, providers: { 'crt.sh': p.status } };
}

// ── IP intelligence ─────────────────────────────────────────────────────────────
interface IpwhoFull {
  success?: boolean;
  message?: string;
  type?: string;
  country?: string;
  country_code?: string;
  region?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  connection?: { asn?: number; org?: string; isp?: string; domain?: string };
  timezone?: { id?: string };
}
interface FreeIpApiFull {
  countryName?: string;
  countryCode?: string;
  regionName?: string;
  cityName?: string;
  latitude?: number;
  longitude?: number;
  asn?: string;
  asnOrganization?: string;
  isProxy?: boolean;
}
interface IpApiBody {
  status?: string;
  message?: string;
  country?: string;
  countryCode?: string;
  regionName?: string;
  city?: string;
  lat?: number;
  lon?: number;
  isp?: string;
  org?: string;
  as?: string;
  proxy?: boolean;
  hosting?: boolean;
  mobile?: boolean;
}
interface NetworkInfo {
  asns?: string[];
  prefix?: string;
}

/** OFAC comprehensive (country-wide) sanctions programmes. Territorial programmes are noted by name. */
export const OFAC_COMPREHENSIVE: Record<string, string> = { CU: 'Cuba', IR: 'Iran', KP: 'North Korea', SY: 'Syria' };

export interface IpGeo {
  country: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  asn: number | null;
  org: string | null;
  isp: string | null;
}

export function fromIpwho(d: IpwhoFull): IpGeo {
  if (d.success === false) throw new HttpError(d.message ?? 'ipwho.is refused the lookup', 'http', 'https://ipwho.is/');
  return {
    country: d.country ?? null,
    countryCode: d.country_code ?? null,
    region: d.region ?? null,
    city: d.city ?? null,
    lat: d.latitude ?? null,
    lng: d.longitude ?? null,
    asn: d.connection?.asn ?? null,
    org: d.connection?.org ?? null,
    isp: d.connection?.isp ?? null,
  };
}

export function fromFreeIpApi(d: FreeIpApiFull): IpGeo {
  return {
    country: d.countryName ?? null,
    countryCode: d.countryCode ?? null,
    region: d.regionName ?? null,
    city: d.cityName ?? null,
    lat: d.latitude ?? null,
    lng: d.longitude ?? null,
    asn: d.asn ? Number(d.asn) || null : null,
    org: d.asnOrganization ?? null,
    isp: null,
  };
}

const ipapiBucket = () => providerBucket('ip-api.com', 0.75, 2); // 45/min documented

export async function ipLookup(ip: string): Promise<ToolResult> {
  const providers: Providers = {};
  const findings: Finding[] = [];
  const geoA = await probe(`ipwho:${ip}`, HOUR, async () => fromIpwho((await httpJson<IpwhoFull>(`https://ipwho.is/${ip}`, { timeoutMs: 6000, retries: 0, limiter: ipwhoBucket() })).data ?? {}));
  providers['ipwho.is'] = geoA.status;
  let geo = geoA.value;
  if (!geo) {
    const geoB = await probe(`freeipapi:${ip}`, HOUR, async () =>
      fromFreeIpApi((await httpJson<FreeIpApiFull>(`https://free.freeipapi.com/api/v1/json/${ip}`, { timeoutMs: 6000, retries: 0, limiter: providerBucket('free.freeipapi.com', 1, 1) })).data ?? {}),
    );
    providers.freeipapi = geoB.status;
    geo = geoB.value;
  }
  let flags: { proxy: boolean | null; hosting: boolean | null; mobile: boolean | null } | null = null;
  if (hasCapability('nc_sources')) {
    // ip-api's free endpoint is HTTP-only and non-commercial: behind nc_sources.
    const a = await probe(`ipapi:${ip}`, HOUR, async () => {
      const { data } = await httpJson<IpApiBody>(`http://ip-api.com/json/${ip}?fields=status,message,country,countryCode,regionName,city,lat,lon,isp,org,as,proxy,hosting,mobile`, {
        timeoutMs: 6000,
        retries: 0,
        limiter: ipapiBucket(),
      });
      if (!data || data.status !== 'success') throw new HttpError(data?.message ?? 'ip-api failure', 'http', 'http://ip-api.com/');
      return data;
    });
    providers['ip-api'] = a.status;
    if (a.value) flags = { proxy: a.value.proxy ?? null, hosting: a.value.hosting ?? null, mobile: a.value.mobile ?? null };
  } else providers['ip-api'] = skipped('licence');
  const net = await ripe<NetworkInfo>('network-info', ip, (d) => (d.prefix ? 1 : 0));
  providers.ripestat = net.status;
  if (flags?.hosting) findings.push(f('info', 'Hosting / data-centre address', 'ip-api flags this address as hosting.'));
  if (flags?.proxy) findings.push(f('low', 'Proxy / VPN / Tor', 'ip-api flags this address as a proxy, VPN or Tor exit.'));
  const cc = geo?.countryCode?.toUpperCase();
  if (cc && OFAC_COMPREHENSIVE[cc]) {
    findings.push(f('medium', 'OFAC comprehensive sanctions country', `Geolocated to ${OFAC_COMPREHENSIVE[cc]}, subject to a country-wide US sanctions programme. Geolocation can be wrong.`));
  }
  return {
    data: { ip, ...(geo ?? {}), prefix: net.value?.prefix ?? null, originAsns: net.value?.asns?.map(Number) ?? [], flags },
    findings,
    providers,
  };
}

// ── BGP / ASN (RIPEstat) ────────────────────────────────────────────────────────
interface AsOverview {
  holder?: string;
  announced?: boolean;
  block?: { resource?: string; desc?: string; name?: string };
}
interface AnnouncedPrefixes {
  prefixes?: { prefix: string }[];
}
interface Neighbours {
  neighbour_counts?: { left?: number; right?: number; uncertain?: number };
  neighbours?: { asn: number; type: string; power: number }[];
}

export async function bgpLookup(query: { asn: number } | { ip: string }): Promise<ToolResult> {
  let asn: number | null = 'asn' in query ? query.asn : null;
  const parts = [];
  let prefix: string | null = null;
  if ('ip' in query) {
    const net = await ripe<NetworkInfo>('network-info', query.ip, (d) => (d.prefix ? 1 : 0));
    parts.push(net.status);
    prefix = net.value?.prefix ?? null;
    asn = net.value?.asns?.[0] ? Number(net.value.asns[0]) : null;
  }
  const data: Record<string, unknown> = { query: 'asn' in query ? `AS${query.asn}` : query.ip, prefix, asn };
  if (asn) {
    const [ov, pf, nb] = await Promise.all([
      ripe<AsOverview>('as-overview', `AS${asn}`, (d) => (d.holder ? 1 : 0)),
      ripe<AnnouncedPrefixes>('announced-prefixes', `AS${asn}`, (d) => d.prefixes?.length ?? 0),
      ripe<Neighbours>('asn-neighbours', `AS${asn}`, (d) => d.neighbours?.length ?? 0),
    ]);
    parts.push(ov.status, pf.status, nb.status);
    const prefixes = pf.value?.prefixes?.map((p) => p.prefix) ?? [];
    Object.assign(data, {
      holder: ov.value?.holder ?? null,
      announced: ov.value?.announced ?? null,
      prefixCount: pf.value ? prefixes.length : null,
      prefixesV4: prefixes.filter((p) => !p.includes(':')).slice(0, 50),
      prefixesV6: prefixes.filter((p) => p.includes(':')).slice(0, 50),
      upstreams: nb.value?.neighbours?.filter((n) => n.type === 'left').sort((a, b) => b.power - a.power).slice(0, 15).map((n) => n.asn) ?? [],
      downstreams: nb.value?.neighbours?.filter((n) => n.type === 'right').sort((a, b) => b.power - a.power).slice(0, 15).map((n) => n.asn) ?? [],
      neighbourCounts: nb.value?.neighbour_counts ?? null,
    });
  }
  const findings: Finding[] = [];
  if (data.announced === false) findings.push(f('info', 'Not announced', `AS${asn} originates no prefixes in the current RIS view.`));
  return { data, findings, providers: { ripestat: mergeStatus(parts) } };
}

// ── Shodan InternetDB (non-commercial) ──────────────────────────────────────────
export interface InternetDbHost {
  ip: string;
  ports: number[];
  cpes: string[];
  hostnames: string[];
  tags: string[];
  vulns: string[];
}
const internetdbBucket = () => providerBucket('internetdb.shodan.io', 2, 4);

/** 404 `{"detail":"No information available"}` is a truthful "nothing indexed" answer → null. */
export async function internetdb(ip: string): Promise<InternetDbHost | null> {
  try {
    const { data } = await httpJson<InternetDbHost>(`https://internetdb.shodan.io/${ip}`, { timeoutMs: 8000, retries: 1, limiter: internetdbBucket() });
    return data ?? null;
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  }
}

export async function shodanLookup(ip: string): Promise<ToolResult> {
  if (!hasCapability('nc_sources')) return { data: { ip }, findings: [], providers: { internetdb: skipped('licence') } };
  const p = await probe(`internetdb:${ip}`, HOUR, () => internetdb(ip), { count: (h) => (h ? 1 : 0), allowEmpty: true });
  const h = p.value;
  const findings: Finding[] = [];
  if (p.status.ok && !h) findings.push(f('info', 'Not indexed', 'InternetDB has no scan data for this address.'));
  if (h?.vulns.length) findings.push(f('high', `${h.vulns.length} known CVEs`, `Matched by service banner/CPE: ${h.vulns.slice(0, 8).join(', ')}${h.vulns.length > 8 ? '…' : ''}. Unverified — banner matches can be false positives.`));
  if (h?.ports.length) findings.push(f('info', `${h.ports.length} open ports`, `Seen by Shodan: ${h.ports.join(', ')}.`));
  return { data: { ip, indexed: Boolean(h), ...(h ?? {}) }, findings, providers: { internetdb: p.status } };
}

// ── Passive sweep of a small prefix ─────────────────────────────────────────────
/** Addresses in `ip/cidr` (cidr 28–32, i.e. ≤ 16 addresses). */
export function prefixAddresses(ip: string, cidr: number): string[] {
  const n = ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
  const size = 2 ** (32 - cidr);
  const base = (n & ~(size - 1)) >>> 0;
  return Array.from({ length: size }, (_, i) => {
    const v = base + i;
    return [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join('.');
  });
}

export async function sweepLookup(ip: string, cidr: number): Promise<ToolResult> {
  const addrs = prefixAddresses(ip, cidr);
  const prefix = `${addrs[0]}/${cidr}`;
  const providers: Providers = {};
  const findings: Finding[] = [];
  if (!hasCapability('nc_sources')) {
    providers.internetdb = skipped('licence');
    const owner = await probe(`ipwho:${addrs[0]}`, HOUR, async () => fromIpwho((await httpJson<IpwhoFull>(`https://ipwho.is/${addrs[0]}`, { timeoutMs: 6000, retries: 0, limiter: ipwhoBucket() })).data ?? {}));
    providers['ipwho.is'] = owner.status;
    return { data: { prefix, scanned: 0, owner: owner.value, hosts: [] }, findings, providers };
  }
  const t0 = Date.now();
  const results = await Promise.all(addrs.map((a) => probe(`internetdb:${a}`, HOUR, () => internetdb(a), { count: (h) => (h ? 1 : 0), allowEmpty: true })));
  const hosts = results.map((r) => r.value).filter((h): h is InternetDbHost => h !== null);
  const answered = results.filter((r) => r.status.ok).length;
  const failed = results.find((r) => !r.status.ok);
  providers.internetdb = {
    ok: answered > 0,
    count: hosts.length,
    ms: Date.now() - t0,
    age_s: answered ? Math.max(...results.map((r) => r.status.age_s ?? 0)) : null,
    ...(answered === 0 && failed?.status.error ? { error: failed.status.error } : {}),
  };
  const vulnHosts = hosts.filter((h) => h.vulns.length);
  if (vulnHosts.length) findings.push(f('high', `${vulnHosts.length} hosts with known CVEs`, vulnHosts.map((h) => `${h.ip}: ${h.vulns.length}`).join(', ')));
  if (answered < addrs.length) findings.push(f('info', 'Partial sweep', `${addrs.length - answered} of ${addrs.length} lookups failed; results are incomplete.`));
  return { data: { prefix, scanned: answered, total: addrs.length, hosts }, findings, providers };
}

// ── MAC vendor ──────────────────────────────────────────────────────────────────
interface MacBody {
  success?: boolean;
  found?: boolean;
  macPrefix?: string;
  company?: string;
  address?: string;
  country?: string;
  blockType?: string;
  updated?: string;
  isRand?: boolean;
  isPrivate?: boolean;
}

export async function macLookup(mac: string): Promise<ToolResult> {
  const p = await probe(`mac:${mac.slice(0, 9)}`, 24 * HOUR, async () => {
    const { data } = await httpJson<MacBody>(`https://api.maclookup.app/v2/macs/${mac}`, { timeoutMs: 6000, retries: 1, limiter: providerBucket('api.maclookup.app', 2, 2) });
    if (!data || data.success === false) throw new HttpError('maclookup refused the lookup', 'http', 'https://api.maclookup.app/');
    return data;
  }, { allowEmpty: true, count: (d) => (d.found ? 1 : 0) });
  const d = p.value;
  const findings: Finding[] = [];
  if (d?.isRand) findings.push(f('info', 'Randomised address', 'Locally administered (random) MAC: no vendor can be attributed.'));
  if (d && !d.found && !d.isRand) findings.push(f('info', 'Unknown prefix', 'Not in the IEEE registry snapshot used by maclookup.app.'));
  return {
    data: { mac, found: d?.found ?? null, prefix: d?.macPrefix ?? null, vendor: d?.company || null, country: d?.country || null, blockType: d?.blockType || null, randomised: d?.isRand ?? null, updated: d?.updated ?? null },
    findings,
    providers: { maclookup: p.status },
  };
}

// ── CVE (MITRE, CIRCL, NVD + KEV) ───────────────────────────────────────────────
interface CveRecord5 {
  cveMetadata?: { cveId?: string; state?: string; datePublished?: string; dateUpdated?: string };
  containers?: {
    cna?: {
      title?: string;
      descriptions?: { lang: string; value: string }[];
      metrics?: Record<string, { baseScore?: number; baseSeverity?: string; vectorString?: string; version?: string }>[];
      problemTypes?: { descriptions?: { cweId?: string; description?: string }[] }[];
      affected?: { vendor?: string; product?: string }[];
      references?: { url: string }[];
    };
  };
}
interface NvdBody {
  vulnerabilities?: {
    cve: {
      id: string;
      published?: string;
      lastModified?: string;
      descriptions?: { lang: string; value: string }[];
      metrics?: Record<string, { cvssData?: { baseScore?: number; baseSeverity?: string; vectorString?: string; version?: string }; baseSeverity?: string }[]>;
      cisaExploitAdd?: string;
      cisaActionDue?: string;
      cisaRequiredAction?: string;
      cisaVulnerabilityName?: string;
      weaknesses?: { description?: { value: string }[] }[];
      references?: { url: string }[];
    };
  }[];
}

export interface CveSummary {
  id: string;
  title: string | null;
  description: string | null;
  state: string | null;
  published: string | null;
  updated: string | null;
  cvss: { score: number; severity: string; vector: string | null; version: string | null } | null;
  cwe: string[];
  affected: { vendor: string; product: string }[];
  references: string[];
}

export function fromCve5(r: CveRecord5): CveSummary | null {
  const id = r.cveMetadata?.cveId;
  if (!id) return null;
  const cna = r.containers?.cna ?? {};
  let cvss: CveSummary['cvss'] = null;
  for (const m of cna.metrics ?? []) {
    for (const [k, v] of Object.entries(m)) {
      if (!k.startsWith('cvss') || typeof v?.baseScore !== 'number') continue;
      if (!cvss || (v.version ?? '') > (cvss.version ?? '')) cvss = { score: v.baseScore, severity: v.baseSeverity ?? '', vector: v.vectorString ?? null, version: v.version ?? null };
    }
  }
  return {
    id,
    title: cna.title ?? null,
    description: cna.descriptions?.find((d) => d.lang.startsWith('en'))?.value ?? null,
    state: r.cveMetadata?.state ?? null,
    published: normalizeUtc(r.cveMetadata?.datePublished ?? null),
    updated: normalizeUtc(r.cveMetadata?.dateUpdated ?? null),
    cvss,
    cwe: (cna.problemTypes ?? []).flatMap((p) => p.descriptions ?? []).map((d) => d.cweId).filter((x): x is string => Boolean(x)),
    affected: (cna.affected ?? []).slice(0, 10).map((a) => ({ vendor: a.vendor ?? '', product: a.product ?? '' })),
    references: (cna.references ?? []).slice(0, 15).map((x) => x.url),
  };
}

export function fromNvd(b: NvdBody) {
  const c = b.vulnerabilities?.[0]?.cve;
  if (!c) return null;
  let cvss: CveSummary['cvss'] = null;
  for (const key of ['cvssMetricV40', 'cvssMetricV31', 'cvssMetricV30', 'cvssMetricV2']) {
    const m = c.metrics?.[key]?.[0];
    if (m?.cvssData?.baseScore !== undefined) {
      cvss = { score: m.cvssData.baseScore, severity: m.cvssData.baseSeverity ?? m.baseSeverity ?? '', vector: m.cvssData.vectorString ?? null, version: m.cvssData.version ?? null };
      break;
    }
  }
  return {
    id: c.id,
    description: c.descriptions?.find((d) => d.lang === 'en')?.value ?? null,
    published: normalizeUtc(c.published ?? null),
    updated: normalizeUtc(c.lastModified ?? null),
    cvss,
    cwe: (c.weaknesses ?? []).flatMap((w) => w.description ?? []).map((d) => d.value).filter((v) => /^CWE-/.test(v)),
    kev: c.cisaExploitAdd ? { dateAdded: c.cisaExploitAdd, dueDate: c.cisaActionDue ?? null, action: c.cisaRequiredAction ?? null, name: c.cisaVulnerabilityName ?? null } : null,
    references: (c.references ?? []).slice(0, 15).map((r) => r.url),
  };
}

/** NVD keyless: 5 requests / 30 s; with NVD_API_KEY (sent as the `apiKey` header): 50 / 30 s. */
const nvdBucket = () => (process.env.NVD_API_KEY ? providerBucket('nvd-keyed', 50 / 30, 5) : providerBucket('nvd', 5 / 30, 1));

const SEVERITY_LEVEL: Record<string, Finding['level']> = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low', NONE: 'info' };

export async function cveLookup(id: string): Promise<ToolResult> {
  const providers: Providers = {};
  const [mitre, nvd] = await Promise.all([
    probe(`cve:mitre:${id}`, HOUR, async () => {
      const s = fromCve5((await httpJson<CveRecord5>(`https://cveawg.mitre.org/api/cve/${id}`, { timeoutMs: 8000, retries: 1, limiter: providerBucket('cveawg.mitre.org', 2, 2) })).data ?? {});
      if (!s) throw new HttpError('No CVE record', 'parse', 'https://cveawg.mitre.org/');
      return s;
    }),
    probe(`cve:nvd:${id}`, HOUR, async () => {
      const key = process.env.NVD_API_KEY;
      const s = fromNvd(
        (await httpJson<NvdBody>(`https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${id}`, { timeoutMs: 10_000, retries: 0, limiter: nvdBucket(), headers: key ? { apiKey: key } : {} })).data ?? {},
      );
      if (!s) throw new HttpError('NVD has no record', 'parse', 'https://services.nvd.nist.gov/');
      return s;
    }),
  ]);
  providers.mitre = mitre.status;
  providers.nvd = nvd.status;
  let base = mitre.value;
  if (!base) {
    const circl = await probe(`cve:circl:${id}`, HOUR, async () => {
      const s = fromCve5((await httpJson<CveRecord5>(`https://cve.circl.lu/api/cve/${id}`, { timeoutMs: 8000, retries: 1, limiter: providerBucket('cve.circl.lu', 2, 2) })).data ?? {});
      if (!s) throw new HttpError('No CVE record', 'parse', 'https://cve.circl.lu/');
      return s;
    });
    providers.circl = circl.status;
    base = circl.value;
  }
  const n = nvd.value;
  const cvss = base?.cvss ?? n?.cvss ?? null;
  const findings: Finding[] = [];
  if (n?.kev) findings.push(f('critical', 'Known exploited (CISA KEV)', `Added to the KEV catalogue on ${n.kev.dateAdded}${n.kev.dueDate ? `; federal remediation due ${n.kev.dueDate}` : ''}.`));
  if (cvss) findings.push(f(SEVERITY_LEVEL[cvss.severity.toUpperCase()] ?? 'info', `CVSS ${cvss.version ?? ''} ${cvss.score}`.replace(/\s+/g, ' '), cvss.vector ?? cvss.severity));
  const data = base || n ? { ...(n ?? {}), ...(base ?? {}), id, cvss, kev: n?.kev ?? null, cwe: [...new Set([...(base?.cwe ?? []), ...(n?.cwe ?? [])])] } : { id };
  return { data, findings, providers };
}

// ── Threat intel ────────────────────────────────────────────────────────────────
const TOR_URL = 'https://check.torproject.org/torbulkexitlist';
const FEODO_URL = 'https://feodotracker.abuse.ch/downloads/ipblocklist.json';

export function parseTorList(text: string): Set<string> {
  return new Set(text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));
}

interface FeodoRow {
  ip_address: string;
  port: number;
  status: string;
  malware: string;
  first_seen?: string;
  last_online?: string;
  as_name?: string;
  country?: string;
}

export interface ThreatMatch {
  source: string;
  type: string;
  detail: string;
  malware: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
}

export async function threatsLookup(ioc: string, kind: string): Promise<ToolResult> {
  const providers: Providers = {};
  const matches: ThreatMatch[] = [];
  const isIp = kind === 'ipv4' || kind === 'ipv6';
  if (isIp) {
    const tor = await probe('tor-exits', 30 * 60_000, async () => [...parseTorList((await httpText(TOR_URL, { timeoutMs: 10_000, retries: 1, limiter: providerBucket('check.torproject.org', 0.2, 1) })).text ?? '')], {
      count: (l) => l.length,
    });
    providers.tor = { ...tor.status, count: tor.value?.includes(ioc) ? 1 : 0 };
    if (tor.value?.includes(ioc)) matches.push({ source: 'tor', type: 'tor_exit', detail: 'Listed in the Tor Project bulk exit list (exact match).', malware: null, firstSeen: null, lastSeen: null });
    if (hasCapability('nc_sources')) {
      const feodo = await probe('feodo-blocklist', 15 * 60_000, async () => (await httpJson<FeodoRow[]>(FEODO_URL, { timeoutMs: 10_000, retries: 1, limiter: providerBucket('feodotracker.abuse.ch', 0.2, 1) })).data ?? [], {
        count: (l) => l.length,
        allowEmpty: true,
      });
      const hits = (feodo.value ?? []).filter((r) => r.ip_address === ioc);
      providers.feodotracker = { ...feodo.status, count: hits.length };
      for (const h of hits) {
        matches.push({ source: 'feodotracker', type: 'botnet_c2', detail: `${h.malware} C2 on port ${h.port} (${h.status})`, malware: h.malware, firstSeen: normalizeUtc(h.first_seen ?? null), lastSeen: normalizeUtc(h.last_online ?? null) });
      }
    } else providers.feodotracker = skipped('licence');
  }
  const abuseKey = process.env.ABUSECH_AUTH_KEY;
  if (abuseKey && hasCapability('nc_sources')) {
    const tf = await probe(`threatfox:${ioc}`, 10 * 60_000, async () => {
      const { data } = await httpJson<{ query_status?: string; data?: { ioc: string; threat_type: string; malware_printable?: string; first_seen?: string; last_seen?: string | null; confidence_level?: number }[] | string }>(
        'https://threatfox-api.abuse.ch/api/v1/',
        { method: 'POST', body: JSON.stringify({ query: 'search_ioc', search_term: ioc }), headers: { 'content-type': 'application/json', 'Auth-Key': abuseKey }, timeoutMs: 8000, limiter: providerBucket('threatfox-api.abuse.ch', 1, 2) },
      );
      if (data?.query_status !== 'ok' && data?.query_status !== 'no_result') throw new HttpError(`ThreatFox ${data?.query_status ?? 'error'}`, 'http', 'threatfox');
      return Array.isArray(data.data) ? data.data : [];
    }, { count: (l) => l.length, allowEmpty: true });
    providers.threatfox = tf.status;
    for (const r of tf.value ?? []) matches.push({ source: 'threatfox', type: r.threat_type, detail: `${r.malware_printable ?? 'unknown'} (confidence ${r.confidence_level ?? '?'}%)`, malware: r.malware_printable ?? null, firstSeen: normalizeUtc(r.first_seen ?? null), lastSeen: normalizeUtc(r.last_seen ?? null) });
  } else providers.threatfox = skipped(abuseKey ? 'licence' : 'not-configured');
  const otxKey = process.env.OTX_KEY;
  if (otxKey && kind !== 'url') {
    const section = kind === 'ipv4' ? 'IPv4' : kind === 'ipv6' ? 'IPv6' : kind === 'domain' ? 'domain' : 'file';
    const otx = await probe(`otx:${ioc}`, 10 * 60_000, async () => {
      const { data } = await httpJson<{ pulse_info?: { count?: number; pulses?: { name: string; created?: string; modified?: string }[] } }>(
        `https://otx.alienvault.com/api/v1/indicators/${section}/${encodeURIComponent(ioc)}/general`,
        { headers: { 'X-OTX-API-KEY': otxKey }, timeoutMs: 8000, retries: 1, limiter: providerBucket('otx.alienvault.com', 1, 2) },
      );
      return data?.pulse_info?.pulses ?? [];
    }, { count: (l) => l.length, allowEmpty: true });
    providers.otx = otx.status;
    for (const p of (otx.value ?? []).slice(0, 10)) matches.push({ source: 'otx', type: 'pulse', detail: p.name, malware: null, firstSeen: normalizeUtc(p.created ?? null), lastSeen: normalizeUtc(p.modified ?? null) });
  } else providers.otx = skipped('not-configured');
  const findings: Finding[] = matches.map((m) => f(m.type === 'tor_exit' ? 'low' : 'high', `${m.source}: ${m.type}`, m.detail));
  if (!matches.length && Object.values(providers).some((p) => p.ok)) findings.push(f('info', 'No matches', 'No provider that answered lists this indicator. Absence from these lists is not proof of safety.'));
  return { data: { ioc, kind, matches }, findings, providers };
}

// ── Wallets (BTC / ETH / SOL) ───────────────────────────────────────────────────
interface MempoolAddr {
  chain_stats?: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number; funded_txo_count: number };
  mempool_stats?: { tx_count: number };
}
interface BlockscoutAddr {
  coin_balance?: string | null;
  is_contract?: boolean;
  is_scam?: boolean;
  reputation?: string;
  ens_domain_name?: string | null;
  public_tags?: { display_name?: string; label?: string }[];
  name?: string | null;
  exchange_rate?: string | null;
}

export async function cryptoLookup(address: string, chain: Chain): Promise<ToolResult> {
  const findings: Finding[] = [];
  if (chain === 'btc') {
    const p = await probe(`mempool:${address}`, 5 * 60_000, async () => (await httpJson<MempoolAddr>(`https://mempool.space/api/address/${address}`, { timeoutMs: 8000, retries: 1, limiter: providerBucket('mempool.space', 2, 2) })).data ?? {});
    const s = p.value?.chain_stats;
    const balanceSat = s ? s.funded_txo_sum - s.spent_txo_sum : null;
    if (s && s.tx_count > 1000) findings.push(f('info', 'High activity', `${s.tx_count} confirmed transactions: typical of exchanges, services or reused donation addresses.`));
    return {
      data: { address, chain, balance: balanceSat === null ? null : balanceSat / 1e8, unit: 'BTC', txCount: s?.tx_count ?? null, received: s ? s.funded_txo_sum / 1e8 : null, pendingTx: p.value?.mempool_stats?.tx_count ?? null },
      findings,
      providers: { 'mempool.space': p.status },
    };
  }
  if (chain === 'eth') {
    const p = await probe(`blockscout:${address.toLowerCase()}`, 5 * 60_000, async () => {
      const b = (await httpJson<BlockscoutAddr>(`https://eth.blockscout.com/api/v2/addresses/${address}`, { timeoutMs: 8000, retries: 1, limiter: providerBucket('eth.blockscout.com', 2, 2) })).data ?? {};
      const c = await httpJson<{ transactions_count?: string }>(`https://eth.blockscout.com/api/v2/addresses/${address}/counters`, { timeoutMs: 8000, retries: 0, limiter: providerBucket('eth.blockscout.com', 2, 2) }).catch(() => null);
      return { ...b, txCount: c?.data?.transactions_count ? Number(c.data.transactions_count) : null };
    });
    const b = p.value;
    if (b?.is_scam) findings.push(f('critical', 'Flagged as scam', 'Blockscout marks this address as a scam.'));
    if (b?.reputation && b.reputation !== 'ok') findings.push(f('medium', `Reputation: ${b.reputation}`, 'Blockscout reputation is not "ok".'));
    for (const t of b?.public_tags ?? []) findings.push(f('info', `Tag: ${t.display_name ?? t.label}`, 'Public address tag on Blockscout.'));
    if (b?.is_contract) findings.push(f('info', 'Smart contract', 'This address is a contract, not an externally owned account.'));
    return {
      data: { address, chain, balance: b?.coin_balance ? Number(b.coin_balance) / 1e18 : null, unit: 'ETH', txCount: b?.txCount ?? null, isContract: b?.is_contract ?? null, ens: b?.ens_domain_name ?? null, name: b?.name ?? null, tags: (b?.public_tags ?? []).map((t) => t.display_name ?? t.label) },
      findings,
      providers: { blockscout: p.status },
    };
  }
  const p = await probe(`solana:${address}`, 5 * 60_000, async () => {
    const { data } = await httpJson<{ result?: { value: number }; error?: { message: string } }>('https://api.mainnet-beta.solana.com', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] }),
      headers: { 'content-type': 'application/json' },
      timeoutMs: 8000,
      limiter: providerBucket('api.mainnet-beta.solana.com', 1, 2),
    });
    if (!data?.result) throw new HttpError(data?.error?.message ?? 'Solana RPC error', 'http', 'solana');
    return data.result.value;
  });
  return { data: { address, chain, balance: p.value === null ? null : p.value / 1e9, unit: 'SOL' }, findings, providers: { 'solana-rpc': p.status } };
}

// ── Domain breaches (xposedornot, organisation domains only) ────────────────────
interface XposedBreach {
  breachID: string;
  breachedDate?: string;
  domain?: string;
  industry?: string;
  passwordRisk?: string;
  verified?: boolean;
  exposedData?: string[];
  exposedRecords?: number;
}

export async function leaksLookup(domain: string): Promise<ToolResult> {
  const p = await probe(`xposed:${domain}`, 24 * HOUR, async () => {
    try {
      const { data } = await httpJson<{ status?: string; exposedBreaches?: XposedBreach[] | null }>(`https://api.xposedornot.com/v1/breaches?domain=${encodeURIComponent(domain)}`, {
        timeoutMs: 8000,
        retries: 1,
        limiter: providerBucket('api.xposedornot.com', 1, 2),
      });
      return data?.exposedBreaches ?? [];
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return [];
      throw e;
    }
  }, { count: (l) => l.length, allowEmpty: true });
  const breaches = (p.value ?? []).map((b) => ({
    name: b.breachID,
    date: normalizeUtc(b.breachedDate?.slice(0, 19) ?? null),
    records: b.exposedRecords ?? null,
    dataTypes: b.exposedData ?? [],
    industry: b.industry ?? null,
    passwordRisk: b.passwordRisk ?? null,
    verified: b.verified ?? null,
  }));
  const findings = breaches.map((b) => f(b.dataTypes.some((t) => /password/i.test(t)) ? 'high' : 'medium', `Breach: ${b.name}`, `${b.date?.slice(0, 10) ?? 'date unknown'} · ${b.records?.toLocaleString('en-US') ?? '?'} records · ${b.dataTypes.join(', ')}`));
  return { data: { domain, breaches }, findings, providers: { xposedornot: p.status } };
}
