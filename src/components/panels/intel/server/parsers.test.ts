import { describe, expect, it } from 'vitest';
import { AlertItem } from '@/lib/schemas/intel';
import { parseFeed } from '@/lib/rss';
import { FX, fixtureJson, fixtureText } from '../__fixtures__';
import { alertKind, classify, riskScore } from './classify';
import { buildAlertBrief, buildThreads, primaryTheatre } from './digest';
import { geoparse } from './gazetteer';
import { WIRE_FEEDS, TELEGRAM_CHANNELS, POSTS_PER_CHANNEL, fromTelegram, fromWire, latestChannelPosts, mergeCrossPosts } from './news';
import { isOpen, nextChange, sessionsAt, EXCHANGES } from './sessions';
import { fingerprint, parseChannelPage, parseDuration, parseViews } from './telegram';
import { candlesFromChart, quoteFromChart, SYMBOLS, type YahooChart } from './markets';
import { parseBinance, parseCoinbase, parseKraken } from './crypto';
import { parseLlama, parseNvd } from './chain';
import { parseCountry, parseOpenMeteo, parseWikiSummary } from './dossier';
import { canonicalId, wikidataLinks } from './entity';
import { extractPoints, nearbyFromResult } from './nearby';
import { assess } from './scm';

const osint = TELEGRAM_CHANNELS.find((c) => c.handle === 'Osintdefender')!;
const bbc = WIRE_FEEDS.find((w) => w.handle === 'bbc')!;

describe('Telegram preview parser (fixtures captured 2026-09-30)', () => {
  const posts = parseChannelPage(fixtureText(FX.tgOsint), 'Osintdefender');

  it('reads every dated post with its own time, permalink and views', () => {
    expect(posts).toHaveLength(8);
    expect(posts[0]!.id).toBe('OSINTdefender/20365');
    expect(posts[0]!.url).toBe('https://t.me/OSINTdefender/20365');
    expect(posts[0]!.publishedAt).toBe('2026-09-29T17:48:15.000Z');
    expect(posts[0]!.views).toBe(396);
    for (const p of posts) {
      expect(p.headline.length).toBeGreaterThan(2);
      expect(p.headline.length).toBeLessThanOrEqual(141);
      // Plain text only: no markup survives.
      expect(`${p.headline}${p.summary}`).not.toMatch(/<[a-z/][^>]*>/i);
    }
  });

  it('parses views, durations, forwards and replies; drops undated posts and non-Telegram media', () => {
    expect(parseViews('4.02K')).toBe(4020);
    expect(parseViews('1.2M')).toBe(1_200_000);
    expect(parseViews('n/a')).toBeNull();
    expect(parseDuration('1:02:03')).toBe(3723);
    const html =
      '<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message" data-post="Chan/1">' +
      '<div class="tgme_widget_message_forwarded_from accent_color">Forwarded from <a class="tgme_widget_message_forwarded_from_name" href="https://t.me/src">Source &amp; Co</a></div>' +
      '<a class="tgme_widget_message_reply" href="https://t.me/Chan/0"><div class="js-message_reply_text">PARENT TEXT should not leak</div></a>' +
      '<a class="tgme_widget_message_video_player" href="#"><i class="tgme_widget_message_video_thumb" style="background-image:url(\'https://cdn4.telesco.pe/file/thumb.jpg\')"></i><time class="message_video_duration js-message_video_duration">0:29</time><video src="https://evil.example/v.mp4"></video></a>' +
      '<div class="tgme_widget_message_text js-message_text" dir="auto">BREAKING: Explosions reported in <b>Kharkiv</b> &lt;script&gt;alert(1)&lt;/script&gt;<br/>More details follow here.</div>' +
      '<span class="tgme_widget_message_views">4.02K</span><a class="tgme_widget_message_date" href="https://t.me/Chan/1"><time datetime="2026-09-30T19:00:00+00:00" class="time">19:00</time></a></div></div>' +
      '<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="Chan/2"><div class="tgme_widget_message_text js-message_text">No timestamp on this one at all</div></div></div>';
    const [p, ...rest] = parseChannelPage(html, 'Chan');
    expect(rest).toHaveLength(0);
    expect(p!.forwardedFrom).toBe('Source & Co');
    expect(p!.replyTo).toBe('https://t.me/Chan/0');
    expect(p!.breaking).toBe(true);
    expect(p!.headline).toBe('Explosions reported in Kharkiv <script>alert(1)</script>');
    expect(p!.text).not.toContain('PARENT');
    expect(p!.media).toEqual({ type: 'video', thumbnailUrl: 'https://cdn4.telesco.pe/file/thumb.jpg', videoUrl: null, durationS: 29 });
    expect(p!.views).toBe(4020);
  });

  it('maps posts to AlertItems that satisfy the contract, with stance and keyword method', () => {
    for (const p of posts) {
      const it = fromTelegram(p, osint);
      expect(AlertItem.safeParse(it).success).toBe(true);
      expect(it.bloc).toBe('independent');
      expect(it.risk.method).toBe('keyword-count');
    }
  });
});

