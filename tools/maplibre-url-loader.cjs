// Turbopack loader for maplibre-gl.mjs. MapLibre 6 builds its worker URL at runtime with
// `new URL(x, import.meta.url)`; Turbopack mistakes that for a build-time asset import.
// Qualifying the constructor as `globalThis.URL` keeps the runtime behaviour identical.
module.exports = function maplibreUrlLoader(source) {
  return source.replace(/new URL\(([$\w]+),\s*import\.meta\.url\)/g, 'new globalThis.URL($1,import.meta.url)');
};
