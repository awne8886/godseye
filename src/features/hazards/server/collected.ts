/**
 * Shared shape for hazard feeds: the items plus whether any provider actually answered, so a
 * truthful "none right now" (no active storms) is distinguishable from "every upstream failed"
 * (SOURCE OFFLINE). Owner: layers-hazards. Isomorphic.
 */

export interface Collected<T> {
  items: T[];
  /** At least one provider answered successfully (possibly with zero records). */
  answered: boolean;
}

/** Newest `observedAt` (ms epoch) among the items, or null. */
export function newestObservation(items: readonly { observedAt: string | null }[]): number | null {
  let newest = 0;
  for (const it of items) {
    if (!it.observedAt) continue;
    const t = Date.parse(it.observedAt);
    // Future-dated records (validity ends misused as times) never count as the newest observation.
    if (Number.isFinite(t) && t > newest && t <= Date.now() + 60_000) newest = t;
  }
  return newest || null;
}
