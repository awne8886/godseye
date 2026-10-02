/**
 * Entry point for the space feature modules. Owner: layers-space.
 * Export every FeatureModule this area provides (layers, cards, panels); see src/lib/feature-module.ts.
 */
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import { defineModule, type CardProps, type FeatureModule, type LayerComponentProps, type PanelProps } from '@/lib/feature-module';

const SatelliteLayer = dynamic(() => import('./SatelliteLayer'), { ssr: false }) as ComponentType<LayerComponentProps>;
const SatelliteCard = dynamic(() => import('./SatelliteCard').then((m) => m.SatelliteCard), { ssr: false }) as ComponentType<CardProps>;
const SatellitePanel = dynamic(() => import('./SatelliteCard').then((m) => m.SatellitePanel), { ssr: false }) as ComponentType<PanelProps>;
const SpacePanel = dynamic(() => import('./SpacePanel').then((m) => m.SpacePanel), { ssr: false }) as ComponentType<PanelProps>;

const modules: FeatureModule[] = [
  defineModule({
    id: 'space',
    layers: ['satellites', 'sat_comms', 'sat_military', 'sat_navigation', 'sat_earth', 'sat_science'],
    Layer: SatelliteLayer,
    cards: { satellite: SatelliteCard },
    panels: { space: SpacePanel, satellite: SatellitePanel },
  }),
];

export default modules;
