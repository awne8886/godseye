// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hazardStatus } from '@/features/hazards/client/useHazardData';
import { useLayerStatusStore } from '@/lib/layer-host';
import { getLayer } from '@/lib/layer-registry';
import { useUiStore } from '@/lib/store';
import type { FeedMeta, Providers } from '@/lib/types';
import { LayerRow } from './LayerRows';

/**
 * design-system-hud, Phase 3 round 10 MAJOR: the rail credits the feed's meta.attribution, and the
 * provider fallback (a feed without attribution) never names a provider the server skipped.
 */

const AVIATION_PROVIDERS: Providers = {
  adsblol_tiles: { ok: true, count: 5657, ms: 0, age_s: 181 },
  adsblol_mil: { ok: true, count: 127, ms: 1579, age_s: 21 },
  adsblol_reapi: { ok: false, count: 0, ms: 0, age_s: null, skipped: 'not-configured' },
  opensky: { ok: false, count: 0, ms: 0, age_s: null, skipped: 'not-configured' },
  adsbfi_mil: { ok: false, count: 0, ms: 0, age_s: null, skipped: 'licence' },
};

const USGS = { text: 'Earthquakes: U.S. Geological Survey (USGS) Earthquake Hazards Program', url: 'https://earthquake.usgs.gov/earthquakes/feed/', licence: 'Public domain' };

beforeEach(() => {
  useLayerStatusStore.setState({ status: {} });
  useUiStore.getState().setLayer('flights', true);
});
afterEach(cleanup);

function row() {
  return render(
    <ul>
      <LayerRow layer={getLayer('flights')!} />
    </ul>,
  );
}

describe('r10 layer attribution', () => {
  it('the provider fallback drops skipped providers and uses catalogue names', () => {
    useLayerStatusStore.getState().update('flights', { state: 'live', count: 5784, providers: AVIATION_PROVIDERS });
    const { container } = row();
    const source = [...container.querySelectorAll('p')].find((p) => p.textContent?.startsWith('Source:'));
    expect(source?.textContent).toBe('Source: adsb.lol');
    expect(source?.textContent).not.toMatch(/opensky|adsbfi|adsb\.fi/i);
  });

  it('a feed attribution replaces the provider fallback', () => {
    const credit = { text: 'Aircraft data © adsb.lol contributors, ODbL 1.0', url: 'https://www.adsb.lol/', licence: 'ODbL-1.0' };
    useLayerStatusStore.getState().update('flights', { state: 'live', count: 5784, providers: AVIATION_PROVIDERS, attribution: [credit] });
    const { container } = row();
    expect(screen.getByTestId('attribution-flights').textContent).toBe('Aircraft data © adsb.lol contributors, ODbL 1.0 · ODbL-1.0');
    expect([...container.querySelectorAll('p')].some((p) => p.textContent?.startsWith('Source:'))).toBe(false);
  });

  it('hazardStatus carries meta.attribution on a live answer and on SOURCE OFFLINE', () => {
    const meta = { feed: 'earthquakes', kind: 'live', state: 'live', fetchedAt: '2026-10-02T02:44:21.190Z', observedAt: '2026-10-01T21:01:41.707Z', lastGoodAt: '2026-10-02T02:44:21.190Z', stale: false, ttlSeconds: 60, attribution: [USGS] } as FeedMeta;
    const providers: Providers = { usgs: { ok: true, count: 36, ms: 202, age_s: 51 } };
    const now = Date.parse('2026-10-02T02:44:30Z');
    const live = hazardStatus({ result: { ok: true, body: { meta, providers }, receivedAt: now }, failedAt: null, refreshMs: 60_000 }, () => 36, now);
    expect(live.patch?.attribution).toEqual([USGS]);
    const offline = hazardStatus({ result: { ok: false, body: { meta, providers }, receivedAt: now }, failedAt: null, refreshMs: 60_000 }, () => 36, now);
    expect(offline.patch?.state).toBe('offline');
    expect(offline.patch?.attribution).toEqual([USGS]);
  });
});
