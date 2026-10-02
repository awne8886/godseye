// @vitest-environment jsdom
/**
 * Verification round 7 (MINOR, honesty): the SPACE panel badged the ISS readout LIVE, but
 * wheretheiss.at computes that position from a TLE; it is not an observation. The badge now says
 * COMPUTED (and ages: COMPUTED · 2m → STALE), and the readout names the TLE epoch.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IssResponse } from '@/lib/types';
import { fx } from './__fixtures__';

const NOW = Date.parse('2026-10-02T07:20:00Z');
let issBody: IssResponse;

vi.mock('./client/data', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchIss: () => Promise.resolve(issBody),
  fetchSatelliteById: () => new Promise(() => undefined),
  useNow: () => NOW,
}));

const { SpacePanel, issBadge } = await import('./SpacePanel');

function body(observedAt: string, elementsEpoch: string | null, state: IssResponse['meta']['state'] = 'live'): IssResponse {
  const r = fx.iss as Record<string, number | string>;
  return {
    meta: {
      feed: 'iss',
      kind: 'live',
      state,
      fetchedAt: observedAt,
      observedAt,
      lastGoodAt: observedAt,
      stale: false,
      ttlSeconds: 5,
      attribution: [{ text: 'ISS position: Where the ISS at?', url: 'https://wheretheiss.at/w/developer' }],
    },
    providers: { wheretheiss: { ok: true, count: 1, ms: 300, age_s: 0 } },
    lat: r.latitude as number,
    lng: r.longitude as number,
    altKm: r.altitude as number,
    velocityKmH: r.velocity as number,
    visibility: 'eclipsed',
    position: { method: 'propagated', by: 'wheretheiss.at', elementsEpoch },
    groundTrack: null,
  } as IssResponse;
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SpacePanel {...({} as Parameters<typeof SpacePanel>[0])} />
    </QueryClientProvider>,
  );
}

afterEach(() => cleanup());

describe('SPACE panel ISS badge', () => {
  it('a fresh wheretheiss.at position is COMPUTED with its TLE epoch, never LIVE', async () => {
    issBody = body(new Date(NOW - 3_000).toISOString(), '2026-09-30T20:27:19.352Z');
    mount();
    await screen.findByText('2026-09-30 20:27 UTC');
    const badge = screen.getByTestId('iss-badge');
    expect(badge.textContent).toBe('Computed');
    expect(badge.textContent).not.toMatch(/live/i);
    expect(badge.style.color).toBe('var(--cyan-primary)');
    expect(badge.getAttribute('title')).toMatch(/not observed/);
    expect(screen.getByText('2026-09-30 20:27 UTC')).toBeTruthy();
    expect(screen.getByText(/position computed by wheretheiss\.at from TLE elements/)).toBeTruthy();
  });

  it('says the TLE epoch is unknown rather than inventing one', async () => {
    issBody = body(new Date(NOW - 3_000).toISOString(), null);
    mount();
    expect(await screen.findByText('Unknown')).toBeTruthy();
    expect(screen.getByTestId('iss-badge').textContent).toBe('Computed');
  });

  it('still ages: COMPUTED · age, then STALE / OFFLINE from the feed', () => {
    expect(issBadge('live', NOW, NOW)).toMatchObject({ label: 'Computed', computed: true });
    expect(issBadge('recent', NOW - 120_000, NOW)).toMatchObject({ label: 'Computed · 2m', colorToken: '--gold-primary' });
    expect(issBadge('stale', NOW - 3_600_000, NOW)).toMatchObject({ label: 'STALE', computed: false });
    expect(issBadge('offline', null, NOW)).toMatchObject({ label: 'OFFLINE', computed: false });
  });
});
