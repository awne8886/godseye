/**
 * Entry point for RECON, Search, Directions, Draw, ArcGIS and World Remote panels.
 * Owner: panels-recon. See src/lib/feature-module.ts.
 * Panels load on demand (next/dynamic); ReconOverlays is the Background that draws routes, drawn
 * shapes and imported ArcGIS layers on the map.
 */
import dynamic from 'next/dynamic';
import type { FeatureModule } from '@/lib/feature-module';
import { defineModule } from '@/lib/feature-module';

const SearchPanel = dynamic(() => import('../search/SearchPanel'), { ssr: false });
const ReconPanel = dynamic(() => import('./ReconPanel'), { ssr: false });
const DirectionsPanel = dynamic(() => import('../directions/DirectionsPanel'), { ssr: false });
const DrawPanel = dynamic(() => import('../draw/DrawPanel'), { ssr: false });
const ArcgisPanel = dynamic(() => import('../arcgis/ArcgisPanel'), { ssr: false });
const RemotePanel = dynamic(() => import('../remote/RemotePanel'), { ssr: false });
const ReconOverlays = dynamic(() => import('./ReconOverlays'), { ssr: false });

const modules: FeatureModule[] = [
  defineModule({
    id: 'panels-recon',
    layers: [],
    Background: ReconOverlays,
    panels: {
      recon: ReconPanel,
      search: SearchPanel,
      route: DirectionsPanel,
      draw: DrawPanel,
      arcgis: ArcgisPanel,
      remote: RemotePanel,
    },
  }),
];

export default modules;
