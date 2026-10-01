/**
 * Natural hazards, air quality, GPS interference and imagery contracts. Owner: layers-hazards.
 */
import { z } from 'zod';
import { EntityBase, Envelope, IsoTime, Lat, Lng, columnarResponse } from './common';

export const Earthquake = EntityBase.extend({
  magnitude: z.number(),
  magType: z.string().nullable(),
  depthKm: z.number().nullable(),
  place: z.string().nullable(),
  /** USGS event page. */
  url: z.url().nullable(),
  tsunami: z.boolean(),
  felt: z.number().int().nonnegative().nullable(),
  /** USGS PAGER alert level. */
  alert: z.enum(['green', 'yellow', 'orange', 'red']).nullable(),
  significance: z.number().int().nullable(),
});

export const EarthquakesResponse = Envelope.extend({ items: z.array(Earthquake) });

export const FireSatellite = z.enum(['SNPP', 'NOAA20', 'NOAA21', 'MODIS']);

export const FirePixel = EntityBase.extend({
  satellite: FireSatellite,
  /** Fire radiative power, MW. */
  frpMw: z.number().nonnegative().nullable(),
  /** VIIRS I-4 or MODIS brightness temperature, Kelvin. */
  brightnessK: z.number().nullable(),
  /** Normalised confidence: VIIRS words low/nominal/high; MODIS 0–100 → low (<30) / nominal / high (≥80). */
  confidence: z.enum(['low', 'nominal', 'high']),
  dayNight: z.enum(['D', 'N']).nullable(),
});

/**
 * Columnar rows of GET /api/fires (global VIIRS over 24 h is > 100k pixels; the route samples by
 * FRP, never by stride). `seenAt` = epoch SECONDS of the overpass, `satellite` = FireSatellite value.
 */
export const FIRE_FIELDS = ['id', 'lat', 'lng', 'frpMw', 'brightnessK', 'confidence', 'dayNight', 'satellite', 'seenAt'] as const;

export const FiresResponse = columnarResponse(FIRE_FIELDS, 30_000).extend({
  /** Pixels available upstream before FRP/confidence sampling. */
  totalDetections: z.number().int().nonnegative(),
  sampling: z.string(),
  /** Valid pixels per satellite file before sampling (files that answered). */
  perSatellite: z.record(z.string(), z.number().int().nonnegative()).optional(),
  /** NASA EONET open wildfire events (supplement; WeatherEvent shape, type `wildfire`). */
  wildfireEvents: z.array(z.lazy(() => WeatherEvent)).optional(),
});

export const WeatherEventType = z.enum([
  'severe_storm',
  'tropical_cyclone',
  'volcano',
  'flood',
  'drought',
  'wildfire',
  'sea_ice',
  'winter_storm',
  'heat',
  'weather_alert',
  'other',
]);

export const WeatherEvent = EntityBase.extend({
  title: z.string(),
  type: WeatherEventType,
  severity: z.enum(['low', 'medium', 'high']),
  provider: z.enum(['NASA EONET', 'NOAA/NWS', 'GDACS', 'NHC', 'Smithsonian GVP']),
  expiresAt: IsoTime.nullable(),
  area: z.string().nullable(),
  url: z.url().nullable(),
  /** Optional footprint polygon (NWS alert areas, NHC cones). */
  geometry: z.custom<GeoJSON.Polygon | GeoJSON.MultiPolygon>().nullable(),
  /**
   * NWS zone/county ids when the alert has no geometry (most do not); lat/lng is then the zone
   * centroid (zones cached 30 days) and `positionBasis` says so.
   */
  zones: z.array(z.string()).optional(),
  positionBasis: z.enum(['geometry', 'point', 'zone-centroid']).optional(),
  /** GDACS alert level, lower-cased (GDACS answers `Orange`). */
  alertLevel: z.enum(['green', 'orange', 'red']).optional(),
  /** Short plain-text detail (NWS event name, GDACS severity text, GVP report excerpt, NHC wind/pressure). */
  detail: z.string().optional(),
});

export const WeatherResponse = Envelope.extend({
  items: z.array(WeatherEvent),
  /** NWS alerts without their own polygon whose zone geometry is still being looked up (not placed, never guessed). */
  unplacedAlerts: z.number().int().nonnegative().optional(),
});

export const AirQuality = EntityBase.extend({
  pm25: z.number().nullable(),
  usAqi: z.number().nullable(),
  station: z.string().nullable(),
  provider: z.enum(['Open-Meteo', 'OpenAQ', 'WAQI']),
});

export const AirQualityResponse = Envelope.extend({
  items: z.array(AirQuality),
  /** Sampling points queried: `cities` (default list) or `grid` (bbox grid). */
  sampling: z.enum(['cities', 'grid']).optional(),
});

export const GpsJamCell = z.object({
  /** H3 resolution-4 index. */
  h3: z.string(),
  lat: Lat,
  lng: Lng,
  /**
   * Share of degraded aircraft (0..1). gpsjam-daily: gpsjam's published `(bad − 1) / (good + bad)`;
   * live-nacp: `bad / aircraft` over airborne ADS-B positions ≤ 60 s old.
   */
  badRatio: z.number().min(0).max(1),
  /** Aircraft counted in the cell, and how many of them were degraded. */
  aircraft: z.number().int().nonnegative(),
  bad: z.number().int().nonnegative(),
  basis: z.enum(['gpsjam-daily', 'live-nacp']),
  /** UTC day of the gpsjam aggregate (null for live NACp bins). */
  date: z.iso.date().nullable(),
  /** Live NACp bins only: newest position time of a degraded aircraft in the cell. */
  observedAt: IsoTime.optional(),
});

export const GpsInterferenceResponse = Envelope.extend({
  /** Only daily cells with a gpsjam share > 0 (bad ≥ 2) are returned (the full grid would exceed 4 MB). */
  items: z.array(GpsJamCell).max(30_000),
  totalCells: z.number().int().nonnegative(),
  /** gpsjam's own "suspect data" flag for the day, when published. */
  suspect: z.boolean().nullable(),
});

export const SentinelScene = z.object({
  id: z.string(),
  collection: z.string(),
  datetime: IsoTime,
  cloudCover: z.number().min(0).max(100).nullable(),
  footprint: z.custom<GeoJSON.Polygon | GeoJSON.MultiPolygon>(),
  thumbnailUrl: z.url().nullable(),
  browserUrl: z.url().nullable(),
  /** e.g. `sentinel-2c`. */
  platform: z.string().nullable().optional(),
  /** MGRS tile, e.g. `MGRS-30UYC`. */
  tile: z.string().nullable().optional(),
});

export const SentinelResponse = Envelope.extend({ items: z.array(SentinelScene), center: z.tuple([Lng, Lat]) });

export const RadarFramesResponse = Envelope.extend({
  host: z.url(),
  /** RainViewer past radar frames (no nowcast since 2026; max zoom 7). */
  frames: z.array(z.object({ time: IsoTime, path: z.string() })),
  maxZoom: z.number().int(),
});
