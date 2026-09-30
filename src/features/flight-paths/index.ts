/**
 * Entry point for the flight-paths feature modules. Owner: feature-flight-paths.
 * The route/flight map layers are a Background (driven by `?route=` / `?flight=` through the store,
 * not by a layer toggle); the PATHS panel is lazy-loaded.
 */
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import { defineModule, type FeatureModule, type PanelProps } from '@/lib/feature-module';

const RouteLayer = dynamic(() => import('./client/RouteLayer'), { ssr: false }) as ComponentType;
const PathsPanel = dynamic(() => import('./client/PathsPanel'), { ssr: false }) as ComponentType<PanelProps>;

const modules: FeatureModule[] = [
  defineModule({
    id: 'flight-paths',
    layers: [],
    Background: RouteLayer,
    panels: { paths: PathsPanel },
  }),
];

export default modules;
