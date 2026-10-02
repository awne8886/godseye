/**
 * r8 MAJOR: a source's perspective is its own declared stance (`lean`), never the name of the
 * digest group it sits in. OSIRIS's group names printed "South China Morning Post (Regional (Turkey,
 * Middle East))" and "France 24 (Western / Ukrainian)" in the chat ANALYST and in model prompts.
 * Items come from recorded wire feeds (SCMP, Africanews 2026-10-02; BBC 2026-09-30) and a recorded
 * Kyiv Independent channel page; no network.
 */
import { describe, expect, it } from 'vitest';
import { parseFeed } from '@/lib/rss';
import type { AlertItem } from '@/lib/types';
import { FX, fixtureText } from '../__fixtures__';
import { chatPrompt, overviewPrompt, type Snapshot } from './ai-context';
import { BLOC_LABEL, perspectivePhrase, sourceWithStance } from './digest';
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
