import { describe, expect, it } from 'vitest';
import { KEV_FEED_LAYER } from '@/features/network/client/kev-events';
import { eventTickerAt } from './status-logic';

describe('status-bar ticker event times', () => {
  it('keeps the observed instant for timed events', () => {
    expect(eventTickerAt({ layer: 'earthquakes', observedAt: '2026-09-30T21:14:05Z' })).toBe('2026-09-30T21:14:05Z');
  });

  it('shows no age for date-only events (CISA KEV dateAdded)', () => {
    expect(eventTickerAt({ layer: KEV_FEED_LAYER, observedAt: '2026-09-29T00:00:00Z' })).toBeNull();
  });
});
