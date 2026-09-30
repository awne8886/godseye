/**
 * Lazy component loaders for the threats / network / maritime feature modules: the entry files
 * (index.ts) hold only FeatureModule metadata, so deck.gl, luma.gl and the card bodies stay out of
 * the initial JS on `/` (perf B1). Owner: layers-threats-network.
 */
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import type { CardProps } from '@/lib/feature-module';
import type * as CardsModule from './cards';

type Cards = typeof CardsModule;

/** One card body from ./cards, loaded on first open. */
export function lazyCard(name: keyof Cards): ComponentType<CardProps> {
  return dynamic(() => import('./cards').then((m) => m[name] as ComponentType<CardProps>), { ssr: false }) as ComponentType<CardProps>;
}
