/**
 * Alert digest (port of the OSIRIS alert-digest algorithm, dossier 14 §3–§6): keyword clustering of
 * Live Alerts into theatre threads with perspective (cross / single / mixed), a coverage summary, a
 * seismic line and a bottom line. It GROUPS reports; it does not verify them — the method line says
 * so, and the output is labelled ANALYST (heuristic), never "AI". Fixes vs OSIRIS: the quake line
 * states the magnitude floor it was actually given instead of a hard-coded "M2.5+".
 * Owner: panels-alerts-markets-dossier-graph. Isomorphic (pure).
 */
import type { AlertItem } from '@/lib/types';
import { THEATRES, TOPICS, classify } from './classify';
import { leadEligible, sourceRank } from './lead-filter';

export type Bloc = AlertItem['bloc'];

/**
 * Neutral names for the four digest groups. A group is only how the digest tells whether a story
 * crosses sides (cross / single / mixed); it is not a source's perspective and is never printed as
 * one. OSIRIS's names ('Western / Ukrainian', 'Regional (Turkey, Middle East)') put BBC and DW in a
 * "Ukrainian" perspective and SCMP, CNA and Africanews in a "Turkey, Middle East" one (r8); a name
 * like "non-aligned" would do the same to Times of Israel or Press TV. Each source's declared
 * stance is its own `lean`, shown with `sourceWithStance()`.
 */
export const BLOC_LABEL: Record<Bloc, string> = {
  western: 'Western',
  russian: 'Russian-aligned',
  regional: 'Regional',
  independent: 'Independent aggregator',
};

/** "South China Morning Post (Hong Kong newspaper)": a source with its own declared stance. */
export function sourceWithStance(r: Pick<AlertItem, 'sourceName' | 'lean'>): string {
  return `${r.sourceName} (${r.lean})`;
}

export interface DigestQuake {
  magnitude: number;
  place: string | null;
  observedAt: string | null;
  url: string | null;
  tsunami?: boolean;
}

export interface AlertThread {
  id: string;
  label: string;
  count: number;
  itemIds: string[];
  sources: string[];
  blocs: Partial<Record<Bloc, number>>;
  perspective: 'cross' | 'single' | 'mixed';
  topics: string[];
  breaking: number;
  latest: string | null;
  lead: { id: string; title: string; source: string; link: string; publishedAt: string } | null;
}

export interface AlertBrief {
  bottomLine: string;
  threads: AlertThread[];
  seismic: { count: number; significant: number; minMagnitude: number; strongest: DigestQuake | null } | null;
  coverage: { reports: number; channels: number; blocs: Partial<Record<Bloc, number>>; newest: string | null; oldest: string | null; breaking: number; corroborated: number };
  facts: string[];
  highlights: string[];
  method: string;
}

