/**
 * Security-header grade for a user-supplied public URL. The request is proxied through this
 * server via safeFetch() (SSRF guard: public hosts only, ports 80/443/8080/8443, no credentials,
 * every redirect hop re-validated, guarded socket lookup). The grade is transparent: every point
 * deducted is listed as a finding. Owner: panels-recon. Server-only.
 */
import 'server-only';
import type { IncomingHttpHeaders } from 'node:http';
import { HttpError } from '@/lib/http';
import { safeFetch } from '@/lib/ssrf';
import type { Finding } from './lookup';
import { probe } from './lookup';
import type { ToolResult } from './osint';

/** Normalise user input to an http(s) URL (bare hosts get https://). Throws HttpError('blocked'). */
export function targetUrl(raw: string): URL {
  const s = raw.trim();
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    throw new HttpError('Not a valid URL', 'blocked', s);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new HttpError('Only http(s) URLs are allowed', 'blocked', s);
  if (u.username || u.password) throw new HttpError('Credentials in URLs are not allowed', 'blocked', s);
  u.hash = '';
  return u;
}

const CHECKS: { header: string; points: number; level: Finding['level']; label: string; detail: string; httpsOnly?: boolean }[] = [
  { header: 'strict-transport-security', points: 20, level: 'medium', label: 'No HSTS', detail: 'Strict-Transport-Security is missing: browsers may be downgraded to HTTP.', httpsOnly: true },
  { header: 'content-security-policy', points: 25, level: 'medium', label: 'No Content-Security-Policy', detail: 'No CSP limits where scripts, frames and styles may load from.' },
  { header: 'x-content-type-options', points: 10, level: 'low', label: 'No X-Content-Type-Options', detail: 'nosniff is not set: browsers may MIME-sniff responses.' },
  { header: 'referrer-policy', points: 10, level: 'low', label: 'No Referrer-Policy', detail: 'Full URLs may leak to other sites in the Referer header.' },
  { header: 'permissions-policy', points: 10, level: 'low', label: 'No Permissions-Policy', detail: 'Powerful browser features (camera, geolocation…) are not restricted.' },
];

const one = (h: IncomingHttpHeaders, k: string) => {
  const v = h[k];
  return Array.isArray(v) ? v.join(', ') : (v ?? null);
};

export function gradeHeaders(h: IncomingHttpHeaders, https: boolean): { score: number; grade: string; findings: Finding[]; present: Record<string, string | null> } {
  let score = 100;
  const findings: Finding[] = [];
  const present: Record<string, string | null> = {};
  for (const c of CHECKS) {
    present[c.header] = one(h, c.header);
    if (c.httpsOnly && !https) continue;
    if (!present[c.header]) {
      score -= c.points;
      findings.push({ level: c.level, label: `${c.label} (−${c.points})`, detail: c.detail });
    }
  }
  present['x-frame-options'] = one(h, 'x-frame-options');
  const csp = present['content-security-policy'] ?? '';
  if (!present['x-frame-options'] && !/frame-ancestors/i.test(csp)) {
    score -= 10;
    findings.push({ level: 'low', label: 'No clickjacking protection (−10)', detail: 'Neither X-Frame-Options nor CSP frame-ancestors is set.' });
  }
  if (!https) {
    score -= 20;
    findings.push({ level: 'medium', label: 'Served over HTTP (−20)', detail: 'The final response was not served over HTTPS.' });
  }
  for (const k of ['server', 'x-powered-by', 'x-aspnet-version']) {
    const v = one(h, k);
    present[k] = v;
    if (v && /\d/.test(v)) {
      score -= 5;
      findings.push({ level: 'info', label: `Version disclosed in ${k} (−5)`, detail: v.slice(0, 120) });
    }
  }
  score = Math.max(0, score);
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
  return { score, grade, findings, present };
}

export async function headersLookup(raw: string): Promise<ToolResult> {
  const url = targetUrl(raw);
  const p = await probe(`headers:${url.toString()}`, 5 * 60_000, async () => {
    // HEAD first (no body); servers that refuse HEAD get a capped GET.
    let res = await safeFetch(url, { method: 'HEAD', maxBytes: 64 * 1024 });
    if (res.status === 405 || res.status === 501) res = await safeFetch(url, { method: 'GET', maxBytes: 2 * 1024 * 1024 });
    return { finalUrl: res.url, status: res.status, headers: res.headers };
  });
  if (!p.value) {
    return { data: { url: url.toString() }, findings: [], providers: { target: p.status } };
  }
  const https = p.value.finalUrl.startsWith('https:');
  const g = gradeHeaders(p.value.headers, https);
  return {
    data: { url: url.toString(), finalUrl: p.value.finalUrl, status: p.value.status, grade: g.grade, score: g.score, headers: g.present, via: 'proxied through this server' },
    findings: g.findings,
    providers: { target: p.status },
  };
}
