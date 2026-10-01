/**
 * Lead-quality filter for the ANALYST digest (R3 round-2 m6). The digest picks one report per
 * theatre as its "lead"; that choice is ours, so a report containing a slur or hate term (list and
 * its source in `../data/lead-stoplist.json`) is never promoted. The report stays in the feed with
 * its original text — this only decides what the digest quotes. Wire headlines outrank channel
 * posts when choosing a lead. Owner: panels-alerts-markets-dossier-graph. Isomorphic (pure).
 */
import type { AlertItem } from '@/lib/types';
import stoplist from '../data/lead-stoplist.json';

interface StopTerm {
  term: string;
  match: 'word' | 'prefix';
  endings?: string[];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Unicode-aware word boundaries (JS `\b` is ASCII-only and misses Cyrillic). */
export function stopPattern(terms: readonly StopTerm[]): RegExp {
  const alts = terms.map((t) => {
    const base = esc(t.term.toLowerCase());
    if (t.match === 'prefix') return `${base}[\\p{L}\\p{N}]*`;
    const ends = (t.endings ?? []).map(esc);
    return ends.length ? `${base}(?:${ends.join('|')})?` : base;
  });
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join('|')})(?![\\p{L}\\p{N}])`, 'iu');
}

const STOP = stopPattern(stoplist.terms as StopTerm[]);

/** True when the text contains a listed slur or hate term. */
export function hasStopTerm(text: string): boolean {
  return STOP.test(text.normalize('NFKC'));
}

/** May this report be quoted as a digest lead? */
export function leadEligible(r: Pick<AlertItem, 'title' | 'summary'>): boolean {
  return !hasStopTerm(`${r.title}\n${r.summary ?? ''}`);
}

/** Lead preference between two eligible reports of a theatre: wire before channel post. */
export function sourceRank(r: Pick<AlertItem, 'sourceKind'>): number {
  return r.sourceKind === 'wire' ? 0 : 1;
}
