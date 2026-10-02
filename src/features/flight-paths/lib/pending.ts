/**
 * A provider whose refresh is still running in the background (AeroAPI filed route): the response
 * did not wait for it, so it must not be cached as final and the panel polls until it settles.
 * Pure; shared by /api/route/plan and the PATHS panel. Owner: feature-flight-paths.
 */
export const PROVIDER_PENDING = 'pending';

export function hasPendingProvider(providers: Record<string, { ok: boolean; error?: string }> | null | undefined): boolean {
  return Object.values(providers ?? {}).some((p) => !p.ok && p.error === PROVIDER_PENDING);
}
