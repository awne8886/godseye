/**
 * r8 MAJOR: a source's perspective is its own declared stance (`lean`), never the name of the
 * digest group it sits in. OSIRIS's group names printed "South China Morning Post (Regional (Turkey,
 * Middle East))" and "France 24 (Western / Ukrainian)" in the chat ANALYST and in model prompts.
 * Items come from recorded wire feeds (SCMP, Africanews 2026-10-02; BBC 2026-09-30) and a recorded
 * Kyiv Independent channel page; no network.
 */
import { describe, expect, it } from 'vitest';
import { parseFeed } from '@/lib/rss';
import type { AlertItem, Quote } from '@/lib/types';
import { FX, fixtureText } from '../__fixtures__';
import { briefingPrompt, chatPrompt, overviewPrompt, type Snapshot } from './ai-context';
import { BLOC_LABEL, itemCorroboration, perspectivePhrase, sourceWithStance, threadMixPhrase } from './digest';
import { ALL_SOURCES, TELEGRAM_CHANNELS, WIRE_FEEDS, fromTelegram, fromWire, latestChannelPosts } from './news';

const src = (h: string) => [...WIRE_FEEDS, ...TELEGRAM_CHANNELS].find((s) => s.handle === h)!;
const wire = (fx: string, handle: string) =>
  parseFeed(fixtureText(fx))
    .map((it) => fromWire(it, src(handle)))
    .filter((x): x is AlertItem => x !== null);

const scmp = wire(FX.scmp, 'scmp');
const africanews = wire(FX.africanews, 'africanews');
const bbc = wire(FX.bbc, 'bbc');
const kyiv = latestChannelPosts(fixtureText(FX.tgKyiv), 'KyivIndependent_official').map((p) => fromTelegram(p, src('KyivIndependent_official')));
const news = [...scmp, ...africanews, ...bbc, ...kyiv];
const snap: Snapshot = { news, quakes: [], quotes: [], chain: null, kp: null };
const NOW = Date.parse('2026-10-02T10:30:00Z');

/** The perspective claims the OSIRIS group names made. */
const MISATTRIBUTION = /Turkey|Middle East\)|Western \/ Ukrainian|non-aligned/;

describe('source attribution in AI prompts and the ANALYST (r8)', () => {
  it('captures recorded items from each source', () => {
    expect(scmp.length).toBeGreaterThan(0);
    expect(africanews.length).toBeGreaterThan(0);
    expect(bbc.length).toBeGreaterThan(0);
    expect(kyiv.length).toBeGreaterThan(0);
  });

  it('chat ANALYST names each source with its own declared stance', () => {
    const p = chatPrompt([{ role: 'user', content: 'Taiwan F-16V delivery and Kaliningrad weapons? Also the Flydubai stabbing.' }], snap, NOW);
    expect(p.analystText).toContain('South China Morning Post (Hong Kong newspaper)');
    expect(p.analystText).toContain('Africanews (Pan-African broadcaster)');
    expect(p.analystText).toContain('BBC World (UK public broadcaster)');
    expect(p.analystText).not.toMatch(MISATTRIBUTION);
    for (const g of Object.values(BLOC_LABEL)) expect(p.analystText).not.toContain(`(${g})`);
    // The model's context carries the same stance, with the group named as a group.
    expect(p.system).toContain('South China Morning Post (stance: Hong Kong newspaper; digest group: Regional)');
    expect(p.system).not.toMatch(MISATTRIBUTION);
  });

  it('every headline row in a model prompt carries that source’s own lean', () => {
    const p = overviewPrompt('alerts', snap, NOW);
    const prompt = p.turns[0]!.content;
    for (const it of news.slice(0, 40)) {
      const row = prompt.split('\n').find((l) => l.startsWith(`- [news:${it.id}]`));
      if (!row) continue; // only the 40 newest rows are listed
      expect(row).toContain(`${it.sourceName} (stance: ${it.lean}; digest group: ${BLOC_LABEL[it.bloc]})`);
    }
    expect(prompt).toContain('Kyiv Independent (stance: Ukrainian newsroom; digest group: Western)');
    expect(prompt).toContain('BBC World (stance: UK public broadcaster; digest group: Western)');
    expect(prompt).not.toMatch(MISATTRIBUTION);
    expect(p.system).toMatch(/declared stance/);
  });

  it('group names are neutral and every source line uses the source’s own lean', () => {
    expect(BLOC_LABEL).toEqual({ western: 'Western', russian: 'Russian-aligned', regional: 'Regional', independent: 'Independent aggregator' });
    for (const s of ALL_SOURCES) expect(sourceWithStance({ sourceName: s.name, lean: s.lean })).toBe(`${s.name} (${s.lean})`);
    expect(perspectivePhrase({ perspective: 'single', blocs: { regional: 3 } })).toBe('only channels in the Regional group are carrying it');
    expect(perspectivePhrase({ perspective: 'cross', blocs: { western: 1, russian: 1 } })).toBe('carried by both Western and Russian-aligned channels');
  });
});

