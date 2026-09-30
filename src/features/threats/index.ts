/**
 * Entry point for the threats feature modules. Owner: layers-threats-network.
 * One module renders nuclear facilities, GDACS incidents, GDELT events, conflict zones, frontlines
 * and country risk, and supplies their entity cards.
 */
import { defineModule, type FeatureModule } from '@/lib/feature-module';
import { ConflictZoneCard, CountryRiskCard, FrontlineCard, GdacsCard, GdeltCard, NuclearCard } from './client/cards';
import ThreatsLayer from './client/ThreatsLayer';

const modules: FeatureModule[] = [
  defineModule({
    id: 'threats',
    layers: ['infrastructure', 'global_incidents', 'gdelt_events', 'conflict_zones', 'frontlines', 'country_risk'],
    Layer: ThreatsLayer,
    cards: {
      nuclear_site: NuclearCard,
      gdacs_incident: GdacsCard,
      gdelt_event: GdeltCard,
      conflict_zone: ConflictZoneCard,
      frontline: FrontlineCard,
      country_risk: CountryRiskCard,
    },
  }),
];

export default modules;
