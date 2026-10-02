/**
 * HUD panels exposed to the shell (layers, presets, settings, style studio, share, help, palette,
 * attribution). Heavier ones (palette → cmdk, Style Studio) load on first open.
 * Owner: design-system-hud. See src/lib/feature-module.ts.
 */
import dynamic from 'next/dynamic';
import { defineModule, type FeatureModule, type PanelProps } from '@/lib/feature-module';
import AttributionPanel from './panels/AttributionPanel';
import HelpPanel from './panels/HelpPanel';
import LayersPanel from './panels/LayersPanel';
import PresetsPanel from './panels/PresetsPanel';
import SettingsPanel from './panels/SettingsPanel';
import SharePanel from './panels/SharePanel';

const PalettePanel = dynamic<PanelProps>(() => import('./panels/PalettePanel'), { ssr: false });
const StyleStudioPanel = dynamic<PanelProps>(() => import('./panels/StyleStudioPanel'), { ssr: false });

const modules: FeatureModule[] = [
  defineModule({
    id: 'hud',
    layers: [],
    panels: {
      layers: LayersPanel,
      presets: PresetsPanel,
      settings: SettingsPanel,
      'style-studio': StyleStudioPanel,
      share: SharePanel,
      help: HelpPanel,
      palette: PalettePanel,
      attribution: AttributionPanel,
    },
  }),
];

export default modules;
