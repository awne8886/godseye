/**
 * Entry point for the hazards feature modules. Owner: layers-hazards.
 * One module renders earthquakes, fires, severe weather, air quality, weather radar, GPS
 * interference and Sentinel scene footprints, and supplies their entity cards.
 */
import { defineModule, type FeatureModule } from '@/lib/feature-module';
import { AirQualityCard, EarthquakeCard, FireCard, GpsJamCard, SentinelCard, WeatherEventCard } from './client/cards';
import HazardsLayer from './client/HazardsLayer';

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
