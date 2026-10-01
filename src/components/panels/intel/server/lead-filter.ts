/**
 * Lead-quality filter for the ANALYST digest (R3 round-2 m6). The digest picks one report per
 * theatre as its "lead"; that choice is ours, so a report containing a slur or hate term (list and
 * its source in `../data/lead-stoplist.json`) is never promoted. The report stays in the feed with
 * its original text — this only decides what the digest quotes. Wire headlines outrank channel
 * posts when choosing a lead. Owner: panels-alerts-markets-dossier-graph. Isomorphic (pure).
 *
 * Matching (round 4): whole words only — `word` (+ optional listed endings), `forms` (an explicit
 * list of inflected forms) or `prefix` (only for terms no ordinary word or name starts with).
 * `case: "lower"` terms are also surnames or place names when capitalised (Москаль, Хохол, Хохлов)
 * and match only in lower case. Mixed-script words (Latin + Cyrillic look-alikes, e.g. `pаjeet`
 * with a Cyrillic а) are folded to each script before matching; single-script words never are, so
 * an ordinary word in one script cannot turn into a term of the other.
 */
import type { AlertItem } from '@/lib/types';
import stoplist from '../data/lead-stoplist.json';

export interface StopTerm {
  term: string;
  match: 'word' | 'prefix' | 'forms';
  endings?: string[];
  forms?: string[];
  case?: 'any' | 'lower';
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function alternative(t: StopTerm, lower: boolean): string {
  const norm = (s: string) => esc(lower ? s : s.toLowerCase());
  const base = norm(t.term);
  if (t.match === 'prefix') return `${base}[\\p{L}\\p{N}]*`;
  if (t.match === 'forms') return [t.term, ...(t.forms ?? [])].map(norm).join('|');
  const ends = (t.endings ?? []).map(norm);
  return ends.length ? `${base}(?:${ends.join('|')})?` : base;
}

/** Unicode-aware word boundaries (JS `\b` is ASCII-only and misses Cyrillic). Null when no terms. */
export function stopPattern(terms: readonly StopTerm[], opts: { caseSensitive?: boolean } = {}): RegExp | null {
  if (!terms.length) return null;
  const alts = terms.map((t) => alternative(t, opts.caseSensitive === true));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join('|')})(?![\\p{L}\\p{N}])`, opts.caseSensitive ? 'u' : 'iu');
}

const TERMS = stoplist.terms as StopTerm[];
const ANY_CASE = stopPattern(TERMS.filter((t) => t.case !== 'lower'));
const LOWER_ONLY = stopPattern(
  TERMS.filter((t) => t.case === 'lower'),
  { caseSensitive: true },
);

// Lower-case look-alikes between Cyrillic and Latin (Unicode confusables, the common subset).
const CYR_TO_LAT: Record<string, string> = { а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', к: 'k', і: 'i', ј: 'j', ѕ: 's', һ: 'h', ԁ: 'd', ԛ: 'q', ԝ: 'w', ӏ: 'l' };
const LAT_TO_CYR: Record<string, string> = Object.fromEntries(Object.entries(CYR_TO_LAT).map(([c, l]) => [l, c]));
const HAS_LATIN = /\p{Script=Latin}/u;
const HAS_CYRILLIC = /\p{Script=Cyrillic}/u;

/** The text with every mixed-script word folded to one script (other words unchanged). */
export function foldMixedScript(text: string, to: 'latin' | 'cyrillic'): string {
  const map = to === 'latin' ? CYR_TO_LAT : LAT_TO_CYR;
  const swap = (ch: string) => {
    const lo = ch.toLowerCase();
    const m = map[lo];
    return m === undefined ? ch : ch === lo ? m : m.toUpperCase(); // keep the letter's case
  };
  return text.replace(/[\p{L}\p{M}]+/gu, (w) => (HAS_LATIN.test(w) && HAS_CYRILLIC.test(w) ? [...w].map(swap).join('') : w));
}

/** True when the text contains a listed slur or hate term. */
export function hasStopTerm(text: string): boolean {
  const base = text.normalize('NFKC');
  const variants = [base];
  if (HAS_LATIN.test(base) && HAS_CYRILLIC.test(base)) variants.push(foldMixedScript(base, 'latin'), foldMixedScript(base, 'cyrillic'));
  return variants.some((v) => (ANY_CASE?.test(v) ?? false) || (LOWER_ONLY?.test(v) ?? false));
}

/** May this report be quoted as a digest lead? */
export function leadEligible(r: Pick<AlertItem, 'title' | 'summary'>): boolean {
  return !hasStopTerm(`${r.title}\n${r.summary ?? ''}`);
}

/** Lead preference between two eligible reports of a theatre: wire before channel post. */
export function sourceRank(r: Pick<AlertItem, 'sourceKind'>): number {
  return r.sourceKind === 'wire' ? 0 : 1;
}
