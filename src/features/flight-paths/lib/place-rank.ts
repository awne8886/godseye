/**
 * Which airport a typed place name means — shared by the airport search ranking (server) and the
 * palette's place resolution (client), so the type-ahead and "City to City" decide the same way.
 * Isomorphic and pure. Owner: feature-flight-paths.
 *
 * Round 5 B2 follow-up (reviewer sweeps against 4cc233a):
 *  - a city's main airport is ranked scheduled service → size → IATA code → how it carries the name
 *    (its town > part of its town's name > elsewhere in its municipality > its airport name > a
 *    keyword) → VRS services calling there: "Sofia" is SOF, not Tenerife Sur (keyword "Reina
 *    Sofía"); "Malmö" is MMX, not CPH (keyword); "Sucre" is SRE, not Quito's Mariscal Sucre
 *    (`compareMain`); airports of one class serving one area and named for the place go to the
 *    busiest: "Bucharest" is OTP (Henri Coandă), not Băneasa (`mainAmong`);
 *  - an airport that carries the name only in its own name ("Hartsfield Jackson Atlanta", "Nelson
 *    Mandela International") is not silently the answer when a scheduled airport in a town of that
 *    name lies elsewhere: the visitor is asked (`farNamesakes`);
 *  - a short word that is also an airport code ("Goa" = GOA Genoa, "Leh" = LEH Le Havre, "Sylt" =
 *    ICAO SYLT Lethem) yields to the airport that bears the name, unless typed in capitals
 *    (`exactOrName`).
 */
import { distanceKm } from '@/lib/geo';
import { ledBy, nameMatch, nameRank, NAME_RANK, sizeRank, typedAs, type NamedFields } from './names';

/** The fields of a search hit these rules read (the search API sends them all). */
export interface PlaceCandidate extends NamedFields {
  iata: string | null;
  type?: string;
  scheduledService?: boolean;
  lat?: number;
  lng?: number;
  /** VRS standing-data services calling there (bundled REFERENCE count). */
  services?: number;
}

/** Airports this close serve the same place (also the palette's "nearest scheduled airports" radius). */
export const SAME_AREA_KM = 150;

/**
 * Main-airport order with the name ranks already known (negative: x first): scheduled service →
 * size (large > medium > other) → an IATA code (a commercial airport: Kyiv's Zhuliany IEV before the
 * Hostomel airfield, neither with service today) → how it carries the name (`nameRank`) → the VRS
 * services calling there.
 */
export function compareRanked(x: PlaceCandidate, rx: number, y: PlaceCandidate, ry: number): number {
  return (
    Number(!!y.scheduledService) - Number(!!x.scheduledService) ||
    sizeRank(y.type ?? '') - sizeRank(x.type ?? '') ||
    Number(!!y.iata) - Number(!!x.iata) ||
    ry - rx ||
    (y.services ?? 0) - (x.services ?? 0)
  );
}

/** `compareRanked` for the typed name. */
export function compareMain(x: PlaceCandidate, y: PlaceCandidate, typed: string): number {
  return compareRanked(x, nameRank(x, typed), y, nameRank(y, typed));
}

const sameClass = (a: PlaceCandidate, b: PlaceCandidate): boolean =>
  !!a.scheduledService === !!b.scheduledService && sizeRank(a.type ?? '') === sizeRank(b.type ?? '') && !!a.iata === !!b.iata;

const sameArea = (a: PlaceCandidate, b: PlaceCandidate): boolean =>
  a.lat !== undefined && a.lng !== undefined && b.lat !== undefined && b.lng !== undefined && distanceKm([a.lng, a.lat], [b.lng, b.lat]) <= SAME_AREA_KM;

/**
 * The typed name's main airport among hits that carry it: the first by `compareMain` (ties keep the
 * given order), then — among airports of its class in its area that are named for the place (its
 * town or airport name, not a keyword alone) — the one most VRS services call at: "Bucharest" is
 * Henri Coandă (OTP, named "Bucharest …", 5,787 services) rather than Băneasa (BBU, municipality
 * Bucharest, 176); "Malmö" stays MMX (Copenhagen carries "Malmö" as a keyword only).
 */
export function mainAmong<T extends PlaceCandidate>(named: readonly T[], typed: string): T | null {
  let pick: T | null = null;
  for (const a of named) if (!pick || compareMain(a, pick, typed) < 0) pick = a;
  if (!pick) return null;
  let best = pick;
  for (const h of named) {
    if (h === pick || !sameClass(h, pick) || nameRank(h, typed) < NAME_RANK.name || !sameArea(h, pick)) continue;
    if ((h.services ?? 0) > (best.services ?? 0)) best = h;
  }
  return best;
}

/**
 * Planned without asking: scheduled service and large or medium, or a small scheduled field whose
 * municipality carries the typed name (a town's own airport, e.g. Lukla). Anything else is a namesake
 * minor field or a closed/unscheduled airport (round 5 B2: Bankstown for "Sydney"). A hit without
 * `scheduledService`/`type` (an older recording trimmed to the name fields) is judged by its order.
 */
export function isMainAirport(a: PlaceCandidate, typed: string): boolean {
  if (a.scheduledService === undefined || a.type === undefined) return true;
  if (!a.scheduledService) return false;
  return sizeRank(a.type) >= 2 || nameMatch({ municipality: a.municipality }, typed) !== null;
}

/**
 * An exact code hit (`exact`) against the main airport that bears the typed name (`main`, null if
 * none): which one the text means.
 *  - `exact`: typed in capitals, the code's airport carries the name itself, or no main airport
 *    bears the name ("lhr", "LIMA", "Den" → DEN: Den Helder has no scheduled service);
 *  - `name`: the code's airport has no scheduled service ("Leh" → IXL, not Le Havre), or the text is
 *    a word and the name opens one of that airport's names ("Goa" → GOI, "Kos" → KGS, "Sylt" → GWT);
 *  - `ask`: either reading is plausible ("goa" in lower case; "Man": MAN or the Isle of Man).
 */
export function exactOrName(exact: PlaceCandidate, main: PlaceCandidate | null, typed: string): 'exact' | 'name' | 'ask' {
  const as = typedAs(typed);
  if (as === 'code' || nameMatch(exact, typed) !== null || !main || !isMainAirport(main, typed)) return 'exact';
  if (exact.scheduledService === false) return 'name';
  const opens = !!main.iata && ledBy(main, typed);
  if (as === 'word') return opens ? 'name' : 'ask';
  return opens ? 'ask' : 'exact';
}

/**
 * Scheduled airports in a town that carries the typed name more strongly than `pick` does (at least
 * as part of its town's name), away from it (more than `SAME_AREA_KM`, or unknown): "Jackson" → JAN,
 * JAC, MKL against Hartsfield–Jackson Atlanta; "Nelson" → NSN against Nelson Mandela International
 * (Praia); "George" → George, South Africa against George Town, Cayman. Empty when the pick's town IS
 * the name, or when those airports share its area (Bucharest's Băneasa next to Henri Coandă).
 */
export function farNamesakes<T extends PlaceCandidate>(pick: T, named: readonly T[], typed: string): T[] {
  const r = nameRank(pick, typed);
  if (r >= NAME_RANK.town) return [];
  const floor = Math.max(NAME_RANK.townPart, r + 1);
  return named.filter((h) => h !== pick && h.scheduledService === true && nameRank(h, typed) >= floor && !sameArea(h, pick));
}
