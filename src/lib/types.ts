/**
 * Entity and response types, inferred from the zod contracts in ./schemas so the two can
 * never drift. UI-only types (layer ids, tool ids, selection) live in the registries.
 * Regenerate the list below when a schema is added (tools/gen-types.mjs does it).
 */
import type { z } from 'zod';
import type * as S from './schemas';

// common
export type IsoTime = z.infer<typeof S.IsoTime>;
export type LocalTime = z.infer<typeof S.LocalTime>;
export type Lat = z.infer<typeof S.Lat>;
export type Lng = z.infer<typeof S.Lng>;
export type LngLat = z.infer<typeof S.LngLat>;
export type BBox = z.infer<typeof S.BBox>;
export type ProviderStatus = z.infer<typeof S.ProviderStatus>;
export type Providers = z.infer<typeof S.Providers>;
export type Attribution = z.infer<typeof S.Attribution>;
export type FreshnessState = z.infer<typeof S.FreshnessState>;
export type DataKind = z.infer<typeof S.DataKind>;
export type FeedMeta = z.infer<typeof S.FeedMeta>;
export type Envelope = z.infer<typeof S.Envelope>;
export type ColumnarCell = z.infer<typeof S.ColumnarCell>;
export type ApiError = z.infer<typeof S.ApiError>;
export type EntityBase = z.infer<typeof S.EntityBase>;
export type EntityKind = z.infer<typeof S.EntityKind>;
export type FeedEvent = z.infer<typeof S.FeedEvent>;
export type Paged = z.infer<typeof S.Paged>;

// aviation
export type AircraftBucket = z.infer<typeof S.AircraftBucket>;
export type Aircraft = z.infer<typeof S.Aircraft>;
export type FlightsResponse = z.infer<typeof S.FlightsResponse>;
export type TrackPoint = z.infer<typeof S.TrackPoint>;
export type AircraftIdentity = z.infer<typeof S.AircraftIdentity>;
export type AircraftDetailResponse = z.infer<typeof S.AircraftDetailResponse>;
export type RouteAirport = z.infer<typeof S.RouteAirport>;
export type FlightRouteResponse = z.infer<typeof S.FlightRouteResponse>;

// space
export type SatCategory = z.infer<typeof S.SatCategory>;
export type Omm = z.infer<typeof S.Omm>;
export type Mission = z.infer<typeof S.Mission>;
export type SatellitesResponse = z.infer<typeof S.SatellitesResponse>;
export type SatellitePosition = z.infer<typeof S.SatellitePosition>;
export type OrbitClass = z.infer<typeof S.OrbitClass>;
export type OrbitResponse = z.infer<typeof S.OrbitResponse>;
export type KpReading = z.infer<typeof S.KpReading>;
export type SpaceWeatherResponse = z.infer<typeof S.SpaceWeatherResponse>;
export type IssResponse = z.infer<typeof S.IssResponse>;

// maritime
export type PortType = z.infer<typeof S.PortType>;
export type Port = z.infer<typeof S.Port>;
export type RiskLevel = z.infer<typeof S.RiskLevel>;
export type Chokepoint = z.infer<typeof S.Chokepoint>;
export type VesselType = z.infer<typeof S.VesselType>;
export type Vessel = z.infer<typeof S.Vessel>;
export type MaritimeResponse = z.infer<typeof S.MaritimeResponse>;

// hazards
export type Earthquake = z.infer<typeof S.Earthquake>;
export type EarthquakesResponse = z.infer<typeof S.EarthquakesResponse>;
export type FireSatellite = z.infer<typeof S.FireSatellite>;
export type FirePixel = z.infer<typeof S.FirePixel>;
export type FIRE_FIELDS = z.infer<typeof S.FIRE_FIELDS>;
export type FiresResponse = z.infer<typeof S.FiresResponse>;
export type WeatherEventType = z.infer<typeof S.WeatherEventType>;
export type WeatherEvent = z.infer<typeof S.WeatherEvent>;
export type WeatherResponse = z.infer<typeof S.WeatherResponse>;
export type AirQuality = z.infer<typeof S.AirQuality>;
export type AirQualityResponse = z.infer<typeof S.AirQualityResponse>;
export type GpsJamCell = z.infer<typeof S.GpsJamCell>;
export type GpsInterferenceResponse = z.infer<typeof S.GpsInterferenceResponse>;
export type SentinelScene = z.infer<typeof S.SentinelScene>;
export type SentinelResponse = z.infer<typeof S.SentinelResponse>;
export type RadarFramesResponse = z.infer<typeof S.RadarFramesResponse>;

