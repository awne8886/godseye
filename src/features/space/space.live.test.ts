// Live upstream checks (opt-in: RUN_LIVE_TESTS=1). CelesTrak is deliberately NOT called here: it
// firewalls an IP after 50 errors in 2 h and allows one `active` download per 2-hour update.
import { describe, expect, it } from 'vitest';
import { httpJson } from '@/lib/http';
import { parseKp, parseRtswMag, parseRtswWind, parseXray } from './lib/swpc';
import { parseWhereTheIss, WHERETHEISS_URL } from './server/iss';
import { SWPC_URLS } from './server/space-weather';

const live = process.env.RUN_LIVE_TESTS === '1';

describe('space upstreams (live)', () => {
  it.runIf(live)('SWPC Kp is still an array of objects with zone-less time tags', async () => {
    const { data } = await httpJson<unknown[]>(SWPC_URLS.kp);
    expect(Array.isArray(data)).toBe(true);
    expect(typeof (data![0] as Record<string, unknown>).time_tag).toBe('string');
    expect(parseKp(data).length).toBeGreaterThan(0);
  }, 30_000);

  it.runIf(live)('RTSW has an active spacecraft for plasma and field; GOES has a long-channel sample', async () => {
    const [mag, wind, xr] = await Promise.all([httpJson(SWPC_URLS.rtswMag), httpJson(SWPC_URLS.rtswWind), httpJson(SWPC_URLS.xrays)]);
    expect(parseRtswMag(mag.data)).not.toBeNull();
    expect(parseRtswWind(wind.data)).not.toBeNull();
    expect(parseXray(xr.data).class).toMatch(/^[ABCMX]\d+\.\d$/);
  }, 60_000);

  it.runIf(live)('wheretheiss.at answers a sane position', async () => {
    const { data } = await httpJson(WHERETHEISS_URL);
    expect(parseWhereTheIss(data)).not.toBeNull();
  }, 30_000);
});
