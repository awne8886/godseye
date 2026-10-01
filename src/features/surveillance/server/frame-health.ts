/**
 * Frame availability ledger: the outcome of every frame this server relays (stills proxy, TxDOT
 * snapshots, stream-status probes), per provider, over a rolling 10-minute window. Only the outcome
 * is kept — ok/failed, the failure reason, the operator's frame time — never the bytes.
 *
 * Why: an operator can keep publishing its camera list while every frame is broken (Transport for
 * NSW served a 307-byte HTML "temporarily unavailable" page for every `.jpeg`, 2026-09-30 → 10-01).
 * The inventory then reports `ok: true`, so /api/cctv/providers adds `frames` from this ledger and
 * the client marks such cameras FRAMES UNAVAILABLE instead of drawing broken images.
 *
 * Per camera only the latest attempt counts, so one dead camera refreshed every minute cannot mark
 * a whole operator unavailable. In-memory per process (it describes what this server saw).
 * Owner: layers-surveillance. Server-only.
 */
import 'server-only';
import type { FrameHealth } from '@/lib/types';

export const FRAME_WINDOW_MS = 10 * 60_000;
/** Distinct cameras that must have been tried before an operator's frames are called unavailable. */
export const FRAME_MIN_CAMERAS = 3;
/** Share of tried cameras failing (latest attempt) above which frames are unavailable. */
export const FRAME_FAIL_SHARE = 0.9;
const MAX_OUTCOMES = 500;

export interface FrameOutcome {
  at: number;
  cameraId: string;
  ok: boolean;
  error: string | null;
  /** Operator frame time (ms epoch) of a relayed frame; null when none was published. */
  observedAt: number | null;
}

const G = globalThis as unknown as { __godseyeFrameHealth?: Map<string, FrameOutcome[]> };
const LEDGER: Map<string, FrameOutcome[]> = (G.__godseyeFrameHealth ??= new Map());

function prune(list: FrameOutcome[], now: number): FrameOutcome[] {
  const from = now - FRAME_WINDOW_MS;
  let i = 0;
  while (i < list.length && list[i]!.at < from) i++;
  const kept = i ? list.slice(i) : list;
  return kept.length > MAX_OUTCOMES ? kept.slice(kept.length - MAX_OUTCOMES) : kept;
}

/** Record one frame attempt for `providerId`. */
export function recordFrame(providerId: string, outcome: Omit<FrameOutcome, 'at'> & { at?: number }): void {
  const at = outcome.at ?? Date.now();
  const list = prune(LEDGER.get(providerId) ?? [], at);
  list.push({ ...outcome, at });
  LEDGER.set(providerId, list);
}

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

/** Pure summary of a provider's outcomes inside the window ending at `now`. */
export function summarise(outcomes: readonly FrameOutcome[], now: number = Date.now()): FrameHealth {
  const from = now - FRAME_WINDOW_MS;
  const win = outcomes.filter((o) => o.at >= from && o.at <= now + 1_000);
  const latest = new Map<string, FrameOutcome>();
  const errors: Record<string, number> = {};
  let ok = 0;
  let lastOk: FrameOutcome | null = null;
  let lastFail: FrameOutcome | null = null;
  let untimed = 0;
  for (const o of win) {
    const prev = latest.get(o.cameraId);
    if (!prev || o.at >= prev.at) latest.set(o.cameraId, o);
    if (o.ok) {
      ok++;
      if (o.observedAt === null) untimed++;
      if (!lastOk || o.at >= lastOk.at) lastOk = o;
    } else {
      errors[o.error ?? 'error'] = (errors[o.error ?? 'error'] ?? 0) + 1;
      if (!lastFail || o.at >= lastFail.at) lastFail = o;
    }
  }
  const cameras = latest.size;
  const camerasFailing = [...latest.values()].filter((o) => !o.ok).length;
  const state: FrameHealth['state'] =
    cameras === 0
      ? 'unchecked'
      : cameras >= FRAME_MIN_CAMERAS && camerasFailing / cameras > FRAME_FAIL_SHARE
        ? 'unavailable'
        : camerasFailing === cameras
          ? 'failing'
          : 'available';
  const lastObserved = lastOk?.observedAt ?? null;
  return {
    state,
    windowS: FRAME_WINDOW_MS / 1000,
    attempts: win.length,
    ok,
    failed: win.length - ok,
    cameras,
    camerasFailing,
    errors,
    lastOkAt: iso(lastOk?.at ?? null),
    lastFailAt: iso(lastFail?.at ?? null),
    lastError: lastFail?.error ?? null,
    // Age of that frame when it was fetched (operator time vs fetch time); a future time is not an age.
    lastFrameAge_s: lastOk && lastObserved !== null && lastObserved <= lastOk.at + 60_000 ? Math.max(0, Math.round((lastOk.at - lastObserved) / 1000)) : null,
    untimed,
  };
}

/** Frame availability for each provider id. */
export function frameHealth(providerIds: readonly string[], now: number = Date.now()): Record<string, FrameHealth> {
  const out: Record<string, FrameHealth> = {};
  for (const id of providerIds) out[id] = summarise(LEDGER.get(id) ?? [], now);
  return out;
}

/** Test hook: forget every outcome. */
export function resetFrameHealth(): void {
  LEDGER.clear();
}
