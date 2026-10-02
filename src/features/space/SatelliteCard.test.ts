import { describe, expect, it } from 'vitest';
import { FUTURE_EPOCH_SLACK_MS, epochAgeNote } from './SatelliteCard';

const NOW = Date.parse('2026-10-02T12:00:00Z');

describe('epochAgeNote (r10 MINOR 2)', () => {
  it('reports the age of a past epoch', () => {
    expect(epochAgeNote('2026-10-02T09:00:00Z', NOW)).toBe('3h old');
    expect(epochAgeNote('2026-10-02T11:59:30Z', NOW)).toBe('30s old');
  });

  it('a predicted epoch 51 h ahead (CXO, NORAD 25867) is "in the future", never "0s old"', () => {
    expect(epochAgeNote(new Date(NOW + 51 * 3_600_000).toISOString(), NOW)).toBe('epoch in the future');
  });

  it('tolerates up to a minute of clock skew', () => {
    expect(epochAgeNote(new Date(NOW + FUTURE_EPOCH_SLACK_MS).toISOString(), NOW)).toBe('0s old');
    expect(epochAgeNote(new Date(NOW + FUTURE_EPOCH_SLACK_MS + 1000).toISOString(), NOW)).toBe('epoch in the future');
  });

  it('an unparseable epoch is not given an age', () => {
    expect(epochAgeNote('not a date', NOW)).toBe('epoch unknown');
  });
});