// surveillance
export type StreamType = z.infer<typeof S.StreamType>;
export type CameraProvider = z.infer<typeof S.CameraProvider>;
export type Camera = z.infer<typeof S.Camera>;
export type CctvResponse = z.infer<typeof S.CctvResponse>;
export type StreamStatusResponse = z.infer<typeof S.StreamStatusResponse>;
export type NewsChannel = z.infer<typeof S.NewsChannel>;
export type LiveNewsResponse = z.infer<typeof S.LiveNewsResponse>;
export type RemovalContact = z.infer<typeof S.RemovalContact>;
export type CameraSourceNotWired = z.infer<typeof S.CameraSourceNotWired>;
export type CameraProvidersResponse = z.infer<typeof S.CameraProvidersResponse>;
export type CameraResolveResponse = z.infer<typeof S.CameraResolveResponse>;

// threats
export type NuclearStatus = z.infer<typeof S.NuclearStatus>;
export type NuclearSite = z.infer<typeof S.NuclearSite>;
export type InfrastructureResponse = z.infer<typeof S.InfrastructureResponse>;
export type GdacsIncident = z.infer<typeof S.GdacsIncident>;
export type GdacsResponse = z.infer<typeof S.GdacsResponse>;
export type GdeltEvent = z.infer<typeof S.GdeltEvent>;
export type GdeltEventsResponse = z.infer<typeof S.GdeltEventsResponse>;
export type ConflictZone = z.infer<typeof S.ConflictZone>;
export type ConflictEvent = z.infer<typeof S.ConflictEvent>;
export type ConflictsResponse = z.infer<typeof S.ConflictsResponse>;
export type FrontlinesResponse = z.infer<typeof S.FrontlinesResponse>;
export type CountryRisk = z.infer<typeof S.CountryRisk>;
export type CountryRiskResponse = z.infer<typeof S.CountryRiskResponse>;

// network
export type GeoPrecision = z.infer<typeof S.GeoPrecision>;
export type MalwareHost = z.infer<typeof S.MalwareHost>;
export type MalwareResponse = z.infer<typeof S.MalwareResponse>;
export type MalwareStreamStatus = z.infer<typeof S.MalwareStreamStatus>;
export type C2Server = z.infer<typeof S.C2Server>;
export type C2Response = z.infer<typeof S.C2Response>;
export type ThreatIndicator = z.infer<typeof S.ThreatIndicator>;
export type ThreatFoxResponse = z.infer<typeof S.ThreatFoxResponse>;
export type KevEntry = z.infer<typeof S.KevEntry>;
export type KevResponse = z.infer<typeof S.KevResponse>;
export type Outage = z.infer<typeof S.Outage>;
export type OutagesResponse = z.infer<typeof S.OutagesResponse>;
export type AttackOrigin = z.infer<typeof S.AttackOrigin>;
export type AttackOriginsResponse = z.infer<typeof S.AttackOriginsResponse>;
export type SubmarineCable = z.infer<typeof S.SubmarineCable>;
export type LandingPoint = z.infer<typeof S.LandingPoint>;
export type CablesResponse = z.infer<typeof S.CablesResponse>;
export type SdkEntityInput = z.infer<typeof S.SdkEntityInput>;
export type SdkIngestBatch = z.infer<typeof S.SdkIngestBatch>;
export type SdkEntity = z.infer<typeof S.SdkEntity>;
export type SdkIngestResponse = z.infer<typeof S.SdkIngestResponse>;

