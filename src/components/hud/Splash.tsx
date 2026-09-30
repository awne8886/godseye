'use client';
/**
 * Boot splash: counter-rotating rings, staged progress tied to real readiness (map idle), lifted
 * after ≥ 2.2 s and at most 7 s, exit opacity 0 + scale 1.04 over 0.7 s. Owner: design-system-hud.
 */
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { APP_NAME } from '@/lib/config';
import { useMapInstanceStore } from '@/lib/layer-host';
import { useUiStore } from '@/lib/store';
import GodseyeMark from './GodseyeMark';

const STAGES = ['ESTABLISHING UPLINK…', 'INITIALIZING FEEDS…', 'CALIBRATING SENSORS…', 'SYSTEM READY'] as const;
const WIDTHS = ['25%', '50%', '78%', '100%'] as const;

export default function Splash() {
  const ready = useMapInstanceStore((s) => s.ready);
  const setSplashDone = useUiStore((s) => s.setSplashDone);
  const [stage, setStage] = useState(0);
  const [minElapsed, setMinElapsed] = useState(false);
  const [capped, setCapped] = useState(false);

  useEffect(() => {
    const a = setTimeout(() => setStage((s) => Math.max(s, 1)), 1100);
    const b = setTimeout(() => setMinElapsed(true), 2200);
    const c = setTimeout(() => setCapped(true), 7000);
    return () => [a, b, c].forEach(clearTimeout);
  }, []);
  useEffect(() => {
    if (ready && minElapsed) {
      const t = setTimeout(() => setStage(3), 500);
      return () => clearTimeout(t);
    }
  }, [ready, minElapsed]);

  // Map readiness advances the stage without an extra render pass.
  const shown = ready ? Math.max(stage, 2) : stage;
  const visible = !(capped || (shown === 3 && minElapsed));

  return (
    <AnimatePresence onExitComplete={setSplashDone}>
      {visible && (
        <motion.div
          key="splash"
          role="status"
          aria-live="polite"
          aria-label={`${APP_NAME} loading: ${STAGES[shown]}`}
          className="fixed inset-0 z-[var(--z-splash)] grid place-items-center bg-[radial-gradient(ellipse_at_center,#0a0a14_0%,var(--bg-void)_70%)]"
          exit={{ opacity: 0, scale: 1.04, transition: { duration: 0.7, ease: [0.4, 0, 0.2, 1] } }}
        >
          <div className="flex flex-col items-center">
            <div className="relative h-40 w-40">
              {[
                { inset: 0, dur: 20, dir: 1, color: 'rgba(212,175,55,0.2)' },
                { inset: 18, dur: 12, dir: -1, color: 'rgba(0,229,255,0.15)' },
                { inset: 40, dur: 7, dir: 1, color: 'rgba(212,175,55,0.25)' },
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
            <p className="mt-6 font-mono text-4xl font-bold tracking-[0.5em] text-[var(--gold-primary)]">{APP_NAME}</p>
            <p className="hud-micro mt-2 tracking-[0.5em] text-[rgba(212,175,55,0.8)]">GLOBAL INTELLIGENCE PLATFORM</p>
            <div className="mt-6 h-0.5 w-64 overflow-hidden bg-[rgba(212,175,55,0.1)]">
              <motion.div className="h-full bg-gradient-to-r from-[var(--gold-primary)] via-[var(--cyan-primary)] to-[var(--gold-primary)]" animate={{ width: WIDTHS[shown] }} transition={{ duration: 0.55 }} />
            </div>
            <p className={`hud-micro mt-3 tracking-[0.25em] ${shown === 3 ? 'text-[var(--cyan-primary)]' : 'text-[var(--text-secondary)]'}`}>{STAGES[shown]}</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
