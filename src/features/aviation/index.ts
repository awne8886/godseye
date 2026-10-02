/**
 * Entry point for the aviation feature modules. Owner: layers-aviation.
 * Export every FeatureModule this area provides (layers, cards, panels); see src/lib/feature-module.ts.
 */
import dynamic from 'next/dynamic';
import { defineModule, type FeatureModule } from '@/lib/feature-module';

const AviationLayer = dynamic(() => import('./client/AviationLayer'), { ssr: false });
const AircraftCard = dynamic(() => import('./client/AircraftCard'), { ssr: false });
const AircraftTrack = dynamic(() => import('./client/AircraftTrack'), { ssr: false });
const FlightWatchPanel = dynamic(() => import('./client/FlightWatchPanel'), { ssr: false });

const modules: FeatureModule[] = [
  defineModule({
    id: 'aviation',
    layers: ['flights', 'private', 'jets', 'military'],
    Layer: AviationLayer,
    cards: { aircraft: AircraftCard },
    tracks: { aircraft: AircraftTrack },
    panels: { 'flight-watch': FlightWatchPanel },
  }),
];

export default modules;
