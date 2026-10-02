import { describe, expect, it } from 'vitest';
import { runProvider } from '@/lib/feeds';

describe('review: legitimately-empty providers', () => {
  it('MAJOR: runProvider cannot report a legitimately empty upstream (NHC off-season, no squawk 7700) as ok', async () => {
    // NHC CurrentStorms.json with no active storms is a successful, truthful answer.
    const { run } = await runProvider(async () => ({ activeStorms: [] as unknown[] }), (r) => r.activeStorms.length, { allowEmpty: true });
    expect(run.status.ok).toBe(true);
    expect(run.status.age_s).toBe(0);
    // Without the opt-in, zero records is still a failed provider.
    const strict = await runProvider(async () => [] as unknown[], (r) => r.length);
    expect(strict.run.status).toMatchObject({ ok: false, error: 'empty', age_s: null });
  });
});
