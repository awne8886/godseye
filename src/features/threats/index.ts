/**
 * Entry point for the threats feature modules. Owner: layers-threats-network.
 * One module renders nuclear facilities, GDACS incidents, GDELT events, conflict zones, frontlines
 * and country risk, and supplies their entity cards. Layer and cards load lazily (next/dynamic) so
 * only this metadata is in the initial bundle.
 */
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import { defineModule, type FeatureModule, type LayerComponentProps } from '@/lib/feature-module';
import { lazyCard } from './client/lazy';

const ThreatsLayer = dynamic(() => import('./client/ThreatsLayer'), { ssr: false }) as ComponentType<LayerComponentProps>;

const modules: FeatureModule[] = [
  defineModule({
    id: 'threats',
    layers: ['infrastructure', 'global_incidents', 'gdelt_events', 'conflict_zones', 'frontlines', 'country_risk'],
    Layer: ThreatsLayer,
    cards: {
      nuclear_site: lazyCard('NuclearCard'),
      gdacs_incident: lazyCard('GdacsCard'),
      gdelt_event: lazyCard('GdeltCard'),
      conflict_zone: lazyCard('ConflictZoneCard'),
      frontline: lazyCard('FrontlineCard'),
      country_risk: lazyCard('CountryRiskCard'),
    },
  }),
];

export default modules;
