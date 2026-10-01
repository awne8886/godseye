/**
 * Static registry of every upstream GODSEYE uses, with what it is used for, its licence or terms,
 * the terms URL and the gate (capability / env flag) that turns it on. Compiled from the licence
 * summary in docs/DATA_SOURCES.md, the per-agent probe logs in docs/data-sources/*.md, the camera
 * provider registry (src/features/surveillance/server/registry.ts — copied here because that file
 * is server-only; sources.test.ts keeps the two in sync) and the flight-path, geocoding/routing,
 * knowledge and AI providers. The SOURCES & LICENCES panel renders the whole list regardless of
 * which layers are on. Client-safe: no server imports, no env reads.
 * Owner: design-system-hud (granted by the lead, Phase 3 round 1).
 */
import type { CapabilityId } from './capabilities';

export type SourceGroup =
  | 'basemap'
  | 'aviation'
  | 'space'
  | 'hazards'
  | 'conflict'
  | 'network'
  | 'maritime'
  | 'cameras'
  | 'news'
  | 'markets'
  | 'geo'
  | 'osint'
  | 'knowledge'
  | 'ai';

export const SOURCE_GROUPS: readonly { id: SourceGroup; label: string }[] = [
  { id: 'basemap', label: 'BASEMAP, IMAGERY & TERRAIN' },
  { id: 'aviation', label: 'AVIATION & FLIGHT PATHS' },
  { id: 'space', label: 'SPACE' },
  { id: 'hazards', label: 'HAZARDS & WEATHER' },
  { id: 'conflict', label: 'CONFLICT, EVENTS & RISK' },
  { id: 'network', label: 'NETWORK & CYBER' },
  { id: 'maritime', label: 'MARITIME' },
  { id: 'cameras', label: 'CAMERAS & LIVE VIDEO' },
  { id: 'news', label: 'NEWS & ALERTS' },
  { id: 'markets', label: 'MARKETS & CHAIN' },
  { id: 'geo', label: 'GEOCODING & ROUTING' },
  { id: 'osint', label: 'OSINT TOOLS' },
  { id: 'knowledge', label: 'KNOWLEDGE & ENTITY GRAPH' },
  { id: 'ai', label: 'AI PROVIDERS (OPTIONAL)' },
];

export interface SourceGate {
  /** Capability from /api/health that must be on (see src/lib/capabilities.ts). */
  capability?: CapabilityId;
  /** Human-readable condition, e.g. "OPENSKY_LICENSED=true + OAuth client". */
  note: string;
}

export interface SourceEntry {
  id: string;
  name: string;
  group: SourceGroup;
  usedFor: string;
  licence: string;
  /** Licence or terms page (http/https). */
  url: string;
  /** How the data is used: fetched live, bundled reference data, browser tiles, or on request. */
  mode: 'live' | 'reference' | 'tiles' | 'on-demand';
  /** Absent = keyless and always on. */
  gate?: SourceGate;
}

const NC: SourceGate = { capability: 'nc_sources', note: 'Non-commercial: off when COMMERCIAL_DEPLOYMENT=true' };

