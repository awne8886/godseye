/**
 * Live Alerts pipeline: public Telegram channel previews + wire RSS → plain-text AlertItems,
 * cross-post merge, keyword kind/risk (method stated), gazetteer pins with precision.
 *
 * Probed 2026-09-30 (docs/data-sources/panels-alerts-markets-dossier-graph.md): all 9 `t.me/s/`
 * previews 200 in 0.8–1.2 s; BBC/Guardian/Al Jazeera/France24/DW/NYT/CNA/Africanews 200; Times of
 * Israel 403 and TASS 403 (reported as SOURCE OFFLINE per source, never hidden); AA reset the
 * connection; SCMP answers 301 to an http:// URL, which http.ts refuses (https→http downgrade), so
 * it shows as failed rather than being worked around.
 * Telegram posts are low-volume public previews shown to people; they are never used for training.
 * Owner: panels-alerts-markets-dossier-graph. Server-only.
 */
import 'server-only';
import { createHash } from 'node:crypto';
import { runProvider, type FeedContext, type FeedData, type ProviderRun } from '@/lib/feeds';
import { httpText } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import { parseFeed, toPlainText } from '@/lib/rss';
import type { AlertItem, NewsSourceStatus } from '@/lib/types';
import { alertKind, riskScore } from './classify';
import { geoparse } from './gazetteer';
import { fingerprint, parseChannelPage, type TelegramPost } from './telegram';

export type Bloc = AlertItem['bloc'];

export interface NewsSource {
  handle: string;
  name: string;
  lean: string;
  bloc: Bloc;
  kind: 'telegram' | 'wire';
  url: string;
}

const tg = (handle: string, name: string, lean: string, bloc: Bloc): NewsSource => ({ handle, name, lean, bloc, kind: 'telegram', url: `https://t.me/s/${handle}` });
const wire = (handle: string, name: string, lean: string, bloc: Bloc, url: string): NewsSource => ({ handle, name, lean, bloc, kind: 'wire', url });

/** Each channel is labelled with its declared stance; a post is a claim, not a verification. */
export const TELEGRAM_CHANNELS: readonly NewsSource[] = [
  tg('Osintdefender', 'OSINTdefender', 'Global incident OSINT', 'independent'),
  tg('WarMonitors', 'War Monitor', 'Global conflict monitor', 'independent'),
  tg('rybar_in_english', 'Rybar', 'Russian military OSINT', 'russian'),
  tg('DDGeopolitics', 'DD Geopolitics', 'Multipolar / Russian', 'russian'),
  tg('intelslava', 'Intel Slava Z', 'Russian military OSINT', 'russian'),
  tg('KyivIndependent_official', 'Kyiv Independent', 'Ukrainian newsroom', 'western'),
  tg('QudsNen', 'Quds News Network', 'Palestinian / Gaza & West Bank', 'regional'),
  tg('AlMayadeenEnglish', 'Al Mayadeen English', 'Lebanese / Resistance Axis', 'regional'),
  tg('PressTV', 'Press TV', 'Iranian state broadcaster', 'regional'),
];

