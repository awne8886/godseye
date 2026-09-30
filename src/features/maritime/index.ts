/**
 * Entry point for the maritime feature modules. Owner: layers-threats-network.
 * Ports and chokepoints (REFERENCE) plus AIS vessels when the server relays AISStream.
 */
import { defineModule, type FeatureModule } from '@/lib/feature-module';
import { ChokepointCard, PortCard, VesselCard } from '../threats/client/cards';
import MaritimeLayer from './client/MaritimeLayer';

const modules: FeatureModule[] = [
  defineModule({
    id: 'maritime',
    layers: ['maritime'],
    Layer: MaritimeLayer,
    cards: { port: PortCard, chokepoint: ChokepointCard, vessel: VesselCard },
  }),
];

export default modules;
