/**
 * Response for a route whose whole source is behind a capability that is off (licence gate or
 * missing key): 403 with the reason and the provider marked skipped — never an empty list that
 * would read as "nothing happening". Owner: layers-threats-network. Server-only.
 */
import 'server-only';
import { evaluateCapability, type CapabilityId } from '@/lib/capabilities';
import { json } from '@/lib/respond';

/**
 * Why a capability that is off skips its provider: `'licence'` for the licence gates and whenever
 * the reason is COMMERCIAL_DEPLOYMENT (e.g. a Cloudflare token on a commercial deployment), else
 * `'not-configured'` (a missing key). Assumes the capability is off.
 */
export function skipReason(capability: CapabilityId, env: Record<string, string | undefined> = process.env): 'licence' | 'not-configured' {
  if (capability === 'nc_sources' || capability === 'deepstate' || capability === 'openmeteo') return 'licence';
  return /COMMERCIAL_DEPLOYMENT/.test(evaluateCapability(capability, env).reason ?? '') ? 'licence' : 'not-configured';
}

export function capabilityGate(capability: CapabilityId, provider: string): Response | null {
  const cap = evaluateCapability(capability);
  if (cap.enabled) return null;
  const skipped = skipReason(capability);
  return json(
    {
      error: 'capability_disabled',
      detail: `${capability}: ${cap.reason ?? 'disabled'}`,
      capability,
      providers: { [provider]: { ok: false, count: 0, ms: 0, age_s: null, skipped } },
    },
    { status: 403, ttl: 0 },
  );
}