// intel
export type Bloc = z.infer<typeof S.Bloc>;
export type AlertKind = z.infer<typeof S.AlertKind>;
export type PlacePrecision = z.infer<typeof S.PlacePrecision>;
export type AlertSourceRef = z.infer<typeof S.AlertSourceRef>;
export type AlertItem = z.infer<typeof S.AlertItem>;
export type NewsSourceStatus = z.infer<typeof S.NewsSourceStatus>;
export type NewsResponse = z.infer<typeof S.NewsResponse>;
export type Quote = z.infer<typeof S.Quote>;
export type MarketSession = z.infer<typeof S.MarketSession>;
export type MarketsResponse = z.infer<typeof S.MarketsResponse>;
export type Candle = z.infer<typeof S.Candle>;
export type MarketRange = z.infer<typeof S.MarketRange>;
export type MarketHistoryResponse = z.infer<typeof S.MarketHistoryResponse>;
export type TickerResponse = z.infer<typeof S.TickerResponse>;
export type RegionDossierResponse = z.infer<typeof S.RegionDossierResponse>;
export type GraphNodeType = z.infer<typeof S.GraphNodeType>;
export type GraphNodeId = z.infer<typeof S.GraphNodeId>;
export type EntityGraphResponse = z.infer<typeof S.EntityGraphResponse>;
export type AiGeneratedBy = z.infer<typeof S.AiGeneratedBy>;
export type AiCitation = z.infer<typeof S.AiCitation>;
export type AiAlertBrief = z.infer<typeof S.AiAlertBrief>;
export type AiOverviewResponse = z.infer<typeof S.AiOverviewResponse>;
export type CryptoResponse = z.infer<typeof S.CryptoResponse>;
export type ChainBriefResponse = z.infer<typeof S.ChainBriefResponse>;
export type ScmSuppliersResponse = z.infer<typeof S.ScmSuppliersResponse>;

// flight-paths
export type AirportType = z.infer<typeof S.AirportType>;
export type Airport = z.infer<typeof S.Airport>;
export type AirportMatch = z.infer<typeof S.AirportMatch>;
export type AirportSearchResponse = z.infer<typeof S.AirportSearchResponse>;
export type FlightCategory = z.infer<typeof S.FlightCategory>;
export type AirportWeather = z.infer<typeof S.AirportWeather>;
export type Runway = z.infer<typeof S.Runway>;
export type AirportDetailResponse = z.infer<typeof S.AirportDetailResponse>;
export type Daylight = z.infer<typeof S.Daylight>;
export type KnownService = z.infer<typeof S.KnownService>;
export type BlockEstimate = z.infer<typeof S.BlockEstimate>;
export type Waypoint = z.infer<typeof S.Waypoint>;
export type DiversionAirport = z.infer<typeof S.DiversionAirport>;
export type RouteEndpoint = z.infer<typeof S.RouteEndpoint>;
export type RoutePlanResponse = z.infer<typeof S.RoutePlanResponse>;
export type LiveRouteAircraft = z.infer<typeof S.LiveRouteAircraft>;
export type RouteLiveResponse = z.infer<typeof S.RouteLiveResponse>;
export type FlightLink = z.infer<typeof S.FlightLink>;
export type FlightDetailResponse = z.infer<typeof S.FlightDetailResponse>;

// system
export type CapabilityState = z.infer<typeof S.CapabilityState>;
export type HealthResponse = z.infer<typeof S.HealthResponse>;
export type StatsResponse = z.infer<typeof S.StatsResponse>;

// osint
export type OsintTool = z.infer<typeof S.OsintTool>;
export type OsintResponse = z.infer<typeof S.OsintResponse>;
export type Place = z.infer<typeof S.Place>;
export type GeoResponse = z.infer<typeof S.GeoResponse>;
export type DirectionsRoute = z.infer<typeof S.DirectionsRoute>;
export type DirectionsResponse = z.infer<typeof S.DirectionsResponse>;
export type ArcgisResponse = z.infer<typeof S.ArcgisResponse>;
