import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { AIRPORT_FIELDS, AIRPORT_TYPES, type AirportIndexFile, type VrsRoutesFile } from '@/features/flight-paths/lib/data-format';
import { buildAirportIndex, buildRunways } from './build-airports';

// Rows copied verbatim from the OurAirports / mwgg / VRS / OpenFlights files downloaded 2026-09-30.
const AIRPORTS = `"id","ident","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","icao_code","iata_code","gps_code","local_code","home_link","wikipedia_link","keywords"
2434,"EGLL","large_airport","London Heathrow Airport",51.4706,-0.461941,83,"EU","GB","GB-ENG","London","yes","EGLL","LHR","EGLL",,"http://www.heathrowairport.com/","https://en.wikipedia.org/wiki/Heathrow_Airport","LON, Londres"
6523,"00A","heliport","Total RF Heliport",40.070985,-74.933689,11,"NA","US","US-PA","Bensalem","no",,,"K00A","00A",,,
6524,"00AK","small_airport","Lowell Field",59.947733,-151.692524,450,"NA","US","US-AK","Anchor Point","no",,,"00AK","00AK",,,
9999,"XXCL","closed","Closed Field",10,10,,"NA","US","US-AK","Nowhere","no",,,,,,,
`;
const RUNWAYS = `"id","airport_ref","airport_ident","length_ft","width_ft","surface","lighted","closed","le_ident","le_latitude_deg","le_longitude_deg","le_elevation_ft","le_heading_degT","le_displaced_threshold_ft","he_ident","he_latitude_deg","he_longitude_deg","he_elevation_ft","he_heading_degT","he_displaced_threshold_ft"
1,2434,"EGLL",12799,164,"ASP",1,0,"09L",,,,,,"27R",,,,,
2,2434,"EGLL",12008,164,"ASP",1,0,"09R",,,,,,"27L",,,,,
3,6524,"00AK",2500,70,"GRVL",0,0,"1",,,,,,"19",,,,,
4,6523,"00A",80,80,"ASPH-G",1,0,"H1",,,,,,,,,,,
`;
const COUNTRIES = `"id","code","name","continent","wikipedia_link","keywords"
302791,"GB","United Kingdom","EU","https://en.wikipedia.org/wiki/United_Kingdom","Great Britain"
302755,"US","United States","NA","https://en.wikipedia.org/wiki/United_States","America"
`;
const REGIONS = `"id","code","local_code","name","continent","iso_country","wikipedia_link","keywords"
303999,"GB-ENG","ENG","England","EU","GB","https://en.wikipedia.org/wiki/England",
`;
const MWGG = JSON.stringify({ EGLL: { icao: 'EGLL', iata: 'LHR', tz: 'Europe/London' }, '00AK': { icao: '00AK', iata: '', tz: 'America/Anchorage' } });

describe('build-airports', () => {
  const built = buildAirportIndex({ airportsCsv: AIRPORTS, runwaysCsv: RUNWAYS, countriesCsv: COUNTRIES, regionsCsv: REGIONS, mwggJson: MWGG }, new Date('2026-09-30T20:00:00Z'));

  it('default index = large/medium + scheduled or IATA; full index adds small airfields, drops heliports/closed', () => {
    expect(built.min.rows.map((r) => r[0])).toEqual(['EGLL']);
    expect(built.all.rows.map((r) => r[0])).toEqual(['EGLL', '00AK']);
    expect(built.min.fields).toEqual(AIRPORT_FIELDS);
  });

  it('joins mwgg tz, countries, regions and the longest paved runway', () => {
    const [ident, icao, iata, gps, name, type, lat, , , municipality, iso, region, scheduled, tz, keywords, longest] = built.min.rows[0]!;
    expect([ident, icao, iata, gps, name]).toEqual(['EGLL', 'EGLL', 'LHR', 'EGLL', 'London Heathrow Airport']);
    expect(AIRPORT_TYPES[type]).toBe('large_airport');
    expect(lat).toBe(51.4706);
    expect([municipality, iso, region, scheduled, tz]).toEqual(['London', 'GB', 'GB-ENG', 1, 'Europe/London']);
    expect(keywords).toContain('LON');
    expect(longest).toBe(Math.round(12799 * 0.3048));
    expect(built.min.countries.GB).toBe('United Kingdom');
    expect(built.min.regions['GB-ENG']).toBe('England');
    // Gravel is not paved: no runway length for diversion use.
    expect(built.all.rows[1]![15]).toBeNull();
    expect(built.runways.byIdent.EGLL).toHaveLength(2);
    expect(built.runways.byIdent['00A']).toBeUndefined();
  });

  it('buildRunways ignores airports outside the index', () => {
    expect(Object.keys(buildRunways(RUNWAYS, new Set(['EGLL'])).byIdent)).toEqual(['EGLL']);
  });
});

describe('bundled data files', () => {
  const dir = new URL('../public/data/', import.meta.url);
  it('exist, stay within budget and parse', () => {
    for (const f of ['airports.min.json', 'airports-all.json.gz', 'airports-runways.json.gz', 'routes-vrs.json.gz', 'routes-openflights.json.gz']) {
      const u = new URL(f, dir);
      expect(existsSync(u), f).toBe(true);
      expect(statSync(u).size, f).toBeLessThan(3 * 1024 * 1024);
    }
    const min = JSON.parse(readFileSync(new URL('airports.min.json', dir), 'utf8')) as AirportIndexFile;
    expect(min.rows.length).toBeGreaterThan(8000);
    const vrs = JSON.parse(gunzipSync(readFileSync(new URL('routes-vrs.json.gz', dir))).toString('utf8')) as VrsRoutesFile;
    expect(vrs.chains['EGLL-KJFK']).toContain('BAW117');
  });
});
