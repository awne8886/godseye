'use client';
/**
 * Mounts one sub-layer per active hazards layer id (each fetches, renders and reports its own
 * status, and unmounts cleanly when switched off). Sub-layers are split into their own chunks and
 * load on first activation, so h3-js / deck geo-layers (GPS interference) never weigh on the
 * initial page load. Owner: layers-hazards.
 */
import dynamic from 'next/dynamic';
import type { LayerComponentProps } from '@/lib/feature-module';
import { useHazardsHitTesting } from './hit-test';

const AirQualityLayer = dynamic(() => import('./AirQualityLayer'), { ssr: false });
const EarthquakeLayer = dynamic(() => import('./EarthquakeLayer'), { ssr: false });
const FireLayer = dynamic(() => import('./FireLayer'), { ssr: false });
const GpsJamLayer = dynamic(() => import('./GpsJamLayer'), { ssr: false });
const RadarLayer = dynamic(() => import('./RadarLayer'), { ssr: false });
const SentinelLayer = dynamic(() => import('./SentinelLayer'), { ssr: false });
const WeatherLayer = dynamic(() => import('./WeatherLayer'), { ssr: false });

export default function HazardsLayer({ active }: LayerComponentProps) {
  useHazardsHitTesting();
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
