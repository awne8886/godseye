/**
 * GET /api/iss — ISS position from wheretheiss.at (with its own timestamp as meta.observedAt) plus a
 * ground track PROPAGATED from NORAD 25544's catalogue elements (labelled: `groundTrack.elementsEpoch`).
 * The track is null while the catalogue has not loaded; it never blocks the position.
 * Owner: layers-space.
 */
import { feedJson, withRoute } from '@/lib/respond';
import { issFeed, satellitesFeed } from '@/features/space/feeds';
import { lookupSatellite } from '@/features/space/server/lookup';
import { groundTrack, splitTrackAtAntimeridian } from '@/features/space/lib/orbit';
import type { IssResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

const ISS_NORAD_ID = 25544;

type GroundTrack = NonNullable<IssResponse['groundTrack']>;

let trackCache: { key: string; value: GroundTrack } | null = null;

function issGroundTrack(now: number): GroundTrack | null {
  const cat = satellitesFeed.peek();
  if (!cat.data) {
    void satellitesFeed.get().catch(() => undefined); // warm the catalogue; the track appears on a later poll
    return null;
  }
  const hit = lookupSatellite(cat.data, ISS_NORAD_ID);
  if (!hit?.satrec) return null;
  // Re-propagate once a minute: 45 min behind to 90 min ahead of the current minute.
  const minute = Math.floor(now / 60_000) * 60_000;
  const key = `${hit.record.epoch}|${minute}`;
  if (trackCache?.key === key) return trackCache.value;
  const segments = splitTrackAtAntimeridian(groundTrack(hit.satrec, new Date(minute - 45 * 60_000), 135, 60));
  const value: GroundTrack = { anchoredAt: new Date(minute).toISOString(), elementsEpoch: hit.record.epoch, source: cat.data.source, segments };
  trackCache = { key, value };
  return value;
}

export const GET = withRoute('/api/iss', async (req: Request) => {
  const result = await issFeed.get();
  const now = Date.now();
  return feedJson(
    req,
    result,
    (d) => ({ lat: d.lat, lng: d.lng, altKm: d.altKm, velocityKmH: d.velocityKmH, visibility: d.visibility, groundTrack: issGroundTrack(now) }),
    `${new URL(req.url).search}|${Math.floor(now / 60_000)}`,
  );
});
