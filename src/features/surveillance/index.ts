/**
 * Entry point for the surveillance feature modules. Owner: layers-surveillance.
 * One module renders official camera points, on-map previews and live-news dots, supplies the
 * camera and news-channel cards, and the CAMERA VIEWER and LIVE NEWS panels (lazy-loaded).
 */
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import { defineModule, type CardProps, type FeatureModule, type LayerComponentProps } from '@/lib/feature-module';

const SurveillanceLayer = dynamic(() => import('./client/SurveillanceLayer'), { ssr: false }) as ComponentType<LayerComponentProps>;
const CameraCard = dynamic(() => import('./client/cards').then((m) => m.CameraCard), { ssr: false }) as ComponentType<CardProps>;
const NewsChannelCard = dynamic(() => import('./client/cards').then((m) => m.NewsChannelCard), { ssr: false }) as ComponentType<CardProps>;

const CameraViewerPanel = dynamic(() => import('./client/CameraViewer'), { ssr: false });
const LiveNewsPanel = dynamic(() => import('./client/LiveNewsPanel'), { ssr: false });

const modules: FeatureModule[] = [
  defineModule({
    id: 'surveillance',
    layers: ['cctv', 'cctv_previews', 'live_news'],
    Layer: SurveillanceLayer,
    cards: { camera: CameraCard, news_channel: NewsChannelCard },
    panels: { camera: CameraViewerPanel, 'live-news': LiveNewsPanel },
  }),
];

export default modules;
