/**
 * Entry point for the network feature modules. Owner: layers-threats-network.
 * One module renders malware hosts (SSE), botnet C2 and ThreatFox indicators, internet outages,
 * attack origins and submarine cables, and supplies their entity cards. Layer and cards load
 * lazily (next/dynamic) so only this metadata is in the initial bundle.
 */
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import { defineModule, type FeatureModule, type LayerComponentProps } from '@/lib/feature-module';
import { lazyCard } from '../threats/client/lazy';

const NetworkLayer = dynamic(() => import('./client/NetworkLayer'), { ssr: false }) as ComponentType<LayerComponentProps>;

const modules: FeatureModule[] = [
  defineModule({
    id: 'network',
    layers: ['sdk_sea', 'malware', 'cyber_attacks', 'threatfox', 'cf_outages', 'cf_attacks'],
    Layer: NetworkLayer,
    cards: {
      malware_host: lazyCard('MalwareCard'),
      c2_server: lazyCard('C2Card'),
      threat_indicator: lazyCard('ThreatIndicatorCard'),
      outage: lazyCard('OutageCard'),
      attack_origin: lazyCard('AttackOriginCard'),
      cable: lazyCard('CableCard'),
      landing_point: lazyCard('LandingPointCard'),
    },
  }),
];

export default modules;
