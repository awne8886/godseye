/**
 * Entry point for the network feature modules. Owner: layers-threats-network.
 * One module renders malware hosts (SSE), botnet C2 and ThreatFox indicators, internet outages,
 * attack origins and submarine cables, and supplies their entity cards.
 */
import { defineModule, type FeatureModule } from '@/lib/feature-module';
import { AttackOriginCard, C2Card, CableCard, LandingPointCard, MalwareCard, OutageCard, ThreatIndicatorCard } from '../threats/client/cards';
import NetworkLayer from './client/NetworkLayer';

const modules: FeatureModule[] = [
  defineModule({
    id: 'network',
    layers: ['sdk_sea', 'malware', 'cyber_attacks', 'threatfox', 'cf_outages', 'cf_attacks'],
    Layer: NetworkLayer,
    cards: {
      malware_host: MalwareCard,
      c2_server: C2Card,
      threat_indicator: ThreatIndicatorCard,
      outage: OutageCard,
      attack_origin: AttackOriginCard,
      cable: CableCard,
      landing_point: LandingPointCard,
    },
  }),
];

export default modules;