export const SOURCES: readonly SourceEntry[] = [
  // ── Basemap, imagery, terrain ────────────────────────────────────────────────
  { id: 'openfreemap', name: 'OpenFreeMap', group: 'basemap', usedFor: 'Vector basemap tiles, glyphs and sprites', licence: 'Free, no key; "OpenFreeMap © OpenMapTiles Data from OpenStreetMap"', url: 'https://openfreemap.org/', mode: 'tiles' },
  { id: 'openmaptiles', name: 'OpenMapTiles', group: 'basemap', usedFor: 'Vector tile schema and styles behind the basemap', licence: 'BSD-3 (code) / CC BY 4.0 (design); "© OpenMapTiles"', url: 'https://www.openmaptiles.org/', mode: 'tiles' },
  { id: 'osm', name: 'OpenStreetMap contributors', group: 'basemap', usedFor: 'Basemap data, geocoding and routing data', licence: 'ODbL 1.0; "© OpenStreetMap contributors"', url: 'https://www.openstreetmap.org/copyright', mode: 'tiles' },
  { id: 'esri-imagery', name: 'Esri World Imagery', group: 'basemap', usedFor: 'SAT basemap (REFERENCE imagery)', licence: 'Esri Master License Agreement; "Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community"; no offline export', url: 'https://www.esri.com/en-us/legal/terms/full-master-agreement', mode: 'tiles' },
  { id: 'nasa-gibs', name: 'NASA GIBS', group: 'basemap', usedFor: 'Black Marble night lights and VIIRS true-colour imagery (REFERENCE, dated)', licence: 'NASA open data; GIBS acknowledgement', url: 'https://nasa-gibs.github.io/gibs-api-docs/', mode: 'tiles' },
  { id: 'aws-terrain', name: 'AWS Terrain Tiles (Tilezen joerd, Terrarium)', group: 'basemap', usedFor: '3D terrain elevation', licence: 'Open data; attribution to the joerd data sources (SRTM, GMTED, ETOPO1, others)', url: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md', mode: 'tiles' },
  { id: 'natural-earth', name: 'Natural Earth', group: 'basemap', usedFor: 'Country outlines, ports, conflict-zone polygons', licence: 'Public domain', url: 'https://www.naturalearthdata.com/about/terms-of-use/', mode: 'reference' },

  // ── Aviation & flight paths ──────────────────────────────────────────────────
  { id: 'adsblol', name: 'adsb.lol', group: 'aviation', usedFor: 'Live aircraft, traces, military/LADD/PIA lists', licence: 'ODbL 1.0; "Aircraft data © adsb.lol contributors"', url: 'https://www.adsb.lol/privacy-license/', mode: 'live' },
  { id: 'adsblol-reapi', name: 'adsb.lol re-api', group: 'aviation', usedFor: 'Bulk aircraft query (feeder IPs only)', licence: 'ODbL 1.0; feeder-only access', url: 'https://www.adsb.lol/privacy-license/', mode: 'live', gate: { capability: 'adsblol_reapi', note: 'ADSBLOL_REAPI=true (feeder IP)' } },
  { id: 'opensky', name: 'OpenSky Network', group: 'aviation', usedFor: 'Aircraft (optional)', licence: 'Terms of use; live products need a written licence', url: 'https://opensky-network.org/about/terms-of-use', mode: 'live', gate: { capability: 'opensky', note: 'OPENSKY_LICENSED=true + OAuth client' } },
  { id: 'adsbfi', name: 'adsb.fi open data', group: 'aviation', usedFor: 'Aircraft (optional)', licence: 'Personal, non-commercial use only; 1 request/s', url: 'https://github.com/adsbfi/opendata', mode: 'live', gate: { capability: 'adsbfi', note: 'ADSBFI_PERSONAL_USE=true' } },
  { id: 'vrs', name: 'Virtual Radar Server standing data (adsb.lol mirror)', group: 'aviation', usedFor: 'Callsign → route lookups', licence: 'CC0', url: 'https://github.com/vradarserver/standing-data', mode: 'on-demand' },
  { id: 'adsbdb', name: 'adsbdb.com', group: 'aviation', usedFor: 'Aircraft registry, photos link, route fallback', licence: 'Free API; route data must not be copied into other databases', url: 'https://www.adsbdb.com/', mode: 'on-demand' },
  { id: 'airport-data', name: 'airport-data.com', group: 'aviation', usedFor: 'Aircraft photos (via adsbdb; credited on the card)', licence: 'Photographer copyright; displayed with credit, never stored', url: 'https://www.airport-data.com/', mode: 'on-demand' },
  { id: 'hexdb', name: 'HexDB.io', group: 'aviation', usedFor: 'Route fallback (labelled stale when old)', licence: 'Free API (no licence text published)', url: 'https://hexdb.io/', mode: 'on-demand' },
  { id: 'ourairports', name: 'OurAirports', group: 'aviation', usedFor: 'Airport database (Flight Path Planner)', licence: 'Public domain', url: 'https://ourairports.com/data/', mode: 'reference' },
  { id: 'mwgg-airports', name: 'mwgg/Airports', group: 'aviation', usedFor: 'Airport IANA time zones (build-time snapshot)', licence: 'MIT (© mwgg)', url: 'https://github.com/mwgg/Airports/blob/master/LICENSE', mode: 'reference' },
  { id: 'openflights', name: 'OpenFlights', group: 'aviation', usedFor: 'Historical airline routes (frozen June 2014, labelled historical)', licence: 'ODbL 1.0', url: 'https://openflights.org/data.php', mode: 'reference' },
  { id: 'aviationweather', name: 'aviationweather.gov (NOAA AWC)', group: 'aviation', usedFor: 'METAR / TAF at route endpoints', licence: 'US Government work, public domain', url: 'https://aviationweather.gov/data/api/', mode: 'on-demand' },
  { id: 'fpdb', name: 'Flight Plan Database', group: 'aviation', usedFor: 'Filed route waypoints (flight-simulation plans only)', licence: 'FPDB API terms; simulation use only, attribution required', url: 'https://flightplandatabase.com/dev/api', mode: 'on-demand', gate: { capability: 'fpdb', note: 'FPDB_API_KEY' } },
  { id: 'gpsjam', name: 'gpsjam.org', group: 'aviation', usedFor: 'GPS interference (daily H3 cells)', licence: 'Licence not stated; attributed, reuse terms unknown', url: 'https://gpsjam.org/faq', mode: 'live' },

  // ── Space ────────────────────────────────────────────────────────────────────
  { id: 'celestrak', name: 'CelesTrak', group: 'space', usedFor: 'Satellite catalogue (OMM elements)', licence: 'CelesTrak usage policy (download once per update)', url: 'https://celestrak.org/usage-policy.php', mode: 'live' },
  { id: 'satnogs', name: 'SatNOGS DB (Libre Space Foundation)', group: 'space', usedFor: 'Satellite elements fallback and labels', licence: 'CC BY-SA 4.0', url: 'https://db.satnogs.org/about/', mode: 'live' },
  { id: 'wheretheiss', name: 'Where the ISS at?', group: 'space', usedFor: 'ISS position cross-check', licence: 'Free API; 350 requests / 5 min', url: 'https://wheretheiss.at/w/developer', mode: 'live' },
  { id: 'swpc', name: 'NOAA Space Weather Prediction Center', group: 'space', usedFor: 'Kp index, solar wind, space-weather alerts', licence: 'US Government work, public domain', url: 'https://www.swpc.noaa.gov/', mode: 'live' },

  // ── Hazards & weather ────────────────────────────────────────────────────────
  { id: 'usgs', name: 'USGS Earthquake Hazards Program', group: 'hazards', usedFor: 'Earthquakes, ticker', licence: 'US public domain; credit USGS', url: 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits', mode: 'live' },
  { id: 'firms', name: 'NASA FIRMS (LANCE)', group: 'hazards', usedFor: 'Active fires (VIIRS / MODIS)', licence: 'NASA open data; cite FIRMS / LANCE', url: 'https://firms.modaps.eosdis.nasa.gov/', mode: 'live' },
  { id: 'eonet', name: 'NASA EONET v3', group: 'hazards', usedFor: 'Natural events, wildfire events', licence: 'NASA open data', url: 'https://eonet.gsfc.nasa.gov/', mode: 'live' },
  { id: 'nws', name: 'NOAA National Weather Service', group: 'hazards', usedFor: 'US weather alerts and zones', licence: 'US Government work, public domain', url: 'https://www.weather.gov/documentation/services-web-api', mode: 'live' },
  { id: 'nhc', name: 'NOAA National Hurricane Center', group: 'hazards', usedFor: 'Tropical cyclones and forecast cones', licence: 'US Government work, public domain', url: 'https://www.nhc.noaa.gov/', mode: 'live' },
  { id: 'gdacs', name: 'GDACS (EC JRC / UN OCHA)', group: 'hazards', usedFor: 'Global disaster alerts', licence: 'GDACS terms of use; attribution', url: 'https://www.gdacs.org/', mode: 'live' },
  { id: 'gvp', name: 'Smithsonian Global Volcanism Program', group: 'hazards', usedFor: 'Weekly volcanic activity', licence: 'Smithsonian terms of use; attribution', url: 'https://volcano.si.edu/', mode: 'live' },
  { id: 'open-meteo', name: 'Open-Meteo', group: 'hazards', usedFor: 'Air quality (CAMS), winds aloft, dossier weather', licence: 'Free tier non-commercial; data CC BY 4.0', url: 'https://open-meteo.com/en/terms', mode: 'live', gate: { capability: 'openmeteo', note: 'Off when COMMERCIAL_DEPLOYMENT=true' } },
  { id: 'rainviewer', name: 'RainViewer', group: 'hazards', usedFor: 'Weather radar frames', licence: 'Free API with attribution link; max zoom 7', url: 'https://www.rainviewer.com/api.html', mode: 'tiles' },
  { id: 'copernicus', name: 'Copernicus Data Space Ecosystem (Sentinel)', group: 'hazards', usedFor: 'Sentinel-2 scene search and quicklooks', licence: 'Copernicus open data licence; "Contains modified Copernicus Sentinel data"', url: 'https://dataspace.copernicus.eu/', mode: 'on-demand' },

  // ── Conflict, events, risk ───────────────────────────────────────────────────
  { id: 'gdelt', name: 'The GDELT Project (GDELT 2.0)', group: 'conflict', usedFor: 'Events and conflict-zone activity', licence: 'Unlimited, unrestricted use with citation', url: 'https://www.gdeltproject.org/about.html', mode: 'live' },
  { id: 'deepstate', name: 'DeepStateMap.Live', group: 'conflict', usedFor: 'Frontlines (Ukraine)', licence: 'Non-commercial use with attribution; commercial API use needs prior approval', url: 'https://deepstatemap.live/license-en.html', mode: 'live', gate: { capability: 'deepstate', note: 'NONCOMMERCIAL=true and not COMMERCIAL_DEPLOYMENT' } },
  { id: 'inform', name: 'INFORM Risk Index (EC JRC)', group: 'conflict', usedFor: 'Country risk', licence: 'CC BY 4.0', url: 'https://drmkc.jrc.ec.europa.eu/inform-index', mode: 'live' },
  { id: 'wgi', name: 'World Bank Worldwide Governance Indicators', group: 'conflict', usedFor: 'Country risk (political stability)', licence: 'CC BY 4.0', url: 'https://www.worldbank.org/en/publication/worldwide-governance-indicators', mode: 'live' },
  { id: 'wikidata-nuclear', name: 'Wikidata (nuclear facilities)', group: 'conflict', usedFor: 'Nuclear power plants', licence: 'CC0 (structured data)', url: 'https://www.wikidata.org/wiki/Wikidata:Licensing', mode: 'reference' },
  { id: 'osiris-curated', name: 'OSIRIS curated lists', group: 'conflict', usedFor: 'Chokepoints, nuclear facilities, zones, major ports (REFERENCE)', licence: 'MIT', url: 'https://opensource.org/license/mit', mode: 'reference' },

  // ── Network & cyber ──────────────────────────────────────────────────────────
  { id: 'abusech', name: 'abuse.ch (URLhaus, Feodo Tracker, ThreatFox)', group: 'network', usedFor: 'Malware / C2 INDICATOR points', licence: 'abuse.ch terms of use (not-for-profit); commercial use needs an agreement', url: 'https://abuse.ch/terms-of-use/', mode: 'live', gate: NC },
  { id: 'ip-api', name: 'ip-api.com', group: 'network', usedFor: 'Geolocation of indicator IPs, OSINT IP lookups', licence: 'Free endpoint non-commercial only; 45 requests/min', url: 'https://ip-api.com/docs/legal', mode: 'live', gate: NC },
  { id: 'ioda', name: 'IODA (Georgia Tech Internet Intelligence Lab)', group: 'network', usedFor: 'Internet outages', licence: 'Attribution', url: 'https://ioda.inetintel.cc.gatech.edu/', mode: 'live' },
  { id: 'cloudflare-radar', name: 'Cloudflare Radar', group: 'network', usedFor: 'Outages, L3 attack origins', licence: 'CC BY-NC 4.0; API token required', url: 'https://developers.cloudflare.com/radar/', mode: 'live', gate: { capability: 'cloudflare', note: 'CLOUDFLARE_API_TOKEN and not COMMERCIAL_DEPLOYMENT' } },
  { id: 'telegeography', name: 'TeleGeography Submarine Cable Map', group: 'network', usedFor: 'Submarine cables and landing points', licence: 'CC BY-NC-SA 3.0', url: 'https://www.submarinecablemap.com/', mode: 'reference', gate: NC },
  { id: 'cisa-kev', name: 'CISA Known Exploited Vulnerabilities', group: 'network', usedFor: 'Exploited-CVE flags', licence: 'US Government work, public domain', url: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog', mode: 'live' },
  { id: 'nvd', name: 'NIST National Vulnerability Database', group: 'network', usedFor: 'CVSS scores, CVE search', licence: 'Public domain; not endorsed by NVD', url: 'https://nvd.nist.gov/developers/terms-of-use', mode: 'on-demand' },

  // ── Maritime ─────────────────────────────────────────────────────────────────
  { id: 'nga-wpi', name: 'NGA World Port Index', group: 'maritime', usedFor: 'Ports (REFERENCE)', licence: 'US Government work, public domain', url: 'https://msi.nga.mil/Publications/WPI', mode: 'reference' },
  { id: 'aisstream', name: 'AISStream.io', group: 'maritime', usedFor: 'Live vessels (server relay)', licence: 'AISStream terms; no direct browser connections', url: 'https://aisstream.io/', mode: 'live', gate: { capability: 'ais', note: 'AIS_API_KEY' } },

  // ── Cameras (one row per official operator; mirrors the provider registry) ────
  { id: 'cam:caltrans', name: 'Caltrans CWWP2', group: 'cameras', usedFor: 'California traffic cameras', licence: 'Public domain unless otherwise indicated (Caltrans Conditions of Use)', url: 'https://dot.ca.gov/conditions-of-use', mode: 'live' },
  { id: 'cam:wsdot', name: 'WSDOT', group: 'cameras', usedFor: 'Washington traffic cameras', licence: 'Public traveler information (no licence text published; credited)', url: 'https://wsdot.wa.gov/traffic/api/', mode: 'live' },
  { id: 'cam:odot', name: 'ODOT TripCheck', group: 'cameras', usedFor: 'Oregon traffic cameras', licence: 'Operator terms; not separately licensed', url: 'https://www.tripcheck.com/', mode: 'live' },
  { id: 'cam:txdot', name: 'Texas Department of Transportation', group: 'cameras', usedFor: 'Texas traffic cameras', licence: 'No camera licence published (TxDOT website disclaimer); never stored', url: 'https://www.txdot.gov/about/disclaimer.html', mode: 'live' },
  { id: 'cam:mdot', name: 'MDOT Mi Drive', group: 'cameras', usedFor: 'Michigan traffic cameras', licence: 'Operator terms; not separately licensed', url: 'https://mdotjboss.state.mi.us/MiDrive/map', mode: 'live' },
  { id: 'cam:ottawa', name: 'City of Ottawa', group: 'cameras', usedFor: 'Ottawa traffic cameras', licence: 'Operator terms; not separately licensed', url: 'https://traffic.ottawa.ca/', mode: 'live' },
  { id: 'cam:quebec', name: 'Québec 511', group: 'cameras', usedFor: 'Québec cameras (link out to the operator)', licence: 'Operator terms', url: 'https://www.quebec511.info/', mode: 'live' },
  { id: 'cam:toronto', name: 'City of Toronto', group: 'cameras', usedFor: 'Toronto traffic cameras', licence: 'Open Government Licence – Toronto', url: 'https://open.toronto.ca/open-data-licence/', mode: 'live' },
  { id: 'cam:drivebc', name: 'DriveBC', group: 'cameras', usedFor: 'British Columbia webcams', licence: 'Operator terms; not separately licensed', url: 'https://www.drivebc.ca/', mode: 'live' },
  { id: 'cam:tfl', name: 'Transport for London (JamCams)', group: 'cameras', usedFor: 'London traffic cameras', licence: 'TfL Transport Data Service terms; "Powered by TfL Open Data"', url: 'https://tfl.gov.uk/corporate/terms-and-conditions/transport-data-service', mode: 'live', gate: { capability: 'tfl', note: 'TFL_APP_KEY' } },
  { id: 'cam:dgt', name: 'DGT — Dirección General de Tráfico', group: 'cameras', usedFor: 'Spain traffic cameras', licence: 'Spanish public-sector information reuse with attribution', url: 'https://www.dgt.es/', mode: 'live' },
  { id: 'cam:rws', name: 'Rijkswaterstaat / INMOVES', group: 'cameras', usedFor: 'Netherlands cameras (link out to the operator)', licence: 'Operator terms (not verified)', url: 'https://www.rwsverkeersinfo.nl/', mode: 'live' },
  { id: 'cam:digitraffic', name: 'Fintraffic Digitraffic', group: 'cameras', usedFor: 'Finland road-weather cameras', licence: 'CC BY 4.0', url: 'https://www.digitraffic.fi/en/terms-of-service/', mode: 'live' },
  { id: 'cam:vegagerdin', name: 'Vegagerðin', group: 'cameras', usedFor: 'Iceland road cameras', licence: 'Operator open data terms; not separately licensed', url: 'https://www.vegagerdin.is/', mode: 'live' },
  { id: 'cam:trafikverket', name: 'Trafikverket', group: 'cameras', usedFor: 'Sweden road cameras', licence: 'CC0 1.0 (open API; registered key)', url: 'https://www.trafikverket.se/e-tjanster/trafikverkets-oppna-api-for-trafikinformation/', mode: 'live', gate: { capability: 'trafikverket', note: 'TRAFIKVERKET_KEY for the list (stills are keyless)' } },
  { id: 'cam:hktd', name: 'Transport Department, HKSAR (DATA.GOV.HK)', group: 'cameras', usedFor: 'Hong Kong traffic snapshots', licence: 'DATA.GOV.HK terms (reuse with attribution)', url: 'https://data.gov.hk/en/terms-and-conditions', mode: 'live' },
  { id: 'cam:lta', name: 'Land Transport Authority (data.gov.sg)', group: 'cameras', usedFor: 'Singapore traffic images', licence: 'Singapore Open Data Licence v1.0', url: 'https://data.gov.sg/open-data-licence', mode: 'live' },
  { id: 'cam:thb', name: 'Directorate General of Highways, MOTC', group: 'cameras', usedFor: 'Taiwan highway cameras', licence: 'Open Government Data License v1.0 (Taiwan)', url: 'https://data.gov.tw/license', mode: 'live' },
  { id: 'cam:nzta', name: 'NZ Transport Agency Waka Kotahi', group: 'cameras', usedFor: 'New Zealand traffic cameras', licence: 'Operator terms; not separately licensed', url: 'https://trafficnz.info/', mode: 'live' },
  { id: 'cam:nsw', name: 'Transport for NSW (Live Traffic NSW)', group: 'cameras', usedFor: 'New South Wales traffic cameras', licence: 'Operator terms; not separately licensed', url: 'https://www.livetraffic.com/', mode: 'live' },
  { id: 'youtube-live', name: 'YouTube (broadcaster live channels)', group: 'cameras', usedFor: 'Live news embeds where the broadcaster allows embedding; others link out', licence: 'YouTube Terms of Service; broadcaster copyright', url: 'https://www.youtube.com/t/terms', mode: 'on-demand' },

  // ── News & alerts ────────────────────────────────────────────────────────────
  { id: 'telegram', name: 'Telegram public channel previews', group: 'news', usedFor: 'Live Alerts', licence: 'Telegram terms; content licensing forbids AI training (never used for training)', url: 'https://telegram.org/tos/content-licensing', mode: 'live' },
  { id: 'rss-bbc', name: 'BBC News (RSS)', group: 'news', usedFor: 'Wire headlines (title + link only)', licence: 'Publisher copyright; headlines linked to the original', url: 'https://www.bbc.co.uk/usingthebbc/terms', mode: 'live' },
  { id: 'rss-nyt', name: 'The New York Times (RSS)', group: 'news', usedFor: 'Wire headlines (title + link only)', licence: 'NYT RSS terms; headlines linked to the original', url: 'https://www.nytimes.com/rss', mode: 'live' },
  { id: 'rss-dw', name: 'Deutsche Welle (RSS)', group: 'news', usedFor: 'Wire headlines (title + link only)', licence: 'Publisher copyright; headlines linked to the original', url: 'https://www.dw.com/en/legal-notice/a-63500643', mode: 'live' },
  { id: 'rss-guardian', name: 'The Guardian (RSS)', group: 'news', usedFor: 'Wire headlines (title + link only)', licence: 'Guardian RSS terms; headlines linked to the original', url: 'https://www.theguardian.com/help/terms-of-service', mode: 'live' },
  { id: 'rss-aljazeera', name: 'Al Jazeera (RSS)', group: 'news', usedFor: 'Wire headlines (title + link only)', licence: 'Publisher copyright; headlines linked to the original', url: 'https://www.aljazeera.com/terms-and-conditions', mode: 'live' },
  { id: 'rss-france24', name: 'FRANCE 24 (RSS)', group: 'news', usedFor: 'Wire headlines (title + link only)', licence: 'Publisher copyright; headlines linked to the original', url: 'https://www.france24.com/en/', mode: 'live' },
  { id: 'rss-cna', name: 'CNA (RSS)', group: 'news', usedFor: 'Wire headlines (title + link only)', licence: 'Publisher copyright; headlines linked to the original', url: 'https://www.channelnewsasia.com/about-us', mode: 'live' },
  { id: 'rss-scmp', name: 'South China Morning Post (RSS)', group: 'news', usedFor: 'Wire headlines (title + link only)', licence: 'Publisher copyright; headlines linked to the original', url: 'https://www.scmp.com/terms-conditions', mode: 'live' },
  { id: 'rss-aa', name: 'Anadolu Agency (RSS)', group: 'news', usedFor: 'Wire headlines (title + link only)', licence: 'Publisher copyright; headlines linked to the original', url: 'https://www.aa.com.tr/en', mode: 'live' },
  { id: 'rss-africanews', name: 'Africanews (RSS)', group: 'news', usedFor: 'Wire headlines (title + link only)', licence: 'Publisher copyright; headlines linked to the original', url: 'https://www.africanews.com/terms-and-conditions', mode: 'live' },
  { id: 'rss-tass', name: 'TASS (RSS)', group: 'news', usedFor: 'Wire headlines (title + link only; labelled state media)', licence: 'Publisher copyright; headlines linked to the original', url: 'https://tass.com/', mode: 'live' },
  { id: 'rss-toi', name: 'The Times of Israel (RSS)', group: 'news', usedFor: 'Wire headlines (title + link only)', licence: 'Publisher copyright; headlines linked to the original', url: 'https://www.timesofisrael.com/terms-of-use/', mode: 'live' },

  // ── Markets & chain ──────────────────────────────────────────────────────────
  { id: 'yahoo', name: 'Yahoo Finance chart endpoint', group: 'markets', usedFor: 'Indices, commodities, FX (unofficial, delayed; flagged per quote)', licence: 'Unofficial endpoint; Yahoo terms of service', url: 'https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html', mode: 'live' },
  { id: 'binance', name: 'Binance public market data', group: 'markets', usedFor: 'Crypto prices', licence: 'Binance API terms', url: 'https://developers.binance.com/', mode: 'live' },
  { id: 'coinbase', name: 'Coinbase Exchange public API', group: 'markets', usedFor: 'Crypto prices', licence: 'Coinbase API terms', url: 'https://docs.cdp.coinbase.com/', mode: 'live' },
  { id: 'kraken', name: 'Kraken public API', group: 'markets', usedFor: 'Crypto prices', licence: 'Kraken API terms', url: 'https://docs.kraken.com/', mode: 'live' },
  { id: 'coingecko', name: 'CoinGecko', group: 'markets', usedFor: 'Crypto prices (demo key)', licence: 'CoinGecko API terms; attribution', url: 'https://www.coingecko.com/en/api_terms', mode: 'live', gate: { capability: 'coingecko_demo', note: 'COINGECKO_DEMO_KEY' } },
  { id: 'defillama', name: 'DefiLlama', group: 'markets', usedFor: 'Chain brief: hacks and exploits', licence: 'Free open API; attribution', url: 'https://defillama.com/docs/api', mode: 'live' },

  // ── Geocoding & routing ──────────────────────────────────────────────────────
  { id: 'photon', name: 'Photon (komoot)', group: 'geo', usedFor: 'Place search and reverse geocoding', licence: 'Fair use of the public instance; data ODbL (© OpenStreetMap contributors)', url: 'https://photon.komoot.io/', mode: 'on-demand' },
  { id: 'nominatim', name: 'Nominatim (OSMF)', group: 'geo', usedFor: 'Geocoding fallback (≤ 1 request/s, cached)', licence: 'OSMF usage policy; data ODbL', url: 'https://operations.osmfoundation.org/policies/nominatim/', mode: 'on-demand' },
  { id: 'valhalla', name: 'Valhalla (FOSSGIS public instance)', group: 'geo', usedFor: 'Directions and elevation profiles', licence: 'FOSSGIS fair use; data ODbL', url: 'https://www.fossgis.de/', mode: 'on-demand' },
  { id: 'osrm', name: 'OSRM demo server / FOSSGIS routed', group: 'geo', usedFor: 'Directions fallback', licence: 'Demo server fair use; data ODbL', url: 'https://github.com/Project-OSRM/osrm-backend/wiki/Api-usage-policy', mode: 'on-demand' },
  { id: 'ipwhois', name: 'ipwho.is', group: 'geo', usedFor: '"Centre on my region" fallback (only after consent), OSINT IP lookups', licence: 'Free tier, fair use', url: 'https://ipwho.is/', mode: 'on-demand' },
  { id: 'freeipapi', name: 'FreeIPAPI', group: 'geo', usedFor: 'IP geolocation fallback', licence: 'Free tier (60 requests/min)', url: 'https://freeipapi.com/', mode: 'on-demand' },

  // ── OSINT tools (passive, infrastructure only) ───────────────────────────────
  { id: 'dns-google', name: 'Google Public DNS (DoH JSON)', group: 'osint', usedFor: 'DNS lookups', licence: 'Google Public DNS terms', url: 'https://developers.google.com/speed/public-dns/terms', mode: 'on-demand' },
  { id: 'rdap', name: 'RDAP (rdap.org bootstrap → registries)', group: 'osint', usedFor: 'Domain registration data', licence: 'Registry RDAP terms', url: 'https://about.rdap.org/', mode: 'on-demand' },
  { id: 'crtsh', name: 'crt.sh (Sectigo)', group: 'osint', usedFor: 'Certificate transparency search', licence: 'Free public service', url: 'https://crt.sh/', mode: 'on-demand' },
  { id: 'ripestat', name: 'RIPEstat', group: 'osint', usedFor: 'Whois, prefixes, ASN neighbours, entity graph', licence: 'RIPE NCC terms; fair use', url: 'https://www.ripe.net/about-us/legal/ripestat-service-terms-and-conditions/', mode: 'on-demand' },
  { id: 'internetdb', name: 'Shodan InternetDB', group: 'osint', usedFor: 'Passive open-port / CVE lookups', licence: 'Free for non-commercial use', url: 'https://internetdb.shodan.io/docs', mode: 'on-demand', gate: NC },
  { id: 'mitre-cve', name: 'CVE Program (cveawg.mitre.org)', group: 'osint', usedFor: 'CVE records', licence: 'CVE terms of use', url: 'https://www.cve.org/Legal/TermsOfUse', mode: 'on-demand' },
  { id: 'circl-cve', name: 'CIRCL CVE Search', group: 'osint', usedFor: 'CVE records fallback', licence: 'Free public service (CIRCL)', url: 'https://cve.circl.lu/', mode: 'on-demand' },
  { id: 'otx', name: 'AlienVault OTX', group: 'osint', usedFor: 'Threat intel on indicators', licence: 'OTX terms; API key', url: 'https://otx.alienvault.com/', mode: 'on-demand', gate: { capability: 'otx', note: 'OTX_KEY' } },
  { id: 'tor-exits', name: 'Tor Project bulk exit list', group: 'osint', usedFor: 'Tor exit check (exact IP match)', licence: 'Tor Project public data', url: 'https://check.torproject.org/torbulkexitlist', mode: 'on-demand' },
  { id: 'maclookup', name: 'MAC Address Lookup (maclookup.app)', group: 'osint', usedFor: 'OUI vendor lookups', licence: 'Free tier terms', url: 'https://maclookup.app/', mode: 'on-demand' },
  { id: 'xposedornot', name: 'XposedOrNot', group: 'osint', usedFor: 'Breach lookup (organisation domains only)', licence: 'Free API terms', url: 'https://xposedornot.com/', mode: 'on-demand' },
  { id: 'mempool', name: 'mempool.space', group: 'osint', usedFor: 'Bitcoin address lookups', licence: 'Free public API', url: 'https://mempool.space/docs/api/rest', mode: 'on-demand' },
  { id: 'blockscout', name: 'Blockscout (Ethereum)', group: 'osint', usedFor: 'Ethereum address lookups', licence: 'Free public API', url: 'https://eth.blockscout.com/', mode: 'on-demand' },
  { id: 'solana-rpc', name: 'Solana public RPC', group: 'osint', usedFor: 'Solana address balance', licence: 'Public RPC terms', url: 'https://solana.com/tos', mode: 'on-demand' },
  { id: 'opensanctions', name: 'OpenSanctions', group: 'osint', usedFor: 'Sanctions screening (OFAC SDN bulk), entity graph, chain wallets', licence: 'CC BY-NC 4.0; commercial use needs a licence', url: 'https://www.opensanctions.org/licensing/', mode: 'on-demand', gate: NC },

  // ── Knowledge & entity graph ─────────────────────────────────────────────────
  { id: 'wikipedia', name: 'Wikipedia', group: 'knowledge', usedFor: 'Region Dossier extracts', licence: 'CC BY-SA 4.0', url: 'https://en.wikipedia.org/wiki/Wikipedia:Text_of_the_Creative_Commons_Attribution-ShareAlike_4.0_International_License', mode: 'on-demand' },
  { id: 'wikidata', name: 'Wikidata', group: 'knowledge', usedFor: 'Dossier facts, entity graph', licence: 'CC0 (structured data)', url: 'https://www.wikidata.org/wiki/Wikidata:Licensing', mode: 'on-demand' },

  // ── AI providers (all optional; the keyless default is the rule-based analyst) ──
  { id: 'anthropic', name: 'Anthropic Claude API', group: 'ai', usedFor: 'Briefings and overviews (optional)', licence: 'Anthropic commercial terms; API key', url: 'https://www.anthropic.com/legal/commercial-terms', mode: 'on-demand', gate: { capability: 'anthropic', note: 'ANTHROPIC_API_KEY' } },
  { id: 'gemini', name: 'Google Gemini API', group: 'ai', usedFor: 'Fallback analyst (optional)', licence: 'Gemini API additional terms; API key', url: 'https://ai.google.dev/gemini-api/terms', mode: 'on-demand', gate: { capability: 'gemini', note: 'GEMINI_API_KEY_1' } },
  { id: 'ollama', name: 'Ollama (operator-hosted)', group: 'ai', usedFor: 'Local analyst on the operator’s own machine (optional)', licence: 'MIT (software); model licences vary', url: 'https://github.com/ollama/ollama/blob/main/LICENSE', mode: 'on-demand', gate: { capability: 'ollama', note: 'OLLAMA_URL' } },
];

/** Registry entries in display order, grouped. */
export function sourcesByGroup(list: readonly SourceEntry[] = SOURCES): { group: (typeof SOURCE_GROUPS)[number]; entries: SourceEntry[] }[] {
  return SOURCE_GROUPS.map((group) => ({ group, entries: list.filter((s) => s.group === group.id) })).filter((g) => g.entries.length > 0);
}

const CAMS = SOURCES.filter((s) => s.id.startsWith('cam:')).map((s) => s.id);
const SATS = ['celestrak', 'satnogs'];

/**
 * Registry sources behind each map layer, shown in the SOURCES & LICENCES panel before (or instead
 * of) the attribution the layer's feed reports. sources.test.ts checks every layer has an entry.
 */
export const LAYER_SOURCE_IDS: Readonly<Record<string, readonly string[]>> = {
  sdk_sea: ['telegeography'],
  flights: ['adsblol', 'opensky', 'adsbfi', 'vrs', 'adsbdb'],
  private: ['adsblol', 'opensky', 'adsbfi'],
  jets: ['adsblol', 'opensky', 'adsbfi'],
  military: ['adsblol', 'opensky', 'adsbfi'],
  gps_jam: ['gpsjam', 'adsblol'],
  maritime: ['nga-wpi', 'natural-earth', 'osiris-curated', 'aisstream'],
  satellites: SATS,
  sat_comms: SATS,
  sat_military: SATS,
  sat_navigation: SATS,
  sat_earth: SATS,
  sat_science: SATS,
  cctv: CAMS,
  cctv_previews: CAMS,
  live_news: ['youtube-live'],
  earthquakes: ['usgs'],
  fires: ['firms', 'eonet'],
  weather: ['eonet', 'nws', 'gdacs', 'nhc', 'gvp'],
  air_quality: ['open-meteo'],
  weather_radar: ['rainviewer'],
  infrastructure: ['wikidata-nuclear', 'osiris-curated'],
  global_incidents: ['gdacs'],
  alert_pins: ['telegram', ...SOURCES.filter((s) => s.id.startsWith('rss-')).map((s) => s.id)],
  gdelt_events: ['gdelt'],
  conflict_zones: ['natural-earth', 'osiris-curated', 'gdelt'],
  frontlines: ['deepstate'],
  country_risk: ['inform', 'wgi'],
  malware: ['abusech', 'ip-api'],
  cyber_attacks: ['abusech', 'ip-api'],
  threatfox: ['abusech', 'ip-api'],
  cf_outages: ['ioda', 'cloudflare-radar'],
  cf_attacks: ['cloudflare-radar'],
  day_night: ['nasa-gibs'],
  terrain_3d: ['openfreemap', 'openmaptiles', 'osm'],
  terrain_elevation: ['aws-terrain'],
  gibs_truecolor: ['nasa-gibs'],
  sentinel: ['copernicus'],
};

export function sourcesForLayer(layerId: string): SourceEntry[] {
  return (LAYER_SOURCE_IDS[layerId] ?? []).map((id) => SOURCES.find((s) => s.id === id)).filter((s): s is SourceEntry => !!s);
}
