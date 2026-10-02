'use client';
/**
 * One freshness verdict per entity card (r8). EntityCardFrame computes the badge once (cardBadge)
 * and hands it to the body through context. A body that knows better inputs than the rail — its
 * feed's own meta.state and the record's latest observation (aviation: the rail is downgraded when
 * most of the layer's aircraft are past the 60 s cap, and the selection snapshot's time ages while
 * the live record is re-observed) — reports them with `useCardFreshness` and renders the badge it
 * returns instead of computing its own, so header and body can never disagree.
 * Owner: design-system-hud.
 */
import { createContext, useContext, useEffect, useLayoutEffect } from 'react';
import type { LayerId } from '@/lib/layer-registry';
import type { LayerStatus } from '@/lib/layer-host';
import type { FreshnessState } from '@/lib/types';
import { cardBadge, type CardBadge } from '@/components/hud/status-logic';

/** What a card body may tell the frame. `undefined` = keep the frame's own input. */
export interface CardFreshnessReport {
  /** The feed's own state (meta.state); replaces the rail state. */
  feedState?: FreshnessState | null;
  /** The record's latest observation (ISO); replaces the selection snapshot's time. */
  observedAt?: string | null;
}

export interface CardFreshnessContextValue {
  badge: CardBadge;
  report: (r: CardFreshnessReport) => void;
}

export const CardFreshnessContext = createContext<CardFreshnessContextValue | null>(null);

/** Same report (no re-render loop when a body re-reports unchanged inputs). */
export function sameReport(a: CardFreshnessReport | null, b: CardFreshnessReport | null): boolean {
  return a === b || (!!a && !!b && a.feedState === b.feedState && a.observedAt === b.observedAt);
}

/** The frame's inputs after a body's report: reported values win, absent ones fall back. */
export function applyReport(
  base: { observedAt: string | null; feed: Pick<LayerStatus, 'state'> | undefined },
  report: CardFreshnessReport | null,
): { observedAt: string | null; feed: Pick<LayerStatus, 'state'> | undefined; feedState: FreshnessState | null } {
  return {
    observedAt: report?.observedAt !== undefined ? report.observedAt : base.observedAt,
    feed: base.feed,
    feedState: report?.feedState ?? null,
  };
}

// Layout effect so the first painted frame already carries the reported inputs (no flash of the
// rail verdict); plain effect on the server, where cards never render.
const useReportEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Report a body's freshness inputs to the enclosing EntityCardFrame and get back the one badge the
 * frame shows. Outside a frame (a body rendered on its own) the same cardBadge runs on the same
 * inputs, so the verdict is identical either way.
 */
export function useCardFreshness(opts: {
  layer: LayerId | null;
  feed: Pick<LayerStatus, 'state'> | undefined;
  feedState?: FreshnessState | null;
  observedAt?: string | null;
  now: number;
}): CardBadge {
  const ctx = useContext(CardFreshnessContext);
  const report = ctx?.report;
  const { feedState, observedAt } = opts;
  useReportEffect(() => {
    report?.({ feedState, observedAt });
  }, [report, feedState, observedAt]);
  if (ctx) return ctx.badge;
  const inputs = applyReport({ observedAt: null, feed: opts.feed }, { feedState, observedAt });
  return cardBadge({ layer: opts.layer, ...inputs, now: opts.now });
}
