/**
 * Multi-airport cities (IATA metropolitan area codes, e.g. LON, NYC, TYO). A query naming the city
 * or its metro code returns the group. Reference data curated from the IATA city-code list; the
 * member airports are resolved against the bundled OurAirports index at request time, so a
 * closed or re-coded airport simply drops out. Owner: feature-flight-paths.
 */

export interface MetroGroup {
  /** IATA metropolitan area code. */
  code: string;
  name: string;
  /** Alternative names people type. */
  aliases: readonly string[];
  /** Member airports (IATA), busiest first. */
  airports: readonly string[];
}

export const METRO_GROUPS: readonly MetroGroup[] = [
  { code: 'LON', name: 'London', aliases: ['greater london'], airports: ['LHR', 'LGW', 'STN', 'LTN', 'LCY', 'SEN'] },
  { code: 'NYC', name: 'New York', aliases: ['new york city', 'nyc'], airports: ['JFK', 'EWR', 'LGA'] },
  { code: 'TYO', name: 'Tokyo', aliases: [], airports: ['HND', 'NRT'] },
  { code: 'PAR', name: 'Paris', aliases: [], airports: ['CDG', 'ORY', 'BVA'] },
  { code: 'MOW', name: 'Moscow', aliases: [], airports: ['SVO', 'DME', 'VKO'] },
  { code: 'CHI', name: 'Chicago', aliases: [], airports: ['ORD', 'MDW'] },
  { code: 'WAS', name: 'Washington', aliases: ['washington dc', 'washington d.c.'], airports: ['IAD', 'DCA', 'BWI'] },
  { code: 'MIL', name: 'Milan', aliases: ['milano'], airports: ['MXP', 'LIN', 'BGY'] },
  { code: 'ROM', name: 'Rome', aliases: ['roma'], airports: ['FCO', 'CIA'] },
  { code: 'STO', name: 'Stockholm', aliases: [], airports: ['ARN', 'BMA', 'NYO'] },
  { code: 'OSL', name: 'Oslo', aliases: [], airports: ['OSL', 'TRF'] },
  { code: 'IST', name: 'Istanbul', aliases: [], airports: ['IST', 'SAW'] },
  { code: 'SAO', name: 'São Paulo', aliases: ['sao paulo'], airports: ['GRU', 'CGH', 'VCP'] },
  { code: 'RIO', name: 'Rio de Janeiro', aliases: ['rio'], airports: ['GIG', 'SDU'] },
  { code: 'BUE', name: 'Buenos Aires', aliases: [], airports: ['EZE', 'AEP'] },
  { code: 'OSA', name: 'Osaka', aliases: [], airports: ['KIX', 'ITM', 'UKB'] },
  { code: 'SEL', name: 'Seoul', aliases: [], airports: ['ICN', 'GMP'] },
  { code: 'BJS', name: 'Beijing', aliases: ['peking'], airports: ['PEK', 'PKX'] },
  { code: 'SHA', name: 'Shanghai', aliases: [], airports: ['PVG', 'SHA'] },
  { code: 'YTO', name: 'Toronto', aliases: [], airports: ['YYZ', 'YTZ'] },
  { code: 'YMQ', name: 'Montreal', aliases: ['montréal'], airports: ['YUL', 'YMX'] },
  { code: 'BKK', name: 'Bangkok', aliases: [], airports: ['BKK', 'DMK'] },
  { code: 'JKT', name: 'Jakarta', aliases: [], airports: ['CGK', 'HLP'] },
  { code: 'TPE', name: 'Taipei', aliases: [], airports: ['TPE', 'TSA'] },
  { code: 'DXB', name: 'Dubai', aliases: [], airports: ['DXB', 'DWC'] },
  { code: 'MEX', name: 'Mexico City', aliases: ['ciudad de mexico', 'ciudad de méxico'], airports: ['MEX', 'NLU'] },
  { code: 'LAX', name: 'Los Angeles', aliases: ['la'], airports: ['LAX', 'BUR', 'LGB', 'SNA', 'ONT'] },
  { code: 'SFO', name: 'San Francisco Bay Area', aliases: ['san francisco', 'bay area'], airports: ['SFO', 'OAK', 'SJC'] },
  { code: 'QDF', name: 'Dallas', aliases: ['dallas fort worth', 'dallas-fort worth'], airports: ['DFW', 'DAL'] },
  { code: 'HOU', name: 'Houston', aliases: [], airports: ['IAH', 'HOU'] },
  { code: 'QMI', name: 'Miami', aliases: ['south florida'], airports: ['MIA', 'FLL', 'PBI'] },
];

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The metro group a query names (city name, alias or metro code), if any. */
export function metroFor(q: string): MetroGroup | null {
  const n = norm(q);
  if (!n) return null;
  const upper = q.trim().toUpperCase();
  for (const g of METRO_GROUPS) {
    if (g.airports.length < 2) continue;
    if (norm(g.name) === n || g.aliases.some((a) => norm(a) === n)) return g;
    // Metro code only when it is not itself an airport code (SHA, BKK, DXB… are both).
    if (upper === g.code && !g.airports.includes(g.code)) return g;
  }
  return null;
}

export { norm as normalizePlace };
