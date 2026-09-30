/**
 * Builds AI prompts and the matching ANALYST (heuristic) answers from feeds read in-process. The
 * facts come from the server's own feeds — never from the client payload — so every citable id in
 * a prompt is one the server actually holds.
 * Owner: panels-alerts-markets-dossier-graph. Server-only.
 */
import 'server-only';
import { getFeed } from '@/lib/feeds';
import { distanceKm } from '@/lib/geo';
import { earthquakeFeed } from '@/features/hazards/server/usgs';
import type { AlertItem, Earthquake, Quote } from '@/lib/types';
import { chainFeed, marketsFeed, newsFeed } from '../feeds';
import { SYSTEM_BASE, type ChatTurn, type CitableRow } from './ai';
import { buildAlertBrief, timeAgo, type AlertBrief, BLOC_LABEL } from './digest';
import type { ChainData } from './chain';

export interface Prompt {
  system: string;
  turns: ChatTurn[];
  allowed: CitableRow[];
  analystText: string;
  analystCitations: CitableRow[];
  brief?: AlertBrief;
}

export interface Snapshot {
  news: AlertItem[];
  quakes: Earthquake[];
  quotes: Quote[];
  chain: ChainData | null;
  kp: number | null;
}

export async function readSnapshot(): Promise<Snapshot> {
  const [n, q, m, c] = await Promise.all([
    newsFeed.get().catch(() => null),
    earthquakeFeed().get().catch(() => null),
    marketsFeed.get().catch(() => null),
    chainFeed.get().catch(() => null),
  ]);
  const sw = getFeed('space-weather')?.peek().data as { kp?: { kp?: number | null } } | null | undefined;
  return { news: n?.data?.items ?? [], quakes: q?.data?.items ?? [], quotes: m?.data?.quotes ?? [], chain: c?.data ?? null, kp: sw?.kp?.kp ?? null };
}

const newsRow = (r: AlertItem): CitableRow => ({ feed: 'news', id: r.id, label: `${r.sourceName}: ${r.title}` });
const quakeRow = (q: Earthquake): CitableRow => ({ feed: 'quake', id: q.id, label: `M${q.magnitude.toFixed(1)} ${q.place ?? ''}`.trim() });

function headlineLines(news: readonly AlertItem[], now: number, max = 40): string {
  return [...news]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, max)
    .map((r) => `- [news:${r.id}] ${timeAgo(r.publishedAt, now) || 'undated'} · ${r.sourceName} (${BLOC_LABEL[r.bloc]}; ${r.lean})${r.alsoReportedBy.length ? `, also carried by ${r.alsoReportedBy.length} other channel(s)` : ''}: ${r.title}`)
    .join('\n');
}

function marketFacts(quotes: readonly Quote[], kp: number | null): string[] {
  const priced = quotes.filter((q) => q.changePct !== null);
  if (!priced.length) return ['No live market instruments available in the current feed.'];
  const up = priced.filter((q) => q.changePct! > 0).length;
  const down = priced.filter((q) => q.changePct! < 0).length;
  const sorted = [...priced].sort((a, b) => b.changePct! - a.changePct!);
  const f = [`${priced.length} instruments tracked — ${up} up / ${down} down (${up >= down ? 'risk-on' : 'risk-off'} breadth).`];
  const top = sorted[0]!;
  const worst = sorted.at(-1)!;
  f.push(`Top gainer: ${top.name} ${top.changePct! >= 0 ? '+' : ''}${top.changePct!.toFixed(2)}%.`, `Worst performer: ${worst.name} ${worst.changePct!.toFixed(2)}%.`);
  const btc = quotes.find((q) => q.symbol === 'BTC');
  if (btc?.price && btc.changePct !== null) f.push(`Bitcoin ${btc.changePct >= 0 ? 'up' : 'down'} ${Math.abs(btc.changePct).toFixed(2)}% at $${Math.round(btc.price).toLocaleString('en-US')} (${btc.source}).`);
  if (kp !== null) f.push(`Space weather: Kp ${kp} (${kp >= 5 ? 'geomagnetic storm conditions' : 'quiet to unsettled geomagnetic field'}).`);
  return f;
}

