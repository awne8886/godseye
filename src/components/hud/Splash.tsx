'use client';
/**
 * Boot splash: counter-rotating rings, staged progress tied to real readiness (map idle + first two
 * core feeds, see splash-logic.ts), lifted after ≥ 2.2 s and at most 7 s; exit opacity 0 + scale
 * 1.04 over 0.7 s. The wordmark is server-rendered and painted from the first frame (it is the LCP
 * element): letters rise into place but never start transparent. Owner: design-system-hud.
 */
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { APP_NAME } from '@/lib/config';
import { useLayerStatusStore, useMapInstanceStore } from '@/lib/layer-host';
import { useUiStore } from '@/lib/store';
import GodseyeMark from './GodseyeMark';
import { SPLASH_CAP_MS, SPLASH_STAGES, feedsReady, splashStage } from './splash-logic';

const WIDTHS = ['25%', '50%', '78%', '100%'] as const;

export default function Splash() {
  const mapReady = useMapInstanceStore((s) => s.ready);
  const active = useUiStore((s) => s.activeLayers);
  const status = useLayerStatusStore((s) => s.status);
  const setSplashDone = useUiStore((s) => s.setSplashDone);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = performance.now();
    const t = setInterval(() => {
      const e = performance.now() - start;
      setElapsed(e);
      if (e >= SPLASH_CAP_MS) clearInterval(t);
    }, 250);
    return () => clearInterval(t);
  }, []);

  const [lifted, setLifted] = useState(false);
  const stage = splashStage({ elapsedMs: elapsed, mapReady, feedsReady: feedsReady(active, status) });
  // Hold SYSTEM READY for half a second so the last stage is readable.
  useEffect(() => {
    if (stage !== 3) return;
    const t = setTimeout(() => setLifted(true), 500);
    return () => clearTimeout(t);
  }, [stage]);
  const visible = !lifted && elapsed < SPLASH_CAP_MS;

  return (
    <AnimatePresence onExitComplete={setSplashDone}>
      {visible && (
        <motion.div
          key="splash"
          role="status"
          aria-live="polite"
          aria-label={`${APP_NAME} loading: ${SPLASH_STAGES[stage]}`}
          className="fixed inset-0 z-[var(--z-splash)] grid place-items-center bg-[radial-gradient(ellipse_at_center,var(--bg-secondary)_0%,var(--bg-void)_70%)]"
          exit={{ opacity: 0, scale: 1.04, transition: { duration: 0.7, ease: [0.4, 0, 0.2, 1] } }}
        >
          <div className="flex flex-col items-center">
            <div className="relative h-40 w-40">
              {[
                { inset: 0, dur: 20, dir: 1, color: 'rgba(var(--gold-rgb),0.2)' },
                { inset: 18, dur: 12, dir: -1, color: 'rgba(var(--cyan-rgb),0.15)' },
                { inset: 40, dur: 7, dir: 1, color: 'rgba(var(--gold-rgb),0.25)' },
              ].map((r, i) => (
                <motion.div
                  key={i}
                  className="absolute rounded-full border"
                  style={{ inset: r.inset, borderColor: r.color }}
                  animate={{ rotate: 360 * r.dir }}
                  transition={{ duration: r.dur, repeat: Infinity, ease: 'linear' }}
                >
                  <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full" style={{ background: i === 1 ? 'var(--cyan-primary)' : 'var(--gold-primary)' }} />
                </motion.div>
              ))}
              <div className="absolute inset-0 grid place-items-center">
                <GodseyeMark size={56} />
              </div>
            </div>
            <p className="mt-6 font-mono text-[40px] font-bold leading-none tracking-[0.5em] text-[var(--gold-primary)]" aria-hidden>
              {APP_NAME.split('').map((ch, i) => (
                <span key={i} className="splash-letter" style={{ animationDelay: `${i * 70}ms` }}>
                  {ch}
                </span>
              ))}
            </p>
            <p className="hud-micro mt-3 tracking-[0.5em] text-[var(--gold-light)]">GLOBAL INTELLIGENCE PLATFORM</p>
            <div className="mt-6 h-0.5 w-64 overflow-hidden bg-[rgba(var(--gold-rgb),0.1)]">
              <motion.div
                className="h-full bg-gradient-to-r from-[var(--gold-primary)] via-[var(--cyan-primary)] to-[var(--gold-primary)]"
                initial={false}
                animate={{ width: WIDTHS[stage] }}
                style={{ width: WIDTHS[stage] }}
                transition={{ duration: 0.55 }}
              />
            </div>
            <p className={`hud-micro mt-3 tracking-[0.25em] ${stage === 3 ? 'text-[var(--cyan-primary)]' : 'text-[var(--text-secondary)]'}`}>{SPLASH_STAGES[stage]}</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
