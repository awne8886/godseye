/**
 * The one SSRF guard (§0.6) for every server-side fetch of a user-supplied host or URL.
 *  - Blocks loopback, RFC1918, CGNAT, link-local, multicast, reserved/documentation ranges,
 *    cloud metadata, `localhost`/`.local`/`.internal` names, non-canonical IPv4 literals
 *    (decimal/hex/octal/short forms), IPv6 loopback/ULA/link-local/site-local/multicast/NAT64
 *    and IPv4-mapped/compatible forms of blocked IPv4.
 *  - Resolves DNS and rejects if ANY answer is reserved — inside the socket's own lookup, so a
 *    DNS-rebinding answer cannot slip in between check and connect.
 *  - Re-validates every redirect hop.
 * Also: exact host + path-prefix allow-lists for proxy routes (tiles, camera stills, ArcGIS).
 * Owner: lead. Server-only.
 */
import dns from 'node:dns';
import net, { type LookupFunction } from 'node:net';
import { HttpError, httpRequest, type HttpOptions, type HttpResult } from './http';

// ── IPv4 ────────────────────────────────────────────────────────────────────────
const V4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
  ['255.255.255.255', 32],
];

/** Strict dotted-quad: four decimal octets 0–255 without leading zeros. */
export function isCanonicalIPv4(s: string): boolean {
  const parts = s.split('.');
  return parts.length === 4 && parts.every((p) => /^(0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255);
}

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

export function isReservedIPv4(ip: string): boolean {
  if (!isCanonicalIPv4(ip)) return true;
  const n = v4ToInt(ip);
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}

// ── IPv6 ────────────────────────────────────────────────────────────────────────
/** Expand an IPv6 literal to 8 groups of 16-bit numbers (handles `::` and embedded IPv4). */
export function expandIPv6(ip: string): number[] | null {
  let s = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (!net.isIPv6(s)) return null;
  // The WHATWG URL serialiser normalises IPv6 to compressed hex (embedded IPv4 becomes hex groups).
  let host: string;
  try {
    host = new URL(`http://[${s}]/`).hostname.slice(1, -1);
  } catch {
    return null;
  }
  const [head, tail] = host.split('::') as [string, string | undefined];
  const h = head ? head.split(':').map((x) => parseInt(x, 16)) : [];
  if (tail === undefined) return h.length === 8 ? h : null;
  const t = tail ? tail.split(':').map((x) => parseInt(x, 16)) : [];
  return [...h, ...Array<number>(8 - h.length - t.length).fill(0), ...t];
}

export function isReservedIPv6(ip: string): boolean {
  const g = expandIPv6(ip);
  if (!g) return true;
  const [a, b] = g as [number, number];
  const allZeroUntil = (i: number) => g.slice(0, i).every((x) => x === 0);
  if (g.every((x) => x === 0)) return true; // ::
  if (allZeroUntil(7) && g[7] === 1) return true; // ::1
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d → judge the embedded IPv4.
  if (allZeroUntil(5) && (g[5] === 0xffff || g[5] === 0)) {
    const v4 = `${g[6]! >>> 8}.${g[6]! & 0xff}.${g[7]! >>> 8}.${g[7]! & 0xff}`;
    return isReservedIPv4(v4) || g[5] === 0; // deprecated compatible form: always block
  }
  if (allZeroUntil(4) && g[4] === 0xffff && g[5] === 0) return true; // ::ffff:0:0/96 IPv4-translated (SIIT)
  if (a === 0x64 && b === 0xff9b) return true; // 64:ff9b::/96 and 64:ff9b:1::/48 NAT64
  if (a === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // 100::/64 discard
  if (a === 0x2001 && b === 0x0db8) return true; // documentation
  if (a === 0x2001 && b < 0x0200) return true; // 2001::/23 IETF protocol assignments (Teredo etc.)
  if (a === 0x2002) return true; // 6to4 can embed private IPv4
  if (a === 0x3fff && (b & 0xf000) === 0) return true; // 3fff::/20 documentation (RFC 9637)
  if (a === 0x5f00) return true; // 5f00::/16 SRv6 SIDs (RFC 9602)
  if ((a & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((a & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((a & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local
  if ((a & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

export function isReservedIp(ip: string): boolean {
  const kind = net.isIP(ip.replace(/^\[|\]$/g, '').split('%')[0]!);
  if (kind === 4) return isReservedIPv4(ip);
  if (kind === 6) return isReservedIPv6(ip);
  return true;
}

// ── Hostnames ───────────────────────────────────────────────────────────────────
const BLOCKED_NAMES = [/^localhost$/, /\.localhost$/, /^host\.docker\.internal$/, /\.local$/, /\.internal$/, /\.localdomain$/, /\.home\.arpa$/, /^metadata$/, /^metadata\.google\.internal$/];
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

export type HostCheck = { ok: true; addresses: string[] } | { ok: false; reason: string };

export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;

const defaultResolver: Resolver = (host) => dns.promises.lookup(host, { all: true, verbatim: true });

/** Predicate deciding whether an address is off-limits (tests may narrow it; production uses isReservedIp). */
export type IsBlocked = (ip: string) => boolean;

/** Validate a hostname or IP literal (from user input) and every address it resolves to. */
export async function validateHost(rawHost: string, resolve: Resolver = defaultResolver, isBlocked: IsBlocked = isReservedIp): Promise<HostCheck> {
  const host = rawHost.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return { ok: false, reason: 'empty host' };
  if (net.isIP(host)) return isBlocked(host) ? { ok: false, reason: 'reserved address' } : { ok: true, addresses: [host] };
  // Anything numeric-looking that is not a canonical dotted quad (e.g. 2130706433, 0x7f.1, 127.1).
  if (/^[0-9a-fx.]+$/.test(host) && !/[g-wyz]/.test(host) && /^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+))*$/.test(host)) {
    return { ok: false, reason: 'non-canonical IPv4 literal' };
  }
  if (BLOCKED_NAMES.some((re) => re.test(host))) return { ok: false, reason: 'blocked hostname' };
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return { ok: false, reason: 'invalid hostname' };
  let answers: { address: string }[];
  try {
    answers = await resolve(host);
  } catch {
    return { ok: false, reason: 'dns lookup failed' };
  }
  if (!answers.length) return { ok: false, reason: 'no dns answers' };
  const bad = answers.find((a) => isBlocked(a.address));
  if (bad) return { ok: false, reason: 'resolves to a reserved address' };
  return { ok: true, addresses: answers.map((a) => a.address) };
}

export const ALLOWED_PORTS: ReadonlySet<string> = new Set(['', '80', '443', '8080', '8443']);

/** Throws HttpError('blocked') unless `url` is an http(s) URL to a public host on an allowed port. */
export async function assertPublicUrl(
  url: URL,
  resolve: Resolver = defaultResolver,
  isBlocked: IsBlocked = isReservedIp,
  ports: ReadonlySet<string> = ALLOWED_PORTS,
): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HttpError('Only http(s) URLs are allowed', 'blocked', url.toString());
  if (url.username || url.password) throw new HttpError('Credentials in URLs are not allowed', 'blocked', url.toString());
  if (!ports.has(url.port)) throw new HttpError(`Port ${url.port} is not allowed`, 'blocked', url.toString());
  const check = await validateHost(url.hostname, resolve, isBlocked);
  if (!check.ok) throw new HttpError(`Blocked host: ${check.reason}`, 'blocked', url.toString());
}

/**
 * DNS lookup for the socket that rejects reserved answers at connect time (defeats rebinding:
 * the address actually connected to is the one checked). Node calls it with `{all: true}` when
 * happy-eyeballs is on; both shapes are handled.
 */
export function makeGuardedLookup(resolve: Resolver = defaultResolver, isBlocked: IsBlocked = isReservedIp): LookupFunction {
  return (hostname, options, callback) => {
    const cb = callback as (e: NodeJS.ErrnoException | null, a?: string | dns.LookupAddress[], f?: number) => void;
    resolve(hostname).then(
      (list) => {
        if (!list.length || list.some((a) => isBlocked(a.address))) {
          cb(Object.assign(new Error(`Blocked: ${hostname} resolves to a reserved address`), { code: 'EBLOCKED' }));
          return;
        }
        if ((options as dns.LookupOptions).all) cb(null, list.map((a) => ({ address: a.address, family: a.family })));
        else cb(null, list[0]!.address, list[0]!.family);
      },
      (err: NodeJS.ErrnoException) => cb(err),
    );
  };
}

export const guardedLookup: LookupFunction = makeGuardedLookup();

export interface SafeFetchOptions extends Omit<HttpOptions, 'validateUrl' | 'lookup'> {
  /** Injectable resolver (tests); production uses the system resolver. */
  resolve?: Resolver;
  /** Injectable address predicate (tests only). */
  isBlocked?: IsBlocked;
  /** Allowed ports ('' = scheme default). */
  ports?: ReadonlySet<string>;
}

/**
 * Fetch a user-supplied URL through the guard: validated host, guarded socket lookup, every hop
 * re-checked, no retries, 8 s per hop, 20 s overall, 2 MB cap (callers may lower, not raise blindly).
 */
export function safeFetch(
  url: string | URL,
  { resolve = defaultResolver, isBlocked = isReservedIp, ports = ALLOWED_PORTS, ...opts }: SafeFetchOptions = {},
): Promise<HttpResult> {
  return httpRequest(url, {
    maxRedirects: 3,
    retries: 0,
    timeoutMs: 8000,
    deadlineMs: 20_000,
    maxBytes: 2 * 1024 * 1024,
    ...opts,
    validateUrl: (u) => assertPublicUrl(u, resolve, isBlocked, ports),
    lookup: makeGuardedLookup(resolve, isBlocked),
  });
}

// ── Allow-lists for proxy routes ────────────────────────────────────────────────
export interface AllowRule {
  /** Exact hostname, or `*.example.com` for one-or-more subdomain labels (never the apex). */
  host: string;
  /** Required path prefix, matched on a `/` boundary, e.g. `/jamcams.tfl.gov.uk/`. */
  pathPrefix: string;
  protocols?: readonly ('https:' | 'http:')[];
  /** Exact non-default port, when the operator serves on one (default: scheme port only). */
  port?: string;
}

/**
 * True when `url` matches a rule exactly. Rejects encoded slashes/dots, `..` segments,
 * credentials and non-default ports so a prefix cannot be escaped.
 */
export function matchesAllowList(url: URL, rules: readonly AllowRule[]): boolean {
  if (url.username || url.password) return false;
  const rawPath = url.pathname;
  if (/%2f|%5c|%2e/i.test(rawPath) || rawPath.split('/').some((seg) => seg === '..' || seg === '.')) return false;
  const host = url.hostname.toLowerCase();
  return rules.some((r) => {
    const protocols = r.protocols ?? ['https:'];
    if (!protocols.includes(url.protocol as 'https:' | 'http:')) return false;
    if (url.port !== (r.port ?? '')) return false;
    const hostOk = r.host.startsWith('*.') ? host.endsWith(r.host.slice(1)) && host.length > r.host.length - 1 : host === r.host.toLowerCase();
    // A prefix is a directory boundary: `/arcgis` matches `/arcgis` and `/arcgis/…`, never `/arcgis-evil/`.
    const prefix = r.pathPrefix;
    const pathOk = prefix.endsWith('/') ? rawPath.startsWith(prefix) : rawPath === prefix || rawPath.startsWith(`${prefix}/`);
    return hostOk && pathOk;
  });
}

/**
 * The only fetch proxy routes may use (camera stills, ArcGIS, any future tile/image proxy): every
 * hop — the first URL and each redirect — must match `rules` AND pass the SSRF guard, with the
 * guarded socket lookup. Never call httpRequest() after a one-off matchesAllowList() check: that
 * follows redirects off the allow-list.
 */
export function allowListedFetch(
  url: string | URL,
  rules: readonly AllowRule[],
  { resolve = defaultResolver, isBlocked = isReservedIp, ports = ALLOWED_PORTS, ...opts }: SafeFetchOptions = {},
): Promise<HttpResult> {
  return httpRequest(url, {
    maxRedirects: 2,
    retries: 0,
    timeoutMs: 8000,
    deadlineMs: 15_000,
    maxBytes: 5 * 1024 * 1024,
    ...opts,
    validateUrl: async (u) => {
      if (!matchesAllowList(u, rules)) throw new HttpError('URL is not on this route\'s allow-list', 'blocked', u.toString());
      await assertPublicUrl(u, resolve, isBlocked, ports);
    },
    lookup: makeGuardedLookup(resolve, isBlocked),
  });
}
