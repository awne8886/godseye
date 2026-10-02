/**
 * Entry point for the maritime feature modules. Owner: layers-threats-network.
 * Ports and chokepoints (REFERENCE) plus AIS vessels when the server relays AISStream. Layer and
 * cards load lazily (next/dynamic) so only this metadata is in the initial bundle.
 */
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import { defineModule, type CardProps, type FeatureModule, type LayerComponentProps } from '@/lib/feature-module';
import { lazyCard } from '../threats/client/lazy';

const MaritimeLayer = dynamic(() => import('./client/MaritimeLayer'), { ssr: false }) as ComponentType<LayerComponentProps>;
const VesselTrack = dynamic(() => import('./client/VesselTrack'), { ssr: false }) as ComponentType<CardProps>;

const modules: FeatureModule[] = [
  defineModule({
    id: 'maritime',
    layers: ['maritime'],
    Layer: MaritimeLayer,
    cards: { port: lazyCard('PortCard'), chokepoint: lazyCard('ChokepointCard'), vessel: lazyCard('VesselCard') },
    tracks: { vessel: VesselTrack },
  }),
];

export default modules;
