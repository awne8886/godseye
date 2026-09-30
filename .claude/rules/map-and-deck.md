---
paths:
  - "src/components/map/**"
  - "src/lib/map/**"
  - "src/features/**/*.tsx"
  - "src/workers/**"
---
# Map + deck.gl rules (MapLibre 6 globe, deck.gl 9.4 interleaved)
- One map, one `MapLibreOverlay` (interleaved, `deviceProps._reuseDevices`). Feature modules publish
  layers through `useDeckLayers(moduleId, layers, z)`; they never create their own overlay or map.
- Projection only via `{type:'globe'}` / `{type:'mercator'}` (deck throws on anything else). When
  terrain engages at z ≥ 10 switch to mercator. Never pass a view with id `maplibre`.
- Globe workarounds: `parameters: {cullMode: 'none'}` on ArcLayer/GreatCircleLayer (`greatCircle: true`,
  `numSegments ≥ 64`), LineLayer, PathLayer, TripsLayer, TextLayer and non-billboard IconLayer;
  `antialiasing: true` on arc/path/line; billboard IconLayers for aircraft/ships/satellites with a
  far-side filter (`isFacing(center, p)` from `src/lib/geo.ts`); no HexagonLayer/HeatmapLayer/
  ContourLayer on the globe (use H3HexagonLayer or MapLibre's native heatmap); large circles as geodesic
  polygons (`geodesicCircle`); `depthCompare: 'always'` on point layers that z-fight.
- Insert data layers under labels (`beforeId` = first symbol layer; the host defaults it).
- Theme changes update paint in place (read colours with `readCssColor()`); never remount the map.
- Keep per-frame data out of React state: typed arrays in refs/workers, `updateTriggers`, binary attributes.
- Pause polling when `document.hidden`; respect `prefers-reduced-motion` for animations.
