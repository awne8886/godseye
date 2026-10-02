/**
 * GET /api/space-weather — NOAA SWPC Kp (never "Quiet" without a reading), NOAA R/S/G scales, GOES
 * X-ray class (0.1–0.8 nm), RTSW solar wind (active spacecraft only) and alerts. Feeds the HUD
 * telemetry (SOLAR Kp) and the MARKETS panel. Owner: layers-space.
 */
import { feedJson, withRoute } from '@/lib/respond';
import { spaceWeatherFeed } from '@/features/space/feeds';

export const dynamic = 'force-dynamic';

export const GET = withRoute('/api/space-weather', async (req: Request) =>
  feedJson(req, await spaceWeatherFeed.get(), (d) => ({
    kp: d.kp,
    kpHistory: d.kpHistory,
    scales: d.scales,
    xray: d.xray,
    solarWind: d.solarWind,
    alerts: d.alerts,
  })),
);
