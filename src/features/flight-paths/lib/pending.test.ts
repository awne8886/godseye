import { describe, expect, it } from 'vitest';
import { PROVIDER_PENDING, hasPendingProvider } from './pending';

describe('pending providers', () => {
  it('only a not-ok provider with error "pending" counts (skipped/offline do not poll)', () => {
    expect(hasPendingProvider({ aeroapi: { ok: false, error: PROVIDER_PENDING } })).toBe(true);
    expect(hasPendingProvider({ aeroapi: { ok: false, error: 'timeout' }, fpdb: { ok: true } })).toBe(false);
    expect(hasPendingProvider({ aeroapi: { ok: false } })).toBe(false);
    expect(hasPendingProvider({})).toBe(false);
    expect(hasPendingProvider(undefined)).toBe(false);
  });
});
