/**
 * Lighthouse config for `/` on the GPU runner (owner: pages-docs-privacy-ops), named by
 * `ci.collect.settings.configPath` in lighthouserc.gpu.json.
 *
 * Lighthouse ignores `preset` once a config path is given, so this module spreads Lighthouse's own
 * desktop config (the `desktop` preset /docs and /privacy use) and only adds the in-run hardware
 * check: the MapWebGl gatherer and the godseye-map-webgl-hardware audit. The audit needs a category,
 * or Lighthouse drops it from the report. Performance and accessibility scoring are untouched.
 */
import { desktopConfig } from './lighthouse-module.mjs';

const gpuConfig = {
  ...desktopConfig,
  artifacts: [{ id: 'MapWebGl', gatherer: './map-webgl-gatherer.mjs' }],
  audits: ['./map-webgl-audit.mjs'],
  categories: {
    godseye: {
      title: 'GODSEYE GPU gate',
      description: 'Whether the globe on this page load was drawn on a hardware GPU.',
      auditRefs: [{ id: 'godseye-map-webgl-hardware', weight: 1 }],
    },
  },
};

export default gpuConfig;