const usd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n).toLocaleString('en-US')}`);

function chainFacts(c: ChainData | null, days = 30, now = Date.now()): string[] {
  if (!c) return ['Chain brief unavailable (DefiLlama and NVD did not answer).'];
  const since = now - days * 86_400_000;
  const ex = c.exploits.filter((e) => Date.parse(`${e.date}T00:00:00Z`) >= since);
  const total = ex.reduce((s, e) => s + (e.amountUsd ?? 0), 0);
  const f = [`${ex.length} on-chain exploits in the last ${days} days totalling ${usd(total)}.`];
  const largest = [...ex].sort((a, b) => (b.amountUsd ?? 0) - (a.amountUsd ?? 0))[0];
  if (largest?.amountUsd) f.push(`Largest: ${largest.name}${largest.chain ? ` on ${largest.chain}` : ''} — ${usd(largest.amountUsd)}${largest.technique ? ` via ${largest.technique}` : ''}.`);
  const crit = c.cves.filter((v) => (v.cvss ?? 0) >= 9).length;
  f.push(`${c.cves.length} cryptocurrency-related CVEs published in the last 120 days, ${crit} rated critical (CVSS ≥ 9).`);
  if (c.degraded.length) f.push(`Degraded sources: ${c.degraded.join(', ')}.`);
  return f;
}

function briefFor(s: Snapshot, now: number): AlertBrief {
  return buildAlertBrief({ news: s.news, quakes: s.quakes.map((q) => ({ magnitude: q.magnitude, place: q.place, observedAt: q.observedAt, url: q.url, tsunami: q.tsunami })), quakeMinMagnitude: 2.5 }, now);
}

function citeLeads(brief: AlertBrief, news: readonly AlertItem[]): CitableRow[] {
  const ids = new Set(brief.threads.map((t) => t.lead?.id).filter(Boolean));
  return news.filter((n) => ids.has(n.id)).map(newsRow);
}

export type Scope = 'alerts' | 'markets' | 'chain';

export function overviewPrompt(scope: Scope, s: Snapshot, now = Date.now()): Prompt {
  if (scope === 'markets') {
    const facts = marketFacts(s.quotes, s.kp);
    const summary = facts.length > 1 ? (s.quotes.filter((q) => (q.changePct ?? 0) > 0).length >= s.quotes.filter((q) => (q.changePct ?? 0) < 0).length ? 'Global tape is broadly bid.' : 'Global tape is under pressure.') : 'Market feed is thin right now.';
    return { system: `${SYSTEM_BASE} Write 2–4 sentences.`, turns: [{ role: 'user', content: `MODE: MARKETS\n\nBOTTOM LINE: ${summary}\n\nFACTS:\n${facts.map((f) => `- ${f}`).join('\n')}\n\nWrite the read-out now.` }], allowed: [], analystText: `${summary}\n\n${facts.map((f) => `• ${f}`).join('\n')}`, analystCitations: [] };
  }
  if (scope === 'chain') {
    const facts = chainFacts(s.chain, 30, now);
    return { system: `${SYSTEM_BASE} Write 2–4 sentences.`, turns: [{ role: 'user', content: `MODE: CHAIN\n\nFACTS:\n${facts.map((f) => `- ${f}`).join('\n')}\n\nWrite the read-out now.` }], allowed: [], analystText: facts.map((f) => `• ${f}`).join('\n'), analystCitations: [] };
  }
  const brief = briefFor(s, now);
  const allowed = [...s.news.slice(0, 40).map(newsRow), ...s.quakes.slice(0, 20).map(quakeRow)];
  return {
    system: `${SYSTEM_BASE} Write 3–5 sentences.`,
    turns: [{ role: 'user', content: `MODE: ALERTS\n\nBOTTOM LINE: ${brief.bottomLine}\n\nFACTS:\n${brief.facts.map((f) => `- ${f}`).join('\n')}\n\nHEADLINES (newest first):\n${headlineLines(s.news, now)}\n\nWrite the read-out now.` }],
    allowed,
    analystText: `${brief.bottomLine}\n\n${brief.facts.map((f) => `• ${f}`).join('\n')}\n\nMethod: ${brief.method}`,
    analystCitations: citeLeads(brief, s.news),
    brief,
  };
}

export function analyzePrompt(lat: number, lng: number, s: Snapshot, now = Date.now()): Prompt {
  const near = (la: number, ln: number) => distanceKm([lng, lat], [ln, la]) <= 300;
  const news = s.news.filter((n) => n.place && near(n.place.lat, n.place.lng));
  const quakes = s.quakes.filter((q) => near(q.lat, q.lng));
  const brief = buildAlertBrief({ news, quakes: quakes.map((q) => ({ magnitude: q.magnitude, place: q.place, observedAt: q.observedAt, url: q.url, tsunami: q.tsunami })) }, now);
  const allowed = [...news.map(newsRow), ...quakes.map(quakeRow)];
  const head = `Within 300 km of ${lat.toFixed(2)}, ${lng.toFixed(2)}: ${news.length} geoparsed report(s) and ${quakes.length} earthquake(s) in the current feeds.`;
  return {
    system: `${SYSTEM_BASE} Write 3–5 sentences about this area only.`,
    turns: [{ role: 'user', content: `MODE: AREA\n\n${head}\n\nFACTS:\n${brief.facts.map((f) => `- ${f}`).join('\n')}\n\nROWS:\n${headlineLines(news, now)}\n${quakes.map((q) => `- [quake:${q.id}] M${q.magnitude.toFixed(1)} ${q.place ?? ''} ${timeAgo(q.observedAt, now)}`).join('\n')}\n\nWrite the read-out now.` }],
    allowed,
    analystText: `${head}\n\n${brief.facts.map((f) => `• ${f}`).join('\n') || '• Nothing in the current feeds is placed near this point.'}\n\nMethod: pins are keyword geoparsed; ${brief.method}`,
    analystCitations: allowed.slice(0, 8),
    brief,
  };
}

export function briefingPrompt(horizon: '24h' | '72h', s: Snapshot, now = Date.now()): Prompt {
  const brief = briefFor(s, now);
  const mf = marketFacts(s.quotes, s.kp);
  const allowed = [...s.news.slice(0, 40).map(newsRow), ...s.quakes.slice(0, 20).map(quakeRow)];
  const pirs = brief.threads.slice(0, 3).map((t) => `Does independent reporting corroborate "${t.lead?.title ?? t.label}" (${t.perspective === 'single' ? 'single-sided so far' : t.perspective === 'cross' ? 'carried by both sides' : 'mixed sourcing'})?`);
  const analyst = [
    `BLUF: ${brief.bottomLine}`,
    '',
    'KEY DEVELOPMENTS:',
    ...brief.facts.map((f) => `• ${f}`),
    '',
    'MARKETS:',
    ...mf.map((f) => `• ${f}`),
    '',
    'PRIORITY INTELLIGENCE REQUIREMENTS:',
    ...(pirs.length ? pirs.map((p) => `• ${p}`) : ['• None derived: no theatre clusters in the current feed.']),
    '',
    `OUTLOOK (${horizon}): not forecast by the heuristic analyst — it groups current reports only.`,
    '',
    `Method: ${brief.method}`,
  ].join('\n');
  return {
    system: `${SYSTEM_BASE} Structure: BLUF, KEY DEVELOPMENTS, MARKETS, PRIORITY INTELLIGENCE REQUIREMENTS, OUTLOOK (${horizon}, clearly labelled as assessment).`,
    turns: [{ role: 'user', content: `MODE: BRIEFING (${horizon})\n\nFACTS:\n${[...brief.facts, ...mf].map((f) => `- ${f}`).join('\n')}\n\nHEADLINES (newest first):\n${headlineLines(s.news, now)}\n\nWrite the briefing now.` }],
    allowed,
    analystText: analyst,
    analystCitations: citeLeads(brief, s.news),
    brief,
  };
}

const WORD = /[\p{L}\p{N}]{4,}/gu;

export function chatPrompt(turns: ChatTurn[], s: Snapshot, now = Date.now()): Prompt {
  const brief = briefFor(s, now);
  const allowed = [...s.news.slice(0, 40).map(newsRow), ...s.quakes.slice(0, 20).map(quakeRow)];
  const last = [...turns].reverse().find((t) => t.role === 'user')?.content ?? '';
  const words = new Set((last.toLowerCase().match(WORD) ?? []).filter((w) => !['what', 'about', 'there', 'which', 'with', 'from', 'this', 'that', 'have'].includes(w)));
  const hits = s.news.filter((n) => [...words].some((w) => n.title.toLowerCase().includes(w))).slice(0, 6);
  const analyst = hits.length
    ? [`${hits.length} report(s) in the current feed match your question (keyword match, not verified):`, ...hits.map((h) => `• ${h.sourceName} (${BLOC_LABEL[h.bloc]}), ${timeAgo(h.publishedAt, now)}: ${h.title} [news:${h.id}]`)].join('\n')
    : `No report in the current feed matches those keywords. ${brief.bottomLine}`;
  const context = `CURRENT FEED\nBOTTOM LINE: ${brief.bottomLine}\nFACTS:\n${brief.facts.map((f) => `- ${f}`).join('\n')}\nHEADLINES:\n${headlineLines(s.news, now, 30)}`;
  return {
    system: `${SYSTEM_BASE} Answer the analyst's questions using only the feed below; say when the feed does not cover something.\n\n${context}`,
    turns,
    allowed,
    analystText: analyst,
    analystCitations: hits.map(newsRow),
  };
}