/**
 * r10 MAJOR: a briefing PIR printed a single-source TASS headline as "carried by both sides" because
 * the label came from its thread's bloc mix. Corroboration is now the lead item's own
 * `alsoReportedBy`; the thread's mix is worded as the thread's.
 */
describe('per-item corroboration in briefings (r10)', () => {
  const base = kyiv[0]!;
  const at = (min: number) => new Date(Date.parse('2026-10-02T09:00:00Z') + min * 60_000).toISOString();
  const item = (over: Partial<AlertItem>): AlertItem => ({ ...base, summary: null, breaking: false, alsoReportedBy: [], ...over });
  const tass = item({ id: 'wire:tass/1', sourceKind: 'wire', source: 'tass', sourceName: 'TASS', lean: 'Russian state news agency', bloc: 'russian', link: 'https://tass.com/defense/1', title: 'Latest ground-based complex with LMUR missiles deployed in Ukraine during Center-2026 drills', publishedAt: at(0) });
  const rybar = item({ id: 'tg:rybar/1', source: 't.me/rybar', sourceName: 'Rybar', lean: 'Russian milblogger', bloc: 'russian', link: 'https://t.me/s/rybar/1', title: 'Ukraine front: Russian drones over Kharkiv overnight', publishedAt: at(1) });
  const kyivPost = item({ id: 'tg:kyiv/1', source: 't.me/kyiv', sourceName: 'Kyiv Independent', lean: 'Ukrainian newsroom', bloc: 'western', link: 'https://t.me/s/kyiv/1', title: 'Ukraine: Russian strike on Kharkiv overnight', publishedAt: at(2) });
  const snapOf = (items: AlertItem[]): Snapshot => ({ news: items, quakes: [], quotes: [], chain: null, kp: null });
  const pirsOf = (text: string) => text.split('\n').filter((l) => l.startsWith('• Does independent reporting'));

  it('a single-source lead in a cross-bloc thread never reads "carried by both sides"', () => {
    const p = briefingPrompt('24h', snapOf([tass, rybar, kyivPost]), NOW);
    const thread = p.brief!.threads.find((t) => t.id === 'russia-ukraine')!;
    expect(thread.perspective).toBe('cross');
    expect(thread.lead!.id).toBe(tass.id);
    expect(thread.lead!.alsoReportedBy).toEqual([]);
    const pir = pirsOf(p.analystText).find((l) => l.includes(thread.lead!.title))!;
    expect(pir).toContain(`(reported by ${thread.lead!.source} only so far; lead of a thread carried by both sides)`);
    expect(pir).not.toMatch(/\((?:carried by both|also reported)/);
    // Facts (ANALYST and model prompt alike) attribute the thread mix to the thread.
    const fact = p.brief!.facts.find((f) => f.startsWith(thread.label))!;
    expect(fact).toContain('; thread carried by both');
    expect(fact).toContain(`(reported by ${thread.lead!.source} only so far)`);
    // Headline rows tell the model the item has no other channel.
    const row = p.turns[0]!.content.split('\n').find((l) => l.startsWith(`- [news:${thread.lead!.id}]`))!;
    expect(row).toContain('no other channel so far');
    expect(p.system).toMatch(/never one headline/);
  });

  it('a corroborated lead names its corroborating sources', () => {
    const corroborated = { ...tass, alsoReportedBy: [{ source: 'rt', sourceName: 'RT', lean: 'Russian state broadcaster', bloc: 'russian' as const, link: 'https://rt.com/1', publishedAt: at(3) }, { source: 'reuters', sourceName: 'Reuters', lean: 'International wire', bloc: 'western' as const, link: 'https://reuters.com/1', publishedAt: at(4) }] };
    const p = briefingPrompt('24h', snapOf([corroborated, rybar, kyivPost]), NOW);
    const thread = p.brief!.threads.find((t) => t.id === 'russia-ukraine')!;
    expect(thread.lead!.id).toBe(corroborated.id);
    expect(thread.lead!.alsoReportedBy).toEqual(['RT', 'Reuters']);
    const pir = pirsOf(p.analystText).find((l) => l.includes(corroborated.title))!;
    expect(pir).toContain('(TASS; also reported by RT, Reuters; lead of a thread carried by both sides)');
    const row = p.turns[0]!.content.split('\n').find((l) => l.startsWith(`- [news:${corroborated.id}]`))!;
    expect(row).toContain('also reported by RT, Reuters');
  });

  it('thread-mix wording is about the thread for every perspective', () => {
    expect(threadMixPhrase({ perspective: 'single', blocs: { russian: 2 } })).toBe('lead of a thread carried by one side only so far');
    expect(threadMixPhrase({ perspective: 'mixed', blocs: { regional: 1 } })).toBe('lead of a thread with mixed sourcing');
    expect(itemCorroboration({ source: 'TASS', alsoReportedBy: [] })).toBe('reported by TASS only so far');
  });
});

/**
 * r11 MINOR: the ANALYST called a risk-on day "risk-off breadth" by counting every instrument's sign
 * alike — the VIX falling 6.59 % was a 'down' vote. Values are the live build's 2026-10-02 quotes.
 */
describe('market read-out never labels risk from mixed instruments (r11)', () => {
  const q = (symbol: string, name: string, group: Quote['group'], changePct: number): Quote => ({ symbol, name, group, price: 100, changePct, currency: 'USD', spark: [], marketOpen: true, observedAt: '2026-10-02T15:00:00.000Z', source: 'yahoo', unofficial: true });
  const quotes: Quote[] = [
    q('^GSPC', 'S&P 500', 'indices', 0.73), q('^IXIC', 'Nasdaq Comp', 'indices', 1.19), q('^DJI', 'Dow Jones', 'indices', 0.41), q('^VIX', 'VIX', 'indices', -6.59),
    q('EURUSD=X', 'EUR/USD', 'fx', -0.2), q('GBPUSD=X', 'GBP/USD', 'fx', -0.3), q('USDJPY=X', 'USD/JPY', 'fx', -0.1), q('DX-Y.NYB', 'US Dollar Index', 'fx', -0.15),
    q('GC=F', 'Gold', 'commodities', -0.8), q('SI=F', 'Silver', 'commodities', -1.1), q('CL=F', 'WTI Crude', 'energy', -0.5),
  ];
  const s: Snapshot = { news: [], quakes: [], quotes, chain: null, kp: null };

  it('briefing MARKETS keeps the counts, drops the label and reads equities on their own', () => {
    const p = briefingPrompt('24h', s, NOW);
    expect(p.analystText).toContain('11 instruments tracked — 3 up / 8 down.');
    expect(p.analystText).toContain('Equity indices: 3 of 3 up (S&P 500 +0.73%, Nasdaq Comp +1.19%, Dow Jones +0.41%).');
    expect(p.analystText).toContain('VIX -6.59%.');
    for (const text of [p.analystText, p.turns[0]!.content]) expect(text).not.toMatch(/risk-o(?:n|ff)|breadth/i);
  });

  it('markets overview bottom line is about equity indices, not the whole tape', () => {
    const p = overviewPrompt('markets', s, NOW);
    expect(p.analystText.split('\n')[0]).toBe('Equity indices are mostly higher.');
    expect(p.analystText).not.toMatch(/tape is|risk-o(?:n|ff)/i);
    const noEq = overviewPrompt('markets', { ...s, quotes: quotes.filter((x) => x.group !== 'indices') }, NOW);
    expect(noEq.analystText.split('\n')[0]).toBe('No equity index is priced right now.');
  });
});
