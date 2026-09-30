'use client';
/**
 * Mounts one sub-layer per active hazards layer id (each fetches, renders and reports its own
 * status, and unmounts cleanly when switched off). Owner: layers-hazards.
 */
import type { LayerComponentProps } from '@/lib/feature-module';
import AirQualityLayer from './AirQualityLayer';
import EarthquakeLayer from './EarthquakeLayer';
import FireLayer from './FireLayer';
import GpsJamLayer from './GpsJamLayer';
import { useHazardsClickRouter } from './hit-test';
import RadarLayer from './RadarLayer';
import SentinelLayer from './SentinelLayer';
import WeatherLayer from './WeatherLayer';

export default function HazardsLayer({ active }: LayerComponentProps) {
  useHazardsClickRouter();
  return (
    <>
      {active.has('weather_radar') && <RadarLayer />}
      {active.has('sentinel') && <SentinelLayer />}
      {active.has('gps_jam') && <GpsJamLayer />}
      {active.has('air_quality') && <AirQualityLayer />}
      {active.has('fires') && <FireLayer />}
      {active.has('weather') && <WeatherLayer />}
      {active.has('earthquakes') && <EarthquakeLayer />}
    </>
  );
}
