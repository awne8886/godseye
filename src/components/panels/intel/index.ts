/**
 * Entry point for Live Alerts (+ alert_pins layer and card), Markets, Region Dossier, Entity Graph
 * and the desktop Intel Feed. Owner: panels-alerts-markets-dossier-graph. See src/lib/feature-module.ts.
 */
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import { defineModule, type CardProps, type FeatureModule, type LayerComponentProps, type PanelProps } from '@/lib/feature-module';

const AlertPinsLayer = dynamic(() => import('../alerts/AlertPinsLayer'), { ssr: false }) as ComponentType<LayerComponentProps>;
const AlertCard = dynamic(() => import('../alerts/AlertCard').then((m) => m.AlertCard), { ssr: false }) as ComponentType<CardProps>;
const AlertsPanel = dynamic(() => import('../alerts/AlertsPanel').then((m) => m.AlertsPanel), { ssr: false }) as ComponentType<PanelProps>;
const MarketsPanel = dynamic(() => import('../markets/MarketsPanel').then((m) => m.MarketsPanel), { ssr: false }) as ComponentType<PanelProps>;
const IntelFeedPanel = dynamic(() => import('./IntelFeedPanel').then((m) => m.IntelFeedPanel), { ssr: false }) as ComponentType<PanelProps>;
const DossierPanel = dynamic(() => import('../dossier/DossierPanel').then((m) => m.DossierPanel), { ssr: false }) as ComponentType<PanelProps>;
const GraphPanel = dynamic(() => import('../graph/GraphPanel').then((m) => m.GraphPanel), { ssr: false }) as ComponentType<PanelProps>;

const modules: FeatureModule[] = [
  defineModule({
    id: 'intel-alerts',
    layers: ['alert_pins'],
    Layer: AlertPinsLayer,
    cards: { alert: AlertCard },
    panels: { alerts: AlertsPanel, intel: IntelFeedPanel },
  }),
  defineModule({ id: 'intel-markets', layers: [], panels: { markets: MarketsPanel } }),
  defineModule({ id: 'intel-dossier', layers: [], panels: { dossier: DossierPanel, graph: GraphPanel } }),
];

export default modules;
