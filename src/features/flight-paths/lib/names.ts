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

/**
 * The town(s) an OurAirports municipality names: the text before any "(" or ",", split at "/"
 * ("Pau/Pyrénées (Uzein)" → Pau, Pyrénées; "Hobart (Cambridge)" → Hobart; "Manchester, Greater
 * Manchester" → Manchester). What follows is a suburb or a county, not the town the airport is in.
 */
export function townsOf(municipality: string): string[] {
  return municipality
    .split(/[(,]/)[0]!
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** `nameRank` values. */
export const NAME_RANK = { town: 5, townPart: 4, municipality: 3, name: 2, keyword: 1, none: 0 } as const;

/**
 * How strongly a record carries the typed name (round 5 B2 follow-up): 5 it is its town (Sofia
 * Airport, municipality "Sofia"), 4 its town's name holds it ("George Town", "Kos Island"), 3
 * elsewhere in its municipality ("Hobart (Cambridge)"), 2 in its airport name (Hartsfield–Jackson
 * Atlanta), 1 only in a keyword (Tenerife Sur, keyword "Reina Sofía"), 0 not at all. A person's name in
 * an airport's name must not rank with the city that bears it.
 */
export function nameRank(a: NamedFields, typed: string): number {
  if (a.municipality) {
    const towns = townsOf(a.municipality);
    const compact = (s: string) => foldName(s).replace(/ /g, '');
    if (towns.some((x) => compact(x) === compact(typed))) return NAME_RANK.town;
    if (towns.some((x) => hasWords(x, typed))) return NAME_RANK.townPart;
    if (hasWords(a.municipality, typed)) return NAME_RANK.municipality;
  }
  if (a.name && hasWords(a.name, typed)) return NAME_RANK.name;
  return a.keywords && a.keywords.split(',').some((k) => hasWords(k, typed)) ? NAME_RANK.keyword : NAME_RANK.none;
}

/** The typed words open `field` ("Goa Dabolim International" for "Goa", "Kos Island" for "Kos"; not "Isle of Man" for "Man"). */
export function leadsWith(field: string, typed: string): boolean {
  const w = words(field);
  const t = words(typed);
  if (!t.length || !w.length) return false;
  if (t.length <= w.length && t.every((x, k) => w[k] === x)) return true;
  const compact = t.join('');
  let run = '';
  for (const x of w) {
    run += x;
    if (run === compact) return true;
    if (run.length >= compact.length) return false;
  }
  return false;
}

/** Some field of the record (a town, the airport name, a keyword) opens with the typed words. */
export function ledBy(a: NamedFields, typed: string): boolean {
  const fields = [...(a.municipality ? townsOf(a.municipality) : []), a.name ?? '', ...(a.keywords ? a.keywords.split(',') : [])];
  return fields.some((f) => leadsWith(f, typed));
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

/**
 * How the text was typed, for an input that is also an exact airport code:
 *  - `code`: in capitals, or with digits/hyphens ("GOA", "EGLL", "Y12") — the code it spells;
 *  - `lower-code`: three lower-case letters ("lhr", "goa") — usually a code typed in a hurry, so a
 *    namesake city wins only by asking;
 *  - `word`: anything else ("Goa", "Leh", "Sylt", "lima") — a name first.
 */
export type TypedAs = 'code' | 'lower-code' | 'word';

export function typedAs(q: string): TypedAs {
  const t = q.trim();
  if (/^[a-z]{3}$/.test(t)) return 'lower-code';
  return t === t.toUpperCase() ? 'code' : 'word';
}
