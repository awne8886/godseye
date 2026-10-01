/**
 * Does an airport record carry the name a visitor typed? (round 5 B2). Shared by the airport search
 * ranking (server) and the palette's place resolution (client), so both read a name the same way.
 * Isomorphic and pure. Owner: feature-flight-paths.
 *
 * Text is folded (accents and case dropped; any run of punctuation or spaces becomes one space:
 * "St. Petersburg" ≡ "st petersburg", "Zürich" ≡ "zurich") and compared WORD BY WORD: the typed
 * words must appear consecutively in one field ("Sydney" in "Sydney (Mascot)", not "Xian" in
 * "Xiangyang"), or the typed text without spaces must equal a run of the field's words ("Xian" ≡
 * "Xi'an"). OurAirports keywords are a comma-separated list: each entry is its own field.
 */

/** Case-, accent- and punctuation-folded text ("  Zürich-Flughafen " → "zurich flughafen"). */
export function foldName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const words = (s: string): string[] => {
  const f = foldName(s);
  return f ? f.split(' ') : [];
};

/** The typed words as consecutive whole words of `field` (or, spaces removed, a run of its words). */
export function hasWords(field: string, typed: string): boolean {
  const w = words(field);
  const t = words(typed);
  if (!t.length || !w.length) return false;
  const compact = t.join('');
  for (let i = 0; i < w.length; i++) {
    if (i + t.length <= w.length && t.every((x, k) => w[i + k] === x)) return true;
    let run = '';
    for (let j = i; j < w.length && run.length < compact.length; j++) {
      run += w[j];
      if (run === compact) return true;
    }
  }
  return false;
}

export interface NamedFields {
  name?: string | null;
  municipality?: string | null;
  keywords?: string | null;
}

export type NameField = 'municipality' | 'name' | 'keywords';

/** Which field carries the typed name (municipality first, then the airport name, then a keyword), or null. */
export function nameMatch(a: NamedFields, typed: string): NameField | null {
  if (a.municipality && hasWords(a.municipality, typed)) return 'municipality';
  if (a.name && hasWords(a.name, typed)) return 'name';
  if (a.keywords && a.keywords.split(',').some((k) => hasWords(k, typed))) return 'keywords';
  return null;
}

/** OurAirports size class as a rank (large 3, medium 2, anything else 1). */
export function sizeRank(type: string): number {
  return type === 'large_airport' ? 3 : type === 'medium_airport' ? 2 : 1;
}

/**
 * A word, not an airport code: four or more letters (no digit, no hyphen) not typed in capitals
 * ("Lima", "bali"). Such input names an ICAO code or ident only when that airport has scheduled
 * service ("egll" is still EGLL); typed in capitals it is a code ("LIMA" is Torino-Aeritalia).
 */
export function wordNotCode(q: string): boolean {
  const t = q.trim();
  return /^[A-Za-z]{4,}$/.test(t) && t !== t.toUpperCase();
}
