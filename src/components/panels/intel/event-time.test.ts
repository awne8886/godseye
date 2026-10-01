/** R3 round-2 m3: KEV Intel Feed rows show a date (no invented time of day) and a proper label. */
import { describe, expect, it } from 'vitest';
import { kevEvents, KEV_FEED_LAYER } from '@/features/network/client/kev-events';
import { eventLayerLabel, eventTime } from './event-time';

const kev = kevEvents([
  { cveId: 'CVE-2026-12345', vendor: 'Acme', product: 'Gateway', name: 'Acme Gateway RCE', dateAdded: '2026-09-30', dueDate: '2026-10-21', ransomware: 'Unknown', description: '' },
])[0]!;

describe('Intel Feed event time', () => {
  it('renders a date-only KEV event as its date, never an age or 00:00', () => {
    const t = eventTime(kev, Date.parse('2026-10-01T02:00:00Z'));
    expect(t.text).toBe('2026-09-30');
    expect(t.text).not.toMatch(/ago|00:00/);
    expect(t.title).toMatch(/date only/);
  });
  it('renders an observed instant as an age', () => {
    expect(eventTime({ layer: 'earthquakes', observedAt: '2026-10-01T01:00:00.000Z' }, Date.parse('2026-10-01T02:00:00Z')).text).toMatch(/ago$/);
  });
  it('labels the KEV layer "CISA KEV" instead of the raw id', () => {
    expect(eventLayerLabel(KEV_FEED_LAYER)).toBe('CISA KEV');
    expect(eventLayerLabel('no-such-layer')).toBe('no-such-layer');
  });
});
