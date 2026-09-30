'use client';
/**
 * Entity-card host: renders the current selection inside EntityCardFrame with the body from
 * cardFor(kind). Desktop: floating beside the rail; phones: a sheet above the bottom nav.
 * Owner: design-system-hud.
 */
import { AnimatePresence, motion } from 'motion/react';
import { createElement } from 'react';
import { cardFor } from '@/features/registry';
import { useLayerStatusStore, useSelectionStore } from '@/lib/layer-host';
import EntityCardFrame from './EntityCardFrame';

export default function CardHost() {
  const selection = useSelectionStore((s) => s.selection);
  const clear = useSelectionStore((s) => s.clear);
  const feed = useLayerStatusStore((s) => (selection?.layer ? s.status[selection.layer] : undefined));
  const body = selection ? cardFor(selection.kind) : null;
  return (
    <AnimatePresence>
      {selection && body && (
        <motion.div
          key={`${selection.kind}:${selection.id}`}
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
