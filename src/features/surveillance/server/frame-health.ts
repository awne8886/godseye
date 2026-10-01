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
 * An operator is judged only on evidence about the operator: per camera only the latest attempt
 * counts (one dead camera refreshed every minute cannot mark it unavailable), only operator-wide
 * failures count against it (`operatorWide`: a web page instead of an image, 5xx, network, an
 * operator that used its full request time) — never a missing image (404/410, no snapshot), an
 * address off the allow-list or a wait in this server's own queue (those are not recorded at all) —
 * and at least FRAME_MIN_CAMERAS distinct cameras must have been tried. The state is a label for
 * cards and tiles; it never stops a tile or viewer from requesting its own frame.
 * In-memory per process (it describes what this server saw).
 * Owner: layers-surveillance. Server-only.
 */
import 'server-only';
import type { FrameHealth } from '@/lib/types';

export const FRAME_WINDOW_MS = 10 * 60_000;
/** Distinct cameras that must have been tried before an operator's frames are judged at all. */
export const FRAME_MIN_CAMERAS = 5;
/** Share of tried cameras failing operator-wide (latest attempt) above which frames are unavailable. */
export const FRAME_FAIL_SHARE = 0.9;
/** Share of tried cameras failing operator-wide above which frames are failing (degraded). */
export const FRAME_DEGRADED_SHARE = 0.5;
const MAX_OUTCOMES = 500;

/**
 * True for a failure that says something about the whole operator rather than one camera: a web
 * page instead of an image (an error page served for every still), a 5xx, a network/DNS/TLS failure,
 * an unreadable answer, a redirect loop, or an operator that did not answer within its full request
 * time. A missing image (`upstream_404`/`410`, other 4xx, `no_snapshot`), an oversized file and an
 * address refused by the allow-list (`blocked`) are per camera.
 */
export function operatorWide(error: string | null): boolean {
  if (!error) return false;
  if (error === 'not_an_image' || error === 'network' || error === 'timeout' || error === 'parse' || error === 'redirect') return true;
  const m = /^upstream_(\d{3})$/.exec(error);
  return !!m && Number(m[1]) >= 500;
}

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
  const failing = [...latest.values()].filter((o) => !o.ok);
  const camerasFailing = failing.length;
  const camerasOperatorFault = failing.filter((o) => operatorWide(o.error)).length;
  const judged = cameras >= FRAME_MIN_CAMERAS;
  const state: FrameHealth['state'] =
    cameras === 0
      ? 'unchecked'
      : judged && camerasOperatorFault / cameras > FRAME_FAIL_SHARE
        ? 'unavailable'
        : judged && camerasOperatorFault / cameras > FRAME_DEGRADED_SHARE
          ? 'failing'
          : camerasFailing < cameras
            ? 'available'
            : 'inconclusive';
  const lastObserved = lastOk?.observedAt ?? null;
  return {
    state,
    windowS: FRAME_WINDOW_MS / 1000,
    attempts: win.length,
    ok,
    failed: win.length - ok,
    cameras,
    camerasFailing,
    camerasOperatorFault,
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
