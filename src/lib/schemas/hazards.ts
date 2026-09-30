/**
 * Natural hazards, air quality, GPS interference and imagery contracts. Owner: layers-hazards.
 */
import { z } from 'zod';
import { EntityBase, Envelope, IsoTime, Lat, Lng } from './common';

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
  /** Normalised confidence: VIIRS n/l/h → nominal/low/high; MODIS 0–100 → bucketed. */
  confidence: z.enum(['low', 'nominal', 'high']),
  dayNight: z.enum(['D', 'N']).nullable(),
});

export const FiresResponse = Envelope.extend({
  items: z.array(FirePixel),
  /** Pixels available upstream before FRP/confidence sampling. */
  totalDetections: z.number().int().nonnegative(),
  sampling: z.string(),
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
  /** Optional footprint polygon (NWS alert areas, cyclone cones). */
  geometry: z.custom<GeoJSON.Polygon | GeoJSON.MultiPolygon>().nullable(),
});

export const WeatherResponse = Envelope.extend({ items: z.array(WeatherEvent) });

export const AirQuality = EntityBase.extend({
  pm25: z.number().nullable(),
  usAqi: z.number().nullable(),
  station: z.string().nullable(),
  provider: z.enum(['Open-Meteo', 'OpenAQ', 'WAQI']),
});

export const AirQualityResponse = Envelope.extend({ items: z.array(AirQuality) });

export const GpsJamCell = z.object({
  /** H3 resolution-4 index. */
  h3: z.string(),
  lat: Lat,
  lng: Lng,
  /** Share of aircraft in the cell with degraded NACp (0..1). */
  badRatio: z.number().min(0).max(1),
  aircraft: z.number().int().nonnegative(),
  basis: z.enum(['gpsjam-daily', 'live-nacp']),
  date: z.string().nullable(),
});

export const GpsInterferenceResponse = Envelope.extend({ items: z.array(GpsJamCell) });

export const SentinelScene = z.object({
  id: z.string(),
  collection: z.string(),
  datetime: IsoTime,
  cloudCover: z.number().min(0).max(100).nullable(),
  footprint: z.custom<GeoJSON.Polygon | GeoJSON.MultiPolygon>(),
  thumbnailUrl: z.url().nullable(),
  browserUrl: z.url().nullable(),
});

export const SentinelResponse = Envelope.extend({ items: z.array(SentinelScene), center: z.tuple([Lng, Lat]) });

export const RadarFramesResponse = Envelope.extend({
  host: z.url(),
  /** RainViewer past radar frames (no nowcast since 2026; max zoom 7). */
  frames: z.array(z.object({ time: IsoTime, path: z.string() })),
  maxZoom: z.number().int(),
});