describe('wire RSS → AlertItems', () => {
  it('keeps only http(s) links and real publication times (never back-dated)', () => {
    const items = parseFeed(fixtureText(FX.bbc)).map((i) => fromWire(i, bbc));
    const ok = items.filter((x) => x !== null);
    expect(ok.length).toBeGreaterThan(5);
    for (const it of ok) {
      expect(AlertItem.safeParse(it).success).toBe(true);
      expect(it!.link).toMatch(/^https?:\/\//);
    }
    const [raw] = parseFeed(fixtureText(FX.bbc));
    expect(fromWire({ ...raw!, publishedAt: null }, bbc)).toBeNull();
    expect(fromWire({ ...raw!, link: null }, bbc)).toBeNull();
  });

  it('merges one report carried by several channels; the earliest leads', () => {
    const base = fromTelegram(parseChannelPage(fixtureText(FX.tgOsint), 'Osintdefender')[0]!, osint);
    const later = { ...base, id: 'tg:rybar/1', source: 't.me/rybar_in_english', sourceName: 'Rybar', bloc: 'russian' as const, publishedAt: new Date(Date.parse(base.publishedAt) + 60_000).toISOString() };
    const merged = mergeCrossPosts([later, base]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe(base.id);
    expect(merged[0]!.alsoReportedBy.map((a) => a.sourceName)).toEqual(['Rybar']);
    expect(fingerprint('Hello @x https://a.b world').split(' ')).toEqual(['hello', 'world']);
  });
});

describe('keyword classification and geoparsing', () => {
  it('matches whole words at word starts only', () => {
    expect(classify('Coup attempt in Mali').theatres).toContain('africa');
    expect(classify('A malicious payload spread').theatres).not.toContain('africa');
    expect(alertKind('Sirens sound as missile launched toward Haifa')).toBe('rocket');
    expect(alertKind('Explosion at a depot')).toBe('event');
    expect(alertKind('Parliament debates budget')).toBe('news');
    const r = riskScore('Ballistic missile strike, 3 killed');
    expect(r.method).toBe('keyword-count');
    expect(r.keywords).toEqual(expect.arrayContaining(['ballistic', 'missile', 'killed']));
    expect(r.score).toBeLessThanOrEqual(10);
  });

  it('pins the most specific place at its own coordinates with precision', () => {
    expect(geoparse('Drone attack on Kharkiv, Ukraine')).toEqual({ name: 'Kharkiv', lat: 49.99, lng: 36.23, precision: 'settlement', method: 'gazetteer' });
    expect(geoparse('Ukraine says talks will resume')).toMatchObject({ name: 'Ukraine', precision: 'country' });
    expect(geoparse('Strikes near the Gaza Strip')).toMatchObject({ name: 'Gaza Strip', precision: 'region' });
    expect(geoparse('Nothing located here')).toBeNull();
  });
});

describe('alert digest (dossier 14 algorithm)', () => {
  const mk = (id: string, title: string, bloc: 'western' | 'russian' | 'regional' | 'independent', sourceName: string, min: number) =>
    ({ ...fromTelegram(parseChannelPage(fixtureText(FX.tgOsint), 'Osintdefender')[0]!, osint), id, title, summary: null, bloc, sourceName, source: sourceName, publishedAt: new Date(Date.parse('2026-09-30T12:00:00Z') + min * 60_000).toISOString(), breaking: false, alsoReportedBy: [] });

  it('builds threads with perspective and a bottom line', () => {
    const news = [mk('a', 'Drone strike on Kyiv', 'western', 'Kyiv Independent', 0), mk('e', 'Shelling reported in Kharkiv', 'western', 'Kyiv Independent', 1), mk('b', 'Kyiv air defence active', 'russian', 'Rybar', 5), mk('c', 'Gaza ceasefire talks', 'regional', 'Al Jazeera', 7), mk('d', 'Gaza strikes continue', 'regional', 'Quds', 9)];
    const threads = buildThreads(news);
    expect(threads[0]).toMatchObject({ id: 'russia-ukraine', count: 3, perspective: 'cross', sources: ['Kyiv Independent', 'Rybar'] });
    expect(threads[1]).toMatchObject({ id: 'israel-gaza-lebanon', perspective: 'single' });
    const brief = buildAlertBrief({ news, quakes: [{ magnitude: 6.2, place: 'off Japan', observedAt: '2026-09-30T11:00:00Z', url: null }], quakeMinMagnitude: 4 }, Date.parse('2026-09-30T13:00:00Z'));
    expect(brief.bottomLine).toBe('Russia–Ukraine war leads the feed: 3 reports from 2 channels, carried by both Western and Russian-aligned channels. Also active: Israel · Gaza · Lebanon (2). Strongest quake: M6.2 off Japan.');
    expect(brief.facts.at(-1)).toContain('M4.0+');
    expect(brief.method).toMatch(/does not verify/);
    expect(buildAlertBrief({}, 0).bottomLine).toBe('No reports in the current feed window.');
  });

  it('never reuses one report as the lead of two theatres; prefers reports primarily about the theatre (R3-m3)', () => {
    const news = [
      mk('h1', 'Hezbollah fighters vow to hold the south as Israel presses; Washington urges calm', 'regional', 'Press TV', 0),
      mk('h2', 'Israel strikes Nabatieh', 'regional', 'Al Mayadeen', 1),
      mk('h3', 'Gaza aid convoy stopped', 'regional', 'Quds', 2),
      mk('u1', 'Pentagon briefs Congress on budget', 'western', 'Reuters', 3),
    ];
    news[0] = { ...news[0]!, alsoReportedBy: [{ sourceName: 'Al Jazeera', source: 'aljazeera', bloc: 'regional', link: 'https://www.aljazeera.com/x' }] as never };
    const threads = buildThreads(news);
    const leads = threads.map((t) => t.lead?.id).filter(Boolean);
    expect(new Set(leads).size).toBe(leads.length);
    expect(threads.find((t) => t.id === 'israel-gaza-lebanon')!.lead!.id).toBe('h1');
    expect(threads.find((t) => t.id === 'us-policy')!.lead!.id).toBe('u1');
    expect(primaryTheatre('Washington says Hezbollah must disarm', ['israel-gaza-lebanon', 'us-policy'])).toBe('us-policy');
  });

  it('keeps the 8 newest posts of a full t.me/s page (R3-m2)', () => {
    const html = fixtureText(FX.tgOsintFull);
    expect(parseChannelPage(html, 'Osintdefender').length).toBeGreaterThan(POSTS_PER_CHANNEL);
    const latest = latestChannelPosts(html, 'Osintdefender');
    expect(POSTS_PER_CHANNEL).toBe(8);
    expect(latest).toHaveLength(8);
    expect(latest.at(-1)!.id).toBe(parseChannelPage(html, 'Osintdefender').at(-1)!.id);
  });
});

describe('exchange sessions (DST-correct via IANA zones)', () => {
  const nyse = EXCHANGES.find((e) => e.exchange === 'NYSE')!;
  const lse = EXCHANGES.find((e) => e.exchange === 'LSE')!;
  const tse = EXCHANGES.find((e) => e.exchange === 'TSE')!;
  it('opens NYSE at 09:30 New York time in summer and winter', () => {
    expect(isOpen(nyse, Date.parse('2026-09-30T13:31:00Z'))).toBe(true); // 09:31 EDT
    expect(isOpen(nyse, Date.parse('2026-12-01T14:01:00Z'))).toBe(false); // 09:01 EST
    expect(isOpen(nyse, Date.parse('2026-12-01T14:31:00Z'))).toBe(true);
    expect(isOpen(nyse, Date.parse('2026-10-03T15:00:00Z'))).toBe(false); // Saturday
  });
  it('follows the UK clock change and the Tokyo lunch break', () => {
    expect(isOpen(lse, Date.parse('2026-10-23T07:30:00Z'))).toBe(true); // 08:30 BST
    expect(isOpen(lse, Date.parse('2026-10-26T07:30:00Z'))).toBe(false); // 07:30 GMT
    expect(isOpen(tse, Date.parse('2026-09-30T02:45:00Z'))).toBe(false); // 11:45 JST lunch
    expect(isOpen(tse, Date.parse('2026-09-30T03:45:00Z'))).toBe(true);
  });
  it('reports the next transition and 12 exchanges', () => {
    expect(new Date(nextChange(nyse, Date.parse('2026-09-30T13:00:00Z'))!).toISOString()).toBe('2026-09-30T13:30:00.000Z');
    const s = sessionsAt(Date.parse('2026-09-30T20:05:00Z'));
    expect(s).toHaveLength(12);
    expect(s.find((x) => x.exchange === 'NYSE')).toMatchObject({ open: false, nextChangeAt: '2026-10-01T13:30:00.000Z' });
  });
});

describe('markets and crypto parsers', () => {
  it('reads a Yahoo chart as an unofficial quote with its own observation time', () => {
    const q = quoteFromChart(SYMBOLS[0]!, fixtureJson<YahooChart>(FX.yahooGspc), Date.parse('2026-09-30T20:05:00Z'))!;
    expect(q).toMatchObject({ symbol: '^GSPC', price: 7651.97, changePct: -0.246, currency: 'USD', unofficial: true, source: 'yahoo', marketOpen: false });
    expect(q.observedAt).toBe(new Date(1790798581 * 1000).toISOString());
    expect(q.spark.length).toBeGreaterThan(10);
    expect(candlesFromChart(fixtureJson<YahooChart>(FX.yahooGc)).candles.length).toBeGreaterThan(15);
  });
  it('keeps each crypto provider’s own timestamp (Kraken has none → null)', () => {
    const b = parseBinance(fixtureJson(FX.binance));
    expect(b.map((q) => q.symbol)).toEqual(['BTC', 'ETH', 'SOL']);
    expect(b[0]).toMatchObject({ priceUsd: 83565.81, changePct24h: 0.044, source: 'binance' });
    expect(b[0]!.observedAt).toBe(new Date(1790798582011).toISOString());
    const cb = parseCoinbase('BTC', fixtureJson(FX.coinbaseTicker), fixtureJson(FX.coinbaseStats))!;
    expect(cb.observedAt).toBe('2026-09-30T20:03:01.787Z');
    expect(cb.changePct24h).toBeCloseTo(((83520.74 - 83582.68) / 83582.68) * 100, 6);
    const k = parseKraken(fixtureJson(FX.kraken));
    expect(k.every((q) => q.observedAt === null && q.source === 'kraken')).toBe(true);
    expect(k.map((q) => q.symbol).sort()).toEqual(['BTC', 'ETH', 'SOL']);
  });
});

describe('chain, dossier, entity and nearby parsers', () => {
  it('windows DefiLlama hacks and treats NVD times as UTC', () => {
    const ex = parseLlama(fixtureJson(FX.llama), Date.parse('2026-09-30T20:05:00Z'), 120);
    expect(ex.length).toBeGreaterThan(0);
    expect(ex.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.source === 'defillama')).toBe(true);
    const cves = parseNvd(fixtureJson(FX.nvd));
    expect(cves[0]).toMatchObject({ id: 'CVE-2018-1000093', cvss: 8.8, published: '2018-03-13T15:29:01.597Z' });
  });
  it('reads Wikidata country facts, the Wikipedia summary and Open-Meteo', () => {
    expect(parseCountry(fixtureJson(FX.sparqlUA), 'UA')).toMatchObject({ name: 'Ukraine', capital: 'Kyiv', population: 41167335, areaKm2: 603550, languages: ['Ukrainian'], region: 'Europe', wikidataId: 'Q212', headOfState: { name: 'Volodymyr Zelenskyy' } });
    expect(parseWikiSummary(fixtureJson(FX.wiki))).toMatchObject({ title: 'Kyiv', url: 'https://en.wikipedia.org/wiki/Kyiv' });
    expect(parseOpenMeteo({ current: { time: '2026-09-30T20:00', temperature_2m: 11.2, wind_speed_10m: 9, weather_code: 3 } })).toEqual({ temperatureC: 11.2, windKmh: 9, code: 3, observedAt: '2026-09-30T20:00:00.000Z' });
  });
  it('follows Wikidata claims with provenance per link', () => {
    const q95 = fixtureJson<{ entities: { Q95: Parameters<typeof wikidataLinks>[0] } }>(FX.wdQ95).entities.Q95;
    const links = wikidataLinks(q95, 'company');
    expect(links.length).toBeGreaterThan(3);
    expect(links.every((l) => /^wikidata:Q95#P\d+$/.test(l.provenance) && /^Q\d+$/.test(l.target))).toBe(true);
    expect(links.filter((l) => l.relation === 'subsidiary').length).toBeLessThanOrEqual(8);
    expect(canonicalId('asn', '15169')).toBe('AS15169');
    expect(canonicalId('person', 'Vladimir Putin')).toBeNull();
    expect(canonicalId('ip', '8.8.8.8')).toBe('8.8.8.8');
    expect(canonicalId('country', 'ua')).toBe('UA');
  });
  it('reports an offline or unregistered layer as offline with count null, never 0', () => {
    expect(nearbyFromResult(null, 50, 30, 150)).toEqual({ count: null, state: 'offline', points: [] });
    const meta = { state: 'stale' } as never;
    expect(nearbyFromResult({ data: null, meta: { ...(meta as object), state: 'offline' } as never, providers: {} }, 50, 30, 150).count).toBeNull();
    const pts = extractPoints({ items: [{ id: 'a', lat: 50.4, lng: 30.5, title: 'near' }, { id: 'b', lat: 10, lng: 10, title: 'far' }] })!;
    expect(pts).toHaveLength(2);
    const n = nearbyFromResult({ data: { items: pts }, meta: { state: 'live' } as never, providers: {} }, 50.45, 30.52, 150);
    expect(n).toMatchObject({ count: 1, state: 'live' });
  });
  it('flags supplier sites near strong quakes (method stated)', () => {
    const items = assess([{ magnitude: 6.4, place: 'Hualien', lat: 24.0, lng: 121.6, observedAt: '2026-09-30T10:00:00Z' }], []);
    const tsmc = items.find((i) => i.id === 'tsmc-hsinchu')!;
    expect(tsmc.riskLevel).toBe('CRITICAL');
    expect(assess([{ magnitude: 5.0, place: 'offshore', lat: 23.5, lng: 121.9, observedAt: null }], []).find((i) => i.id === 'tsmc-hsinchu')!.riskLevel).toBe('HIGH');
    expect(tsmc.threats[0]!.method).toMatch(/USGS/);
    expect(items.find((i) => i.id === 'asml-veldhoven')!.riskLevel).toBe('NORMAL');
  });
});
