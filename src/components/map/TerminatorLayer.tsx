'use client';
/**
 * Day/night (registry `day_night`, REFERENCE): civil/nautical/astronomical/night twilight bands
 * computed in the geometry worker every 60 s (or at the 24 h timeline cursor while replaying, rounded to
 * the minute so a drag does not run the worker per pixel; §9 item 2 terminator replay), plus NASA GIBS Black Marble 2016 night lights
 * clipped per pixel to the night side through the `godseye-night://` protocol (refreshed every
 * 5 min, always at the current time). Colours come from `--map-night` and follow theme changes in place. Owner: map-engine.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTimeCursor } from '@/components/hud/timeline';
import { Layer, Source } from 'react-map-gl/maplibre';
import { geometryClient } from '@/lib/map/geometry-client';
import { TERMINATOR_REFRESH_MS, type TerminatorBands } from '@/lib/map/geometry-protocol';
import { BLACK_MARBLE_ATTRIBUTION, BLACK_MARBLE_MAX_ZOOM } from '@/lib/map/imagery';
import { NIGHT_LAYER_ID, NIGHT_REFRESH_MS, NIGHT_SOURCE_ID, nightBucket, nightLightsSupported, nightTileTemplate } from '@/lib/map/night-lights';
import { useStyleVersion } from '@/lib/map/style-version';
import { TWILIGHT_OPACITY } from '@/lib/map/view';
import { useUiStore } from '@/lib/store';
import { readCssColor } from '@/lib/tokens';

const EMPTY: TerminatorBands = { type: 'FeatureCollection', features: [] };

/** The instant the bands are drawn for: the replay cursor rounded to the refresh period, else now. */
export function terminatorTime(cursor: number | null, now: number): number {
  return cursor === null ? now : Math.round(cursor / TERMINATOR_REFRESH_MS) * TERMINATOR_REFRESH_MS;
}

function useTicker(periodMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), periodMs);
    return () => clearInterval(t);
  }, [periodMs]);
  return now;
}

export default function TerminatorLayer({ beforeId, visible }: { beforeId?: string; visible: boolean }) {
  const [bands, setBands] = useState<TerminatorBands>(EMPTY);
  const minute = useTicker(TERMINATOR_REFRESH_MS);
  const at = terminatorTime(useTimeCursor(), minute);
  const theme = useUiStore((s) => s.theme);
  const ghost = useUiStore((s) => s.ghost);
  const styleVersion = useStyleVersion();

  useEffect(() => {
    if (!visible) return;
    let live = true;
    geometryClient()
      .terminator(at, 2)
      .then((b) => live && setBands(b))
      .catch(() => undefined); // the previous (≤ 60 s old) bands stay on screen
    return () => {
      live = false;
    };
  }, [at, visible]);

  const night = useMemo(() => {
    const [r, g, b] = readCssColor('--map-night');
    return `rgb(${r},${g},${b})`;
    // Re-read the token on theme, Ghost Protocol or Style Studio changes (paint updates in place).
  }, [theme, ghost, styleVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const bucket = nightBucket(useTicker(NIGHT_REFRESH_MS));
  const tiles = useMemo(() => [nightTileTemplate(bucket)], [bucket]);
  const lights = useMemo(() => nightLightsSupported(), []);
  const visibility = visible ? 'visible' : 'none';

  return (
    <>
      <Source id="day-night" type="geojson" data={bands}>
        {Object.entries(TWILIGHT_OPACITY).map(([band, opacity]) => (
          <Layer
            key={band}
            id={`day-night-${band}`}
            type="fill"
            beforeId={beforeId}
            filter={['==', ['get', 'band'], band]}
            layout={{ visibility }}
            paint={{ 'fill-color': night, 'fill-opacity': opacity, 'fill-antialias': false }}
          />
        ))}
      </Source>
      {lights && (
        <Source id={NIGHT_SOURCE_ID} type="raster" tiles={tiles} tileSize={256} maxzoom={BLACK_MARBLE_MAX_ZOOM} attribution={BLACK_MARBLE_ATTRIBUTION}>
          <Layer
            id={NIGHT_LAYER_ID}
            type="raster"
            beforeId={beforeId}
            layout={{ visibility }}
            paint={{ 'raster-opacity': 0.9, 'raster-fade-duration': 0, 'raster-resampling': 'linear' }}
          />
        </Source>
      )}
    </>
  );
}
