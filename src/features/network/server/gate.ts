/**
 * Response for a route whose whole source is behind a capability that is off (licence gate or
 * missing key): 403 with the reason and the provider marked skipped — never an empty list that
 * would read as "nothing happening". Owner: layers-threats-network. Server-only.
 */
import 'server-only';
import { evaluateCapability, type CapabilityId } from '@/lib/capabilities';
import { json } from '@/lib/respond';

export function capabilityGate(capability: CapabilityId, provider: string): Response | null {
  const cap = evaluateCapability(capability);
  if (cap.enabled) return null;
  const skipped = capability === 'nc_sources' || capability === 'deepstate' ? 'licence' : 'not-configured';
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
