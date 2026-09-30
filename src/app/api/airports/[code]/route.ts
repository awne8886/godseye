/**
 * GET /api/airports/{code} — the bundled OurAirports record (IATA, ICAO, gps_code or ident), its
 * runways, METAR/TAF from aviationweather.gov with observation times, and the airport-local time
 * with its UTC offset. 404 for an unknown code. Owner: feature-flight-paths.
 */
import { z } from 'zod';
import { apiError, json, withRoute } from '@/lib/respond';
import type { Providers } from '@/lib/types';
import { airportIndex, findAirport, runwayIndex } from '@/features/flight-paths/server/data';
import { stationFor, stationWeather } from '@/features/flight-paths/server/weather';
import { emptyWeather } from '@/features/flight-paths/lib/metar';
import { localTimeIso } from '@/features/flight-paths/lib/time';
import { AIRPORT_CODE_RE } from '@/features/flight-paths/lib/idents';

export const dynamic = 'force-dynamic';

const Code = z
  .string()
  .transform((v) => decodeURIComponent(v).trim().toUpperCase())
  .pipe(z.string().regex(AIRPORT_CODE_RE, 'code must be an IATA, ICAO or OurAirports ident'));

type Ctx = { params: Promise<{ code: string }> };

export const GET = withRoute<Ctx>('/api/airports/{code}', async (_req: Request, ctx: Ctx) => {
  const parsed = Code.safeParse((await ctx.params).code);
  if (!parsed.success) return apiError(400, 'invalid_request', parsed.error.issues[0]?.message);
  const a = findAirport(parsed.data);
  if (!a) return apiError(404, 'not_found', `No airport with code ${parsed.data} in the OurAirports index.`);
  const now = Date.now();
  const runways = (runwayIndex().byIdent[a.ident] ?? []).map(([leIdent, heIdent, lengthFt, widthFt, surface, lighted, closed]) => ({
    leIdent,
    heIdent,
    lengthFt,
    widthFt,
    surface,
    lighted: lighted === 1,
    closed: closed === 1,
  }));
  const station = stationFor(a);
  const wx = await stationWeather([station]);
  const generated = Date.parse(airportIndex('min').generatedAt);
  const providers: Providers = {
    ourairports: { ok: true, count: 1 + runways.length, ms: 0, age_s: Number.isFinite(generated) ? Math.max(0, Math.round((now - generated) / 1000)) : null },
    ...Object.fromEntries(Object.entries(wx.providers).map(([k, p]) => [k, { ...p.status, age_s: p.okAt ? Math.max(0, Math.round((now - p.okAt) / 1000)) : p.status.age_s }])),
  };
  const { gps: _g, keywords: _k, longestRunwayM: _r, ...airport } = a;
  return json(
    {
      airport,
      runways,
      weather: (station && wx.byStation.get(station)) || emptyWeather(),
      localTime: localTimeIso(a.tz, now),
      providers,
      timestamp: new Date(now).toISOString(),
    },
    { ttl: 300 },
  );
});
