/**
 * Keyword classification for Live Alerts: theatres, topics, alert kind and a keyword-count risk
 * score. These are deterministic keyword matches — the method is stated wherever the output is
 * shown and is never called "AI". Matching rules follow OSIRIS alert-digest.ts: a term ending in `$`
 * or of ≤ 3 characters is whole-word; every term starts at a word start ('mali$' ≠ 'malicious').
 * Owner: panels-alerts-markets-dossier-graph. Isomorphic (pure).
 */
import type { AlertItem } from '@/lib/types';

function compile(terms: readonly string[]): RegExp {
  const parts = terms.map((t) => {
    const whole = t.endsWith('$') || t.length <= 3;
    const body = (t.endsWith('$') ? t.slice(0, -1) : t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return whole ? `${body}(?![\\p{L}\\p{N}])` : body;
  });
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${parts.join('|')})`, 'iu');
}

interface Def {
  id: string;
  label: string;
  re: RegExp;
}

const def = (id: string, label: string, terms: readonly string[]): Def => ({ id, label, re: compile(terms) });

export const THEATRES: readonly Def[] = [
  def('russia-ukraine', 'Russia–Ukraine war', ['ukrain', 'kyiv', 'kiev', 'kharkiv', 'odesa', 'odessa', 'donetsk', 'donbas', 'luhansk', 'zaporizh', 'kherson', 'crimea', 'bakhmut', 'pokrovsk', 'kursk', 'belgorod', 'zelensk', 'kremlin', 'putin', 'russia', 'moscow', 'украин', 'кремл', 'росси']),
  def('israel-gaza-lebanon', 'Israel · Gaza · Lebanon', ['israel', 'idf', 'gaza', 'hamas', 'hezbollah', 'lebanon', 'beirut', 'west bank', 'jenin', 'khan younis', 'rafah', 'nabatieh', 'netanyahu', 'tel aviv', 'jerusalem']),
  def('iran-gulf', 'Iran & the Gulf', ['iran', 'tehran', 'irgc', 'khamenei', 'persian gulf', 'strait of hormuz', 'hormuz', 'qatar', 'saudi', 'uae$', 'emirat', 'bahrain', 'oman$']),
  def('yemen-red-sea', 'Yemen & Red Sea', ['yemen', 'houthi', 'ansarallah', 'sanaa', 'hodeidah', 'red sea', 'bab el-mandeb', 'aden$']),
  def('syria-iraq', 'Syria & Iraq', ['syria', 'damascus', 'aleppo', 'idlib', 'iraq', 'baghdad', 'erbil', 'mosul', 'kurd']),
  def('china-pacific', 'China · Taiwan · Pacific', ['china', 'chinese', 'beijing', 'taiwan', 'taipei', 'south china sea', 'pla$', 'philippin', 'japan', 'tokyo']),
  def('korea', 'Korean Peninsula', ['north korea', 'pyongyang', 'dprk', 'kim jong', 'south korea', 'seoul']),
  def('south-asia', 'South & Central Asia', ['india', 'pakistan', 'kashmir', 'afghan', 'kabul', 'taliban', 'bangladesh', 'new delhi', 'islamabad']),
  def('africa', 'Africa', ['sudan', 'khartoum', 'darfur', 'rsf$', 'somalia', 'al-shabaab', 'ethiopia', 'mali$', 'niger$', 'burkina', 'sahel', 'nigeria', 'congo', 'libya', 'tripoli']),
  def('americas', 'Latin America', ['venezuela', 'caracas', 'colombia', 'mexico', 'cartel', 'haiti', 'cuba$', 'brazil', 'argentin']),
  def('europe-nato', 'Europe & NATO', ['nato$', 'european union', 'brussels', 'poland', 'baltic', 'lithuania', 'latvia', 'estonia', 'finland', 'germany', 'france', 'moldova', 'serbia', 'kosovo', 'georgia']),
  def('us-policy', 'U.S. policy', ['pentagon', 'white house', 'washington', 'congress', 'senate', 'state department', 'u.s.', 'us$', 'usa$', 'trump']),
];

export const TOPICS: readonly Def[] = [
  def('drones', 'drones', ['drone', 'uav', 'shahed', 'geran', 'fpv']),
  def('strikes', 'strikes', ['strike', 'missile', 'rocket', 'airstrike', 'shelling', 'bombard', 'explosion', 'blast']),
  def('air-defence', 'air defence', ['air defense', 'air defence', 'intercept', 'iron dome', 'patriot', 's-400', 'sirens$', 'air raid']),
  def('ground', 'ground fighting', ['offensive', 'assault', 'advance', 'frontline', 'front line', 'captured', 'liberated', 'troops', 'battle']),
  def('maritime', 'maritime', ['ship', 'vessel', 'navy', 'naval', 'tanker', 'port$', 'fleet', 'maritime']),
  def('diplomacy', 'diplomacy', ['talks', 'ceasefire', 'negotiat', 'summit', 'minister', 'envoy', 'agreement', 'truce']),
  def('sanctions', 'sanctions', ['sanction', 'embargo', 'export control', 'tariff']),
  def('nuclear', 'nuclear', ['nuclear', 'uranium', 'enrichment', 'iaea', 'zaporizhzhia npp', 'warhead']),
  def('casualties', 'casualties', ['killed', 'dead$', 'deaths', 'wounded', 'injured', 'casualt', 'martyr']),
  def('energy', 'energy', ['oil$', 'gas$', 'pipeline', 'refinery', 'power grid', 'power plant', 'energy', 'blackout']),
  def('cyber', 'cyber', ['cyber', 'hack', 'ddos', 'ransomware', 'malware']),
  def('politics', 'politics & unrest', ['protest', 'election', 'coup', 'parliament', 'resign', 'riot', 'unrest']),
];

export function classify(text: string): { theatres: string[]; topics: string[] } {
  return { theatres: THEATRES.filter((t) => t.re.test(text)).map((t) => t.id), topics: TOPICS.filter((t) => t.re.test(text)).map((t) => t.id) };
}

const ROCKET = compile(['rocket', 'missile', 'sirens$', 'air raid', 'ballistic', 'interceptor', 'intercepted', 'red alert', 'incoming']);
const EVENT = compile(['explosion', 'blast', 'strike', 'attack', 'drone', 'shelling', 'clashes', 'fire$', 'earthquake', 'killed', 'shot', 'raid']);

/** rocket (missile/siren language) > event (kinetic or incident language) > news. */
export function alertKind(text: string): AlertItem['kind'] {
  if (ROCKET.test(text)) return 'rocket';
  if (EVENT.test(text)) return 'event';
  return 'news';
}

/** Weighted keywords for the 1–10 keyword-count score. */
const RISK_TERMS: readonly [string, number][] = [
  ['nuclear', 3], ['ballistic', 3], ['missile', 2], ['rocket', 2], ['airstrike', 2], ['air strike', 2], ['killed', 2], ['casualties', 2], ['explosion', 2],
  ['invasion', 3], ['mobiliz', 2], ['drone', 1], ['strike', 1], ['attack', 1], ['sirens', 1], ['shelling', 1], ['wounded', 1], ['evacuat', 1], ['martial law', 2],
  ['intercept', 1], ['clashes', 1], ['hostage', 2], ['assassinat', 3], ['coup', 3], ['breaking', 1],
];
const RISK_RES = RISK_TERMS.map(([t, w]) => [t, w, compile([t])] as const);

export function riskScore(text: string): AlertItem['risk'] {
  const keywords: string[] = [];
  let score = 1;
  for (const [t, w, re] of RISK_RES) {
    if (re.test(text)) {
      keywords.push(t);
      score += w;
    }
  }
  return { score: Math.min(10, score), method: 'keyword-count', keywords };
}
