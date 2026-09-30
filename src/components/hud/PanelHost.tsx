'use client';
/**
 * Panel host: the one open side panel (360 px glass with instrument chrome) plus up to six pinned
 * panels beside it on desktop; a bottom sheet with the tab's sibling panels on phones. Modal panels
 * (palette, help, Style Studio) render their own dialogs. Components come from panelFor(id).
 * Owner: design-system-hud.
 */
import { AnimatePresence, motion } from 'motion/react';
import { createElement, useCallback } from 'react';
import { panelFor } from '@/features/registry';
import { MOBILE_SHEETS, type PanelId } from '@/lib/tool-registry';
import { useUiStore } from '@/lib/store';
import { useShallow } from 'zustand/react/shallow';
import { isPanelAvailable, useHasBluetooth, useIsMobile } from './hooks';
import { InstrumentFrame } from './PanelChrome';
import { MODAL_PANELS, panelLabel, tabForPanel } from './panel-meta';

const EASE = [0.22, 1, 0.36, 1] as const;

/** Registered components are static module exports; createElement keeps the lookup out of JSX. */
function PanelBody({ id, onClose }: { id: PanelId; onClose: () => void }) {
  const comp = panelFor(id);
  return comp ? createElement(comp, { onClose }) : null;
}

function SidePanel({ id, pinned }: { id: PanelId; pinned: boolean }) {
  const { setOpenPanel, pinPanel, unpinPanel, closeDossier } = useUiStore(
    useShallow((s) => ({ setOpenPanel: s.setOpenPanel, pinPanel: s.pinPanel, unpinPanel: s.unpinPanel, closeDossier: s.closeDossier })),
  );
  const pinnedCount = useUiStore((s) => s.pinnedPanels.length);
  const close = useCallback(() => {
    if (pinned) unpinPanel(id);
    else if (id === 'dossier') closeDossier();
    else setOpenPanel(null);
  }, [pinned, id, unpinPanel, closeDossier, setOpenPanel]);
  const togglePin = () => {
    if (pinned) {
      unpinPanel(id);
      setOpenPanel(id);
    } else {
      setOpenPanel(null);
      pinPanel(id);
    }
  };
  const canPin = pinned || (id !== 'dossier' && pinnedCount < 6);
  return (
    <InstrumentFrame title={panelLabel(id)} onClose={close} onPin={canPin ? togglePin : undefined} pinned={pinned} className="glass-panel h-full">
      <PanelBody id={id} onClose={close} />
    </InstrumentFrame>
  );
}

export default function PanelHost() {
  const openPanel = useUiStore((s) => s.openPanel);
  const pinned = useUiStore((s) => s.pinnedPanels);
  const setOpenPanel = useUiStore((s) => s.setOpenPanel);
  const mobile = useIsMobile();
  const bt = useHasBluetooth();

  const modal = openPanel && MODAL_PANELS.has(openPanel) && isPanelAvailable(openPanel, bt) ? openPanel : null;
  const side = openPanel && !MODAL_PANELS.has(openPanel) && isPanelAvailable(openPanel, bt) ? openPanel : null;
  const pinnedShown = pinned.filter((p) => !MODAL_PANELS.has(p) && isPanelAvailable(p, bt));

  return (
    <>
      {modal && <PanelBody id={modal} onClose={() => setOpenPanel(null)} />}
      {mobile ? (
        <MobileSheet id={side} />
      ) : (
        <>
          <AnimatePresence initial={false}>
            {side && (
              <motion.div
                key={side}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.22, ease: EASE }}
                className="fixed bottom-10 right-16 top-16 z-[var(--z-docked)] w-[var(--panel-width)]"
                style={side === 'dossier' ? { zIndex: 'var(--z-dossier)' } : undefined}
              >
                <SidePanel id={side} pinned={false} />
              </motion.div>
            )}
          </AnimatePresence>
          {pinnedShown.length > 0 && (
            <div
              className="fixed bottom-10 top-16 z-[var(--z-docked)] flex w-[var(--panel-width)] flex-col gap-3"
              style={{ right: side ? 'calc(4rem + var(--panel-width) + var(--panel-gap))' : '4rem' }}
              aria-label="Pinned panels"
              role="group"
            >
              {pinnedShown.map((p) => (
                <div key={p} className="min-h-[120px] flex-1">
                  <SidePanel id={p} pinned />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function MobileSheet({ id }: { id: PanelId | null }) {
  const setOpenPanel = useUiStore((s) => s.setOpenPanel);
  const closeDossier = useUiStore((s) => s.closeDossier);
  const bt = useHasBluetooth();
  const tab = tabForPanel(id);
  const siblings = (tab ? (MOBILE_SHEETS[tab] as readonly PanelId[]) : id ? [id] : []).filter((p) => isPanelAvailable(p, bt));
  const close = () => (id === 'dossier' ? closeDossier() : setOpenPanel(null));
  return (
    <AnimatePresence>
      {id && (
        <motion.div
          key="sheet"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', stiffness: 380, damping: 36 }}
          className="fixed inset-x-0 z-[var(--z-docked)] flex max-h-[55vh] min-h-[40vh] flex-col"
          style={{ bottom: 'calc(56px + env(safe-area-inset-bottom))' }}
        >
          <div className="glass-3 flex min-h-0 flex-1 flex-col rounded-b-none">
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-[var(--gold-dim)]" aria-hidden />
            {siblings.length > 1 && (
              <div role="tablist" aria-label="Sheet sections" className="flex gap-1 overflow-x-auto px-3 pt-2">
                {siblings.map((p) => (
                  <button
                    key={p}
                    role="tab"
                    type="button"
                    aria-selected={p === id}
                    onClick={() => setOpenPanel(p)}
                    className={`hud-micro hud-control min-h-[44px] shrink-0 border px-3 ${p === id ? 'border-[var(--border-active)] bg-[rgba(var(--gold-rgb),0.12)] text-[var(--gold-light)]' : 'border-transparent text-[var(--text-secondary)]'}`}
                  >
                    {panelLabel(p)}
                  </button>
                ))}
              </div>
            )}
            <InstrumentFrame key={id} title={panelLabel(id)} onClose={close} className="min-h-0 flex-1">
              <PanelBody id={id} onClose={close} />
            </InstrumentFrame>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
