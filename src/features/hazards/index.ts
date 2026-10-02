/**
 * Entry point for the hazards feature modules. Owner: layers-hazards.
 * One module renders earthquakes, fires, severe weather, air quality, weather radar, GPS
 * interference and Sentinel scene footprints, and supplies their entity cards.
 *
 * Bundle rule (perf B1): the layer host and every card load through `next/dynamic`, so nothing in
 * this file pulls deck.gl, h3-js or zod into the initial page JS. Guarded by `index.test.ts`.
 */
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import { defineModule, type CardProps, type FeatureModule, type LayerComponentProps } from '@/lib/feature-module';

const HazardsLayer = dynamic(() => import('./client/HazardsLayer'), { ssr: false }) as ComponentType<LayerComponentProps>;
const EarthquakeCard = dynamic(() => import('./client/cards').then((m) => m.EarthquakeCard), { ssr: false }) as ComponentType<CardProps>;
const FireCard = dynamic(() => import('./client/cards').then((m) => m.FireCard), { ssr: false }) as ComponentType<CardProps>;
const WeatherEventCard = dynamic(() => import('./client/cards').then((m) => m.WeatherEventCard), { ssr: false }) as ComponentType<CardProps>;
const AirQualityCard = dynamic(() => import('./client/cards').then((m) => m.AirQualityCard), { ssr: false }) as ComponentType<CardProps>;
const GpsJamCard = dynamic(() => import('./client/cards').then((m) => m.GpsJamCard), { ssr: false }) as ComponentType<CardProps>;
const SentinelCard = dynamic(() => import('./client/cards').then((m) => m.SentinelCard), { ssr: false }) as ComponentType<CardProps>;

const modules: FeatureModule[] = [
  defineModule({
    id: 'hazards',
    layers: ['earthquakes', 'fires', 'weather', 'air_quality', 'weather_radar', 'gps_jam', 'sentinel'],
    Layer: HazardsLayer,
    cards: {
      earthquake: EarthquakeCard,
      fire: FireCard,
      weather_event: WeatherEventCard,
      air_quality: AirQualityCard,
      gps_jam_cell: GpsJamCard,
      sentinel_scene: SentinelCard,
    },
  }),
];

export default modules;
