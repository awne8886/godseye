'use client';
/**
 * Basemap imagery toggled by visibility, never by remounting the map:
 *  - Satellite View (`store.basemap === 'satellite'`): Esri World Imagery;
 *  - `gibs_truecolor`: NASA GIBS VIIRS SNPP corrected-reflectance mosaic for the previous UTC day.
 * Both sit under the boundaries and labels (`beforeId` = boundary_state), fetched by the browser
 * straight from the tile hosts, each with its own attribution. Owner: map-engine.
 */
import { useEffect, useMemo, useState } from 'react';
import { Layer, Source } from 'react-map-gl/maplibre';
import {
  ESRI_ATTRIBUTION,
  ESRI_LAYER_ID,
  ESRI_MAX_ZOOM,
  ESRI_SOURCE_ID,
  ESRI_TILES,
  GIBS_TRUECOLOR_LAYER_ID,
  GIBS_TRUECOLOR_MAX_ZOOM,
  GIBS_TRUECOLOR_SOURCE_ID,
  GIBS_TRUECOLOR_ATTRIBUTION,
  gibsTrueColorDate,
  gibsTrueColorTiles,
} from '@/lib/map/imagery';

/** The GIBS date to show, re-checked every 10 minutes so it rolls over at 00:00 UTC. */
export function useGibsDate(): string {
  const [date, setDate] = useState(() => gibsTrueColorDate(Date.now()));
  useEffect(() => {
    const t = setInterval(() => setDate(gibsTrueColorDate(Date.now())), 10 * 60_000);
    return () => clearInterval(t);
  }, []);
  return date;
}

export default function ImageryLayers({ beforeId, satellite, trueColor, gibsDate }: { beforeId?: string; satellite: boolean; trueColor: boolean; gibsDate: string }) {
  const gibsTiles = useMemo(() => gibsTrueColorTiles(gibsDate), [gibsDate]);
  return (
    <>
      <Source id={ESRI_SOURCE_ID} type="raster" tiles={ESRI_TILES} tileSize={256} maxzoom={ESRI_MAX_ZOOM} attribution={ESRI_ATTRIBUTION}>
        <Layer
          id={ESRI_LAYER_ID}
          type="raster"
          beforeId={beforeId}
          layout={{ visibility: satellite ? 'visible' : 'none' }}
          paint={{ 'raster-opacity': 1, 'raster-fade-duration': 150 }}
        />
      </Source>
      <Source
        id={GIBS_TRUECOLOR_SOURCE_ID}
        type="raster"
        tiles={gibsTiles}
        tileSize={256}
        maxzoom={GIBS_TRUECOLOR_MAX_ZOOM}
        attribution={GIBS_TRUECOLOR_ATTRIBUTION}
      >
        <Layer
          id={GIBS_TRUECOLOR_LAYER_ID}
          type="raster"
          beforeId={beforeId}
          layout={{ visibility: trueColor ? 'visible' : 'none' }}
          paint={{ 'raster-opacity': 0.92, 'raster-fade-duration': 150 }}
        />
      </Source>
    </>
  );
}
