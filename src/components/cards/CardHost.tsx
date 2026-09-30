'use client';
/**
 * Entity-card host: renders the current selection inside EntityCardFrame with the body from
 * cardFor(kind). Desktop: floating beside the rail; phones: a sheet above the bottom nav. On phones
 * the map is panned so the selected entity sits in the free space above the sheet instead of under
 * it. Owner: design-system-hud.
 */
import { AnimatePresence, motion } from 'motion/react';
import { createElement, useEffect, useRef } from 'react';
import { cardFor } from '@/features/registry';
import { useLayerStatusStore, useMapInstanceStore, useSelectionStore } from '@/lib/layer-host';
import { useIsMobile } from '@/components/hud/hooks';
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

export default function CardHost() {
  const selection = useSelectionStore((s) => s.selection);
  const clear = useSelectionStore((s) => s.clear);
  const feed = useLayerStatusStore((s) => (selection?.layer ? s.status[selection.layer] : undefined));
  const map = useMapInstanceStore((s) => s.map);
  const mobile = useIsMobile();
  const sheet = useRef<HTMLDivElement>(null);
  const body = selection ? cardFor(selection.kind) : null;
  const key = selection ? `${selection.kind}:${selection.id}` : null;
  const lngLat = selection?.lngLat ?? null;

  useEffect(() => {
    if (!mobile || !map || !lngLat || !key) return;
    const raf = requestAnimationFrame(() => {
      const el = sheet.current;
      if (!el) return;
      const p = map.project(lngLat);
      const dy = panToClearSheet(p.y, el.getBoundingClientRect().top);
      if (dy !== 0) map.panBy([0, dy], { duration: 400 });
    });
    return () => cancelAnimationFrame(raf);
    // Once per selected entity (not on every position update of a moving entity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, mobile, map]);

  return (
    <AnimatePresence>
      {selection && body && (
        <motion.div
          ref={sheet}
          key={key}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-x-2 bottom-[calc(60px+env(safe-area-inset-bottom))] z-[var(--z-docked)] flex max-h-[50vh] flex-col md:inset-x-auto md:bottom-auto md:left-16 md:top-28 md:max-h-[calc(100vh-12rem)] md:w-[340px]"
        >
          <EntityCardFrame selection={selection} feed={feed} onClose={clear}>
            {createElement(body, { selection })}
          </EntityCardFrame>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
