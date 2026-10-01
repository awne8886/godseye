'use client';
/**
 * Entity-card host: renders the current selection inside EntityCardFrame with the body from
 * cardFor(kind). Desktop: floating beside the rail; phones: a sheet above the bottom nav. On phones
 * the map is panned so the selected entity sits in the free space above the sheet instead of under
 * it, re-checked while the card grows as its body loads (m7), and the sheet's height is reserved so
 * the map attribution stays visible above it. Owner: design-system-hud.
 */
import { AnimatePresence, m, useIsPresent } from 'motion/react';
import { createElement, useEffect, useRef } from 'react';
import { cardFor } from '@/features/registry';
import { useLayerStatusStore, useMapInstanceStore, useSelectionStore, type Selection } from '@/lib/layer-host';
import { occupiedFromBottom, useBottomReserve, useIsMobile } from '@/components/hud/hooks';
import EntityCardFrame from './EntityCardFrame';

/**
 * Vertical pan (px, positive = move the map content up) that brings a point at screen y into the
 * middle of the space above a sheet whose top edge is at `sheetTop`; 0 when it is already clear.
 */
export function panToClearSheet(pointY: number, sheetTop: number, topInset = 56, margin = 24): number {
  if (pointY < sheetTop - margin) return 0;
  const target = topInset + (sheetTop - topInset) / 2;
  return Math.round(pointY - target);
}

/** How long after selection a growing card (body still loading) may still move the map. */
export const CARD_SETTLE_MS = 2500;

function CardSheet({ selection, onClose }: { selection: Selection; onClose: () => void }) {
  const feed = useLayerStatusStore((s) => (selection.layer ? s.status[selection.layer] : undefined));
  const map = useMapInstanceStore((s) => s.map);
  const mobile = useIsMobile();
  const present = useIsPresent();
  const sheet = useRef<HTMLDivElement>(null);
  useBottomReserve(sheet, '--card-occupied', mobile && present);
  const body = cardFor(selection.kind);
  const lngLat = selection.lngLat ?? null;

  useEffect(() => {
    const el = sheet.current;
    if (!mobile || !map || !lngLat || !el) return;
    const started = performance.now();
    let raf = 0;
    const check = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const occupied = occupiedFromBottom(el);
        if (occupied === null) return;
        const p = map.project(lngLat);
        const dy = panToClearSheet(p.y, window.innerHeight - occupied);
        if (dy !== 0) map.panBy([0, dy], { duration: 400 });
      });
    };
    check();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => performance.now() - started < CARD_SETTLE_MS && check());
    ro?.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
    // Once per selected entity (the parent keys this component), not on every position update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobile, map]);

  if (!body) return null;
  return (
    <m.div
      ref={sheet}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      inert={!present}
      aria-hidden={present ? undefined : true}
      className="fixed inset-x-2 bottom-[calc(60px+env(safe-area-inset-bottom))] z-[var(--z-docked)] flex max-h-[50vh] flex-col md:inset-x-auto md:bottom-auto md:left-16 md:top-28 md:max-h-[calc(100vh-12rem)] md:w-[340px]"
    >
      <EntityCardFrame selection={selection} feed={feed} onClose={onClose}>
        {createElement(body, { selection })}
      </EntityCardFrame>
    </m.div>
  );
}

export default function CardHost() {
  const selection = useSelectionStore((s) => s.selection);
  const clear = useSelectionStore((s) => s.clear);
  const key = selection ? `${selection.kind}:${selection.id}` : null;
  return <AnimatePresence>{selection && cardFor(selection.kind) && <CardSheet key={key} selection={selection} onClose={clear} />}</AnimatePresence>;
}
