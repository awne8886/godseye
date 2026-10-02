// Phase 1 review A regression (R-A5).
import { describe, expect, it } from 'vitest';
import { useFeedEventStore } from '@/lib/layer-host';
import type { FeedEvent } from '@/lib/types';

const ev = (p: Partial<FeedEvent>): FeedEvent => ({
  id: '1102983',
  layer: 'earthquakes',
  entityKind: 'earthquake',
  entityId: '1102983',
  title: 't',
  severity: 'info',
  observedAt: '2026-09-30T17:00:00Z',
  source: 's',
  ...p,
});

describe('R-A5 Intel Feed dedupe is by bare id across all layers', () => {
  it('two layers emitting the same upstream numeric id both survive', () => {
    useFeedEventStore.getState().push([ev({ layer: 'global_incidents', entityKind: 'gdacs_incident', title: 'GDACS EQ' })]);
    useFeedEventStore.getState().push([ev({ layer: 'gdelt_events', entityKind: 'gdelt_event', title: 'GDELT row' })]);
    expect(useFeedEventStore.getState().events).toHaveLength(2);
  });

  it('orders same-second events with and without milliseconds by time, not by string', () => {
    useFeedEventStore.setState({ events: [] });
    useFeedEventStore.getState().push([
      ev({ id: 'a', observedAt: '2026-09-30T17:00:00Z' }),
      ev({ id: 'b', observedAt: '2026-09-30T17:00:00.900Z' }),
    ]);
    expect(useFeedEventStore.getState().events[0]!.id).toBe('b');
  });
});
