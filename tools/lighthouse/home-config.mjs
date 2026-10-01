/**
 * Lighthouse config for `/` under software GL in CI (owner: pages-docs-privacy-ops), named by
 * `ci.collect.settings.configPath` in lighthouserc.home.json.
 *
 * Lighthouse ignores `preset` once a config path is given, so this module spreads Lighthouse's own
 * desktop config (the `desktop` preset /docs and /privacy use) and only adds the in-run guard: the
 * MapWebGl and MapPaint gatherers and the godseye-map-globe-drawn audit, which fails a run that did
 * not draw the globe (fallback page, blank canvas, no basemap). The audit needs a category, or
 * Lighthouse drops it from the report. Performance and accessibility scoring are untouched.
 */
import { desktopConfig } from './lighthouse-module.mjs';

const homeConfig = {
  ...desktopConfig,
  artifacts: [
    { id: 'MapWebGl', gatherer: './map-webgl-gatherer.mjs' },
    { id: 'MapPaint', gatherer: './map-paint-gatherer.mjs' },
  ],
  audits: ['./map-globe-drawn-audit.mjs'],
  categories: {
    godseye: {
      title: 'GODSEYE globe guard',
      description: 'Whether the globe was drawn in this page load (any WebGL2 renderer, software included).',
      auditRefs: [{ id: 'godseye-map-globe-drawn', weight: 1 }],
    },
  },
};

export default homeConfig;
