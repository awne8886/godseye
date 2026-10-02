import { describe, expect, it } from 'vitest';
import { maritimeFeed } from '@/features/maritime/server/maritime';

// Phase 3 round 2 R3-M2: a mixed feed that observed nothing live is REFERENCE, never LIVE.
describe('keyless maritime is not LIVE', () => {
  it('with no AIS key nothing was observed, so the feed state is not live', async () => {
    delete process.env.AIS_API_KEY;
    const r = await maritimeFeed.refresh({ force: true });
    expect(r.data?.vessels.length).toBe(0);
    expect(r.meta.observedAt).toBeNull();
    expect(r.meta.state).toBe('reference');
    maritimeFeed.stop?.();
  });
});
