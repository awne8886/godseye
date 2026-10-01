/**
 * Pure status logic for the telemetry row, status-bar LEDs and entity-card badges (§0.3).
 * STATUS reads LIVE only when at least one active, deployable layer is actually live; layer counts
 * exclude layers whose capability the server reports as disabled. Owner: design-system-hud.
 */
import { entityFreshness, formatAge, freshnessLabel } from '@/lib/freshness';
import { OBSERVATION_CADENCE_MS, getLayer, type LayerId } from '@/lib/layer-registry';
import type { LayerStatus } from '@/lib/layer-host';
import { eventTime } from '@/components/panels/intel/event-time';
import type { FeedEvent, FreshnessState } from '@/lib/types';

/**
 * Ticker time for a feed event: its observed instant, or null for date-only sources (CISA KEV
 * `dateAdded` is a calendar day; its 00:00 UTC sort key must never be shown as an age).
 */
export function eventTickerAt(e: Pick<FeedEvent, 'layer' | 'observedAt'>): string | null {
  return eventTime(e, 0).text.endsWith('ago') ? e.observedAt : null;
}

export type HudStatus = 'LIVE' | 'DELAYED' | 'ACQUIRING' | 'OFFLINE' | 'STANDBY' | 'CONNECTING';

export const STATUS_COLOR: Record<HudStatus, string> = {
  LIVE: 'var(--alert-green)',
  DELAYED: 'var(--alert-orange)',
  ACQUIRING: 'var(--cyan-primary)',
  OFFLINE: 'var(--alert-red)',
  STANDBY: 'var(--text-secondary)',
  CONNECTING: 'var(--text-secondary)',
};

export interface StatusInput {
  active: ReadonlySet<string>;
  /** Ids the deployment can serve (visibleLayers(capabilities)). */
  visible: ReadonlySet<string>;
  status: Partial<Record<string, Pick<LayerStatus, 'state'>>>;
  health: 'loading' | 'error' | 'ok';
}

/** Active layers the visitor can actually see (capability-hidden ones excluded). */
export function activeVisible(active: ReadonlySet<string>, visible: ReadonlySet<string>): string[] {
  return [...active].filter((id) => visible.has(id));
}

export function hudStatus({ active, visible, status, health }: StatusInput): HudStatus {
  if (health === 'error') return 'OFFLINE';
  if (health === 'loading') return 'CONNECTING';
  // Reference-only layers (day/night, conflict polygons) never make the platform LIVE.
  const ids = activeVisible(active, visible).filter((id) => getLayer(id)?.kind !== 'reference');
  const states = ids.map((id) => status[id]?.state ?? 'idle');
  if (states.includes('live')) return 'LIVE';
  if (states.some((s) => s === 'recent' || s === 'stale')) return 'DELAYED';
  if (states.includes('loading')) return 'ACQUIRING';
  if (states.includes('offline')) return 'OFFLINE';
  return 'STANDBY';
}

/** Feed state for a layer's status, `null` while nothing has been received yet. */
export function feedStateOf(st: Pick<LayerStatus, 'state'> | undefined): FreshnessState | null {
  if (!st || st.state === 'idle' || st.state === 'loading') return null;
  return st.state;
}

export interface CardBadge {
  state: FreshnessState;
  label: string;
  /** "observed 3m ago" style age text, null when unknown. */
  age: string | null;
}

/**
 * Entity-card freshness badge: the entity's own observation time against its sensor cadence,
 * never better than the feed. Before the feed has reported, the badge shows the entity's age
 * (RECENT) rather than claiming LIVE.
 */
export function cardBadge(opts: {
  layer: LayerId | null;
  observedAt: string | null;
  feed: Pick<LayerStatus, 'state'> | undefined;
  now?: number;
}): CardBadge {
  const now = opts.now ?? Date.now();
  const def = opts.layer ? getLayer(opts.layer) : undefined;
  const at = opts.observedAt ? Date.parse(opts.observedAt) : NaN;
  const atMs = Number.isFinite(at) ? at : null;
  const kind = def?.kind ?? 'live';
  const cadence = opts.layer ? (OBSERVATION_CADENCE_MS as Record<string, number | null>)[opts.layer] ?? null : null;
  const feedState = feedStateOf(opts.feed) ?? 'recent';
  let state = entityFreshness({ kind, at: atMs, observationCadenceMs: cadence, feedState, now });
  // Event layers (no per-entity cadence) inherit the feed state, but an event older than one
  // refresh interval was not observed live (a 16 h-old quake in a LIVE feed is RECENT).
  if (cadence === null && state === 'live' && atMs !== null && def?.refreshMs && now - atMs > def.refreshMs) state = 'recent';
  // Without any observation time a live entity cannot be LIVE.
  const honest: FreshnessState = atMs === null && kind !== 'reference' && state === 'live' ? 'recent' : state;
  return {
    state: honest,
    label: honest === 'recent' && atMs === null ? 'UNTIMED' : freshnessLabel(honest, atMs, now),
    age: atMs === null ? null : `${formatAge(now - atMs)} ago`,
  };
}

/**
 * An idle layer that waits for the map to zoom in (`error: 'zoom_min_6'`, e.g. Sentinel below z6)
 * reads "ZOOM ≥ 6" instead of ACQUIRING or nothing. Null otherwise.
 */
export function zoomGateLabel(st: Pick<LayerStatus, 'state' | 'error'> | undefined): string | null {
  if (!st || st.state !== 'idle' || !st.error?.startsWith('zoom_min_')) return null;
  const z = st.error.slice(9);
  return z ? `ZOOM ≥ ${z}` : null;
}

/** "15S", "2M", "2H", "STATIC", "STREAM" for a layer's refresh interval. */
export function refreshLabel(refreshMs: number | null, transport: string): string {
  if (transport === 'sse') return 'STREAM';
  if (transport === 'static' || transport === 'none' || refreshMs === null) return transport === 'none' ? 'LOCAL' : 'STATIC';
  const s = Math.round(refreshMs / 1000);
  if (s < 60) return `${s}S`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}M`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}H` : `${Math.round(h / 24)}D`;
}

/**
 * Header entity readout (R3-m6). Settled: "N ENTITIES". While map start-up work is still queued the
 * count stays visible but is worded as what it is, entities received from the feeds with drawing
 * still in progress ("N RECEIVED + DRAWING"), never claimed as drawn; with nothing received yet it
 * reads "ENTITIES LOADING".
 */
export function entitiesLabel(count: number, drawPending: boolean): string {
  const n = Math.max(0, Math.round(count)).toLocaleString('en-US');
  if (!drawPending) return `${n} ENTITIES`;
  return count > 0 ? `${n} RECEIVED + DRAWING` : 'ENTITIES LOADING';
}