export const DIGEST_METHOD = 'Keyword clustering by theatre and topic over the reports in the feed. Groups reports; does not verify them.';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function timeAgo(iso: string | null, now: number): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const m = Math.max(0, Math.round((now - t) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const channelsOf = (r: AlertItem) => [r.sourceName, ...r.alsoReportedBy.map((a) => a.sourceName)];

export function perspectivePhrase(t: Pick<AlertThread, 'perspective' | 'blocs'>): string {
  if (t.perspective === 'cross') return `carried by both ${BLOC_LABEL.western} and ${BLOC_LABEL.russian} channels`;
  if (t.perspective === 'single') {
    const b = Object.keys(t.blocs)[0] as Bloc | undefined;
    return b ? `only channels in the ${BLOC_LABEL[b]} group are carrying it` : 'mixed sourcing';
  }
  return 'mixed sourcing';
}

/** The theatre (among `ids`) whose keywords appear earliest in `text`. */
export function primaryTheatre(text: string, ids: readonly string[]): string | null {
  let best: string | null = null;
  let at = Infinity;
  for (const id of ids) {
    const re = THEATRES.find((t) => t.id === id)?.re;
    if (!re) continue;
    const m = new RegExp(re.source, re.flags.replace('g', '')).exec(text);
    if (m && m.index < at) {
      at = m.index;
      best = id;
    }
  }
  return best;
}

export function buildThreads(reports: readonly AlertItem[], limit = 6): AlertThread[] {
  const byTheatre = new Map<string, { reports: AlertItem[]; topics: Map<string, number> }>();
  /** Each report's first theatre (earliest match in title, then summary): what it is primarily about. */
  const primary = new Map<string, string>();
  for (const r of reports) {
    const text = `${r.title}\n${(r.summary ?? '').slice(0, 800)}`;
    const { theatres, topics } = classify(text);
    const first = primaryTheatre(text, theatres);
    if (first) primary.set(r.id, first);
    for (const th of theatres) {
      const e: { reports: AlertItem[]; topics: Map<string, number> } = byTheatre.get(th) ?? { reports: [], topics: new Map() };
      e.reports.push(r);
      for (const tp of topics) e.topics.set(tp, (e.topics.get(tp) ?? 0) + 1);
      byTheatre.set(th, e);
    }
  }
  const threads: AlertThread[] = [];
  for (const [id, e] of byTheatre) {
    const sources = new Set<string>();
    const blocs: Partial<Record<Bloc, number>> = {};
    for (const r of e.reports) {
      for (const c of channelsOf(r)) sources.add(c);
      blocs[r.bloc] = (blocs[r.bloc] ?? 0) + 1;
      for (const a of r.alsoReportedBy) blocs[a.bloc] = (blocs[a.bloc] ?? 0) + 1;
    }
    const perspective: AlertThread['perspective'] = blocs.western && blocs.russian ? 'cross' : e.reports.length >= 2 && Object.keys(blocs).length === 1 ? 'single' : 'mixed';
    const latest = e.reports.reduce<number | null>((m, r) => Math.max(m ?? 0, Date.parse(r.publishedAt)), null);
    threads.push({
      id,
      label: THEATRES.find((t) => t.id === id)!.label,
      count: e.reports.length,
      itemIds: e.reports.map((r) => r.id),
      sources: [...sources].sort(),
      blocs,
      perspective,
      topics: [...e.topics.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([tp]) => TOPICS.find((t) => t.id === tp)!.label),
      breaking: e.reports.filter((r) => r.breaking).length,
      latest: latest ? new Date(latest).toISOString() : null,
      lead: null,
    });
  }
  const ranked = threads.sort((a, b) => b.count - a.count || b.sources.length - a.sources.length || Date.parse(b.latest ?? '0') - Date.parse(a.latest ?? '0')).slice(0, limit);
  // Leads in rank order: never reuse a report that already leads another theatre, and prefer
  // reports whose first theatre is this one (a Lebanon post that also mentions the U.S. must not
  // lead "U.S. policy"), then wire headlines over channel posts. Reports with a slur or hate term
  // are never promoted (lead-filter.ts; their text is left untouched in the feed). No eligible
  // report → no lead, rather than a misleading one.
  const used = new Set<string>();
  const byId = new Map(reports.map((r) => [r.id, r]));
  for (const t of ranked) {
    const lead =
      t.itemIds
        .map((id) => byId.get(id)!)
        .filter((r) => !used.has(r.id) && leadEligible(r))
        .sort((a, b) => Number(primary.get(b.id) === t.id) - Number(primary.get(a.id) === t.id) || sourceRank(a) - sourceRank(b) || b.alsoReportedBy.length - a.alsoReportedBy.length || Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0] ?? null;
    if (lead) {
      used.add(lead.id);
      t.lead = { id: lead.id, title: lead.title, source: lead.sourceName, link: lead.link, publishedAt: lead.publishedAt };
    }
  }
  return ranked;
}

export function buildAlertBrief(input: { news?: readonly AlertItem[]; quakes?: readonly DigestQuake[]; quakeMinMagnitude?: number }, now = Date.now()): AlertBrief {
  const reports = (input.news ?? []).filter((r) => r.title);
  const quakes = (input.quakes ?? []).filter((q) => Number.isFinite(q.magnitude));
  const minMag = input.quakeMinMagnitude ?? 2.5;
  const threads = buildThreads(reports);

  const channels = new Set<string>();
  const blocs: Partial<Record<Bloc, number>> = {};
  let newest: number | null = null;
  let oldest: number | null = null;
  for (const r of reports) {
    for (const c of channelsOf(r)) channels.add(c);
    blocs[r.bloc] = (blocs[r.bloc] ?? 0) + 1;
    const t = Date.parse(r.publishedAt);
    newest = newest === null ? t : Math.max(newest, t);
    oldest = oldest === null ? t : Math.min(oldest, t);
  }
  const breaking = reports.filter((r) => r.breaking).length;
  const corroborated = reports.filter((r) => r.alsoReportedBy.length > 0).length;
  const coverage = { reports: reports.length, channels: channels.size, blocs, newest: newest !== null ? new Date(newest).toISOString() : null, oldest: oldest !== null ? new Date(oldest).toISOString() : null, breaking, corroborated };

  let seismic: AlertBrief['seismic'] = null;
  if (quakes.length) {
    const strongest = [...quakes].sort((a, b) => b.magnitude - a.magnitude)[0]!;
    seismic = { count: quakes.length, significant: quakes.filter((q) => q.magnitude >= 5).length, minMagnitude: minMag, strongest: { ...strongest, place: strongest.place ?? 'unknown location', tsunami: Boolean(strongest.tsunami) } };
  }

  const facts: string[] = [];
  if (reports.length) {
    const spanH = newest !== null && oldest !== null ? Math.max(1, Math.round((newest - oldest) / 3600_000)) : null;
    facts.push(`${plural(reports.length, 'report')} from ${plural(channels.size, 'channel')}${spanH ? ` spanning ${spanH}h` : ''}; newest ${timeAgo(coverage.newest, now)}.`);
    if (breaking) facts.push(`${breaking} flagged as breaking by the channel that posted ${breaking === 1 ? 'it' : 'them'}.`);
    if (corroborated) facts.push(`${plural(corroborated, 'story', 'stories')} carried by more than one channel.`);
    for (const t of threads) {
      facts.push(`${t.label}: ${plural(t.count, 'report')} from ${plural(t.sources.length, 'channel')}${t.topics.length ? ` — ${t.topics.join(', ')}` : ''}; ${perspectivePhrase(t)}.${t.lead ? ` Lead: "${t.lead.title}" (${t.lead.source}).` : ''}`);
    }
  }
  if (seismic?.strongest) {
    const s = seismic.strongest;
    facts.push(`${plural(seismic.count, 'earthquake')} M${minMag.toFixed(1)}+ in the feed; strongest M${s.magnitude.toFixed(1)} ${s.place}${s.observedAt ? ` (${timeAgo(s.observedAt, now)})` : ''}${s.tsunami ? ', tsunami flag set' : ''}.`);
  }

  const highlights = threads.slice(0, 3).map((t) => `${t.label} · ${t.count}`);
  if (seismic?.strongest && seismic.strongest.magnitude >= 5) highlights.push(`M${seismic.strongest.magnitude.toFixed(1)} quake`);
  if (breaking) highlights.push(`${breaking} breaking`);

  let bottomLine: string;
  if (!reports.length && !quakes.length) bottomLine = 'No reports in the current feed window.';
  else if (threads.length) {
    const top = threads[0]!;
    const also = threads.slice(1, 3).map((t) => `${t.label} (${t.count})`);
    bottomLine = `${top.label} leads the feed: ${plural(top.count, 'report')} from ${plural(top.sources.length, 'channel')}, ${perspectivePhrase(top)}.${also.length ? ` Also active: ${also.join(', ')}.` : ''}`;
  } else if (reports.length) bottomLine = `${plural(reports.length, 'report')} in the feed, none tied to a tracked theatre.`;
  else bottomLine = 'No news reports in the current feed window.';
  if (seismic?.strongest && seismic.strongest.magnitude >= 5) bottomLine += ` Strongest quake: M${seismic.strongest.magnitude.toFixed(1)} ${seismic.strongest.place}.`;

  return { bottomLine, threads, seismic, coverage, facts, highlights, method: DIGEST_METHOD };
}