export const WIRE_FEEDS: readonly NewsSource[] = [
  wire('bbc', 'BBC World', 'UK public broadcaster', 'western', 'https://feeds.bbci.co.uk/news/world/rss.xml'),
  wire('guardian', 'The Guardian', 'UK newspaper', 'western', 'https://www.theguardian.com/world/rss'),
  wire('aljazeera', 'Al Jazeera', 'Qatari broadcaster', 'regional', 'https://www.aljazeera.com/xml/rss/all.xml'),
  wire('france24', 'France 24', 'French public broadcaster', 'western', 'https://www.france24.com/en/rss'),
  wire('dw', 'DW', 'German public broadcaster', 'western', 'https://rss.dw.com/rdf/rss-en-world'),
  wire('nyt', 'New York Times', 'US newspaper', 'western', 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml'),
  wire('timesofisrael', 'Times of Israel', 'Israeli newspaper', 'regional', 'https://www.timesofisrael.com/feed/'),
  wire('tass', 'TASS', 'Russian state agency', 'russian', 'https://tass.com/rss/v2.xml'),
  wire('anadolu', 'Anadolu Agency', 'Turkish state agency', 'regional', 'https://www.aa.com.tr/en/rss/default?cat=world'),
  wire('scmp', 'South China Morning Post', 'Hong Kong newspaper', 'regional', 'https://www.scmp.com/rss/91/feed/'),
  wire('cna', 'CNA', 'Singapore broadcaster', 'regional', 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6311'),
  wire('africanews', 'Africanews', 'Pan-African broadcaster', 'regional', 'https://www.africanews.com/feed/rss'),
];

export const ALL_SOURCES: readonly NewsSource[] = [...TELEGRAM_CHANNELS, ...WIRE_FEEDS];

/** Contract §6 News and OSIRIS `api/news/route.ts:80`: the 8 newest posts per channel (low volume). */
export const POSTS_PER_CHANNEL = 8;
export const ITEMS_PER_WIRE = 8;

/** The newest POSTS_PER_CHANNEL posts of a `t.me/s/<handle>` page (the page lists oldest first). */
export function latestChannelPosts(html: string, handle: string): TelegramPost[] {
  return parseChannelPage(html, handle).slice(-POSTS_PER_CHANNEL);
}
export const MAX_ITEM_AGE_MS = 72 * 3600_000;

export interface NewsData {
  items: AlertItem[];
  sources: NewsSourceStatus[];
}

const idFor = (s: string) => createHash('sha1').update(s).digest('base64url').slice(0, 16);
const isHttp = (u: string | null | undefined): u is string => !!u && /^https?:\/\//i.test(u);

/** Telegram post → AlertItem (plain text only). */
export function fromTelegram(p: TelegramPost, src: NewsSource): AlertItem {
  const text = `${p.headline}\n${p.summary}`;
  const place = geoparse(p.headline, p.summary);
  return {
    id: `tg:${p.id}`,
    title: p.headline,
    summary: p.summary ? p.summary.slice(0, 600) : null,
    link: p.url,
    publishedAt: p.publishedAt,
    source: `t.me/${src.handle}`,
    sourceName: src.name,
    sourceKind: 'telegram',
    lean: src.lean,
    bloc: src.bloc,
    breaking: p.breaking,
    kind: alertKind(text),
    media: p.media,
    alsoReportedBy: [],
    views: p.views,
    forwardedFrom: p.forwardedFrom,
    replyTo: p.replyTo,
    place,
    risk: riskScore(`${p.breaking ? 'breaking ' : ''}${text}`),
  };
}

/** RSS item → AlertItem, or null when it has no http(s) link or no publication time (never back-dated). */
export function fromWire(it: ReturnType<typeof parseFeed>[number], src: NewsSource): AlertItem | null {
  if (!isHttp(it.link) || !it.publishedAt || !it.title) return null;
  const title = toPlainText(it.title).slice(0, 300);
  const summary = toPlainText(it.description).slice(0, 600) || null;
  const text = `${title}\n${summary ?? ''}`;
  return {
    id: `rss:${src.handle}:${idFor(it.guid ?? it.link)}`,
    title,
    summary,
    link: it.link,
    publishedAt: it.publishedAt,
    source: src.handle,
    sourceName: src.name,
    sourceKind: 'wire',
    lean: src.lean,
    bloc: src.bloc,
    breaking: /^breaking\b/i.test(title),
    kind: alertKind(text),
    media: null,
    alsoReportedBy: [],
    views: null,
    forwardedFrom: null,
    replyTo: null,
    place: geoparse(title, summary ?? ''),
    risk: riskScore(text),
  };
}

/**
 * Merge one report carried by several channels: same ≥ 6-word fingerprint → the earliest post
 * leads, the others become `alsoReportedBy` (a channel re-posting itself is not corroboration).
 */
export function mergeCrossPosts(items: AlertItem[]): AlertItem[] {
  const byTime = [...items].sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
  const leads = new Map<string, AlertItem>();
  const out: AlertItem[] = [];
  for (const it of byTime) {
    const fp = fingerprint(`${it.title} ${it.summary ?? ''}`);
    const lead = fp.split(' ').length >= 6 ? leads.get(fp) : undefined;
    if (lead) {
      if (lead.source !== it.source && !lead.alsoReportedBy.some((r) => r.source === it.source)) {
        lead.alsoReportedBy.push({ source: it.source, sourceName: it.sourceName, lean: it.lean, bloc: it.bloc, link: it.link, publishedAt: it.publishedAt });
      }
      continue;
    }
    const copy = { ...it, alsoReportedBy: [...it.alsoReportedBy] };
    if (fp.split(' ').length >= 6) leads.set(fp, copy);
    out.push(copy);
  }
  return out.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

const tgLimiter = () => providerBucket('t.me', 2, 3);

/** Feed run: every source is one provider (`tg:<handle>` / `rss:<handle>`) in `providers`. */
export async function runNews(ctx: Pick<FeedContext<NewsData>, 'signal'>, now = Date.now()): Promise<FeedData<NewsData>> {
  const providers: Record<string, ProviderRun> = {};
  const sources: NewsSourceStatus[] = [];
  const all: AlertItem[] = [];
  const fresh = (it: AlertItem) => now - Date.parse(it.publishedAt) <= MAX_ITEM_AGE_MS && Date.parse(it.publishedAt) <= now + 5 * 60_000;

  await Promise.all(
    ALL_SOURCES.map(async (src) => {
      const key = `${src.kind === 'telegram' ? 'tg' : 'rss'}:${src.handle}`;
      const { result, run } = await runProvider(
        async () => {
          const r = await httpText(src.url, { timeoutMs: 10_000, retries: 1, maxBytes: 4 * 1024 * 1024, signal: ctx.signal, ...(src.kind === 'telegram' ? { limiter: tgLimiter() } : {}) });
          if (src.kind === 'telegram') return latestChannelPosts(r.text ?? '', src.handle).map((p) => fromTelegram(p, src)).filter(fresh);
          return parseFeed(r.text ?? '')
            .map((it) => fromWire(it, src))
            .filter((x): x is AlertItem => x !== null && fresh(x))
            .slice(0, ITEMS_PER_WIRE);
        },
        (items) => items.length,
      );
      providers[key] = run;
      const items = result ?? [];
      all.push(...items);
      sources.push({
        handle: src.handle,
        name: src.name,
        lean: src.lean,
        bloc: src.bloc,
        kind: src.kind,
        count: items.length,
        latestAt: items.reduce<string | null>((m, it) => (m === null || it.publishedAt > m ? it.publishedAt : m), null),
        ok: run.status.ok,
      });
    }),
  );
  const order = new Map(ALL_SOURCES.map((s, i) => [s.handle, i]));
  sources.sort((a, b) => order.get(a.handle)! - order.get(b.handle)!);
  const items = mergeCrossPosts(all);
  const newest = items.length ? Date.parse(items[0]!.publishedAt) : null;
  return { data: { items, sources }, providers, observedAt: newest };
}
