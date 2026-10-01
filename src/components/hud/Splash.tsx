'use client';
/**
 * Boot splash: counter-rotating rings, staged progress tied to real readiness (map idle + first two
 * core feeds, see splash-logic.ts), lifted after ≥ 2.2 s and at most 7 s; exit opacity 0 + scale
 * 1.04 over 0.7 s. The wordmark is server-rendered and painted from the first frame (it is the LCP
 * element): letters rise into place but never start transparent.
 * CSS only (perf m-d): the splash is first-paint UI, so it must not pull motion into the first-load
 * bundle. Rings are CSS keyframes (compositor, no per-frame JS), the bar is a width transition and
 * the exit is a transition after which the splash unmounts. base.css collapses all of them to
 * ~0 ms under reduced motion (system preference or Settings → REDUCED). Owner: design-system-hud.
 */
import { useCallback, useEffect, useRef, useState, type TransitionEvent } from 'react';
import { APP_NAME, APP_SUBTITLE } from '@/lib/config';
import { useLayerStatusStore, useMapInstanceStore } from '@/lib/layer-host';
import { useUiStore } from '@/lib/store';
import GodseyeMark from './GodseyeMark';
import { SPLASH_CAP_MS, SPLASH_EXIT_MS, SPLASH_STAGES, feedsReady, splashStage } from './splash-logic';

const WIDTHS = ['25%', '50%', '78%', '100%'] as const;

const RINGS = [
  { inset: 0, dur: 20, reverse: false, color: 'rgba(var(--gold-rgb),0.2)' },
  { inset: 18, dur: 12, reverse: true, color: 'rgba(var(--cyan-rgb),0.15)' },
  { inset: 40, dur: 7, reverse: false, color: 'rgba(var(--gold-rgb),0.25)' },
] as const;

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

  // Exit: the fade/scale transition plays, then the splash unmounts and the HUD is told it is done.
  const [gone, setGone] = useState(false);
  const finished = useRef(false);
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    setGone(true);
    setSplashDone();
  }, [setSplashDone]);
  useEffect(() => {
    if (visible) return;
    // transitionend never fires when the transition is skipped (e.g. zero duration): never wait longer.
    const t = setTimeout(finish, SPLASH_EXIT_MS + 150);
    return () => clearTimeout(t);
  }, [visible, finish]);
  const onTransitionEnd = (e: TransitionEvent<HTMLDivElement>) => {
    if (!visible && e.target === e.currentTarget && e.propertyName === 'opacity') finish();
  };

  if (gone) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${APP_NAME} loading: ${SPLASH_STAGES[stage]}`}
      data-exiting={visible ? undefined : ''}
      onTransitionEnd={onTransitionEnd}
      className="splash-screen pointer-events-none fixed inset-0 z-[var(--z-splash)] grid place-items-center bg-[radial-gradient(ellipse_at_center,var(--bg-secondary)_0%,var(--bg-void)_70%)]"
    >
      <div className="flex flex-col items-center">
        <div className="relative h-40 w-40">
          {RINGS.map((r, i) => (
            <div
              key={i}
              className="splash-ring absolute rounded-full border"
              data-reverse={r.reverse ? '' : undefined}
              style={{ inset: r.inset, borderColor: r.color, animationDuration: `${r.dur}s` }}
            >
              <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full" style={{ background: i === 1 ? 'var(--cyan-primary)' : 'var(--gold-primary)' }} />
            </div>
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
        <p className="hud-micro mt-3 tracking-[0.5em] text-[var(--gold-light)]">{APP_SUBTITLE}</p>
        <div className="mt-6 h-0.5 w-64 overflow-hidden bg-[rgba(var(--gold-rgb),0.1)]">
          <div
            className="splash-bar h-full bg-gradient-to-r from-[var(--gold-primary)] via-[var(--cyan-primary)] to-[var(--gold-primary)]"
            style={{ width: WIDTHS[stage] }}
          />
        </div>
        <p className={`hud-micro mt-3 tracking-[0.25em] ${stage === 3 ? 'text-[var(--cyan-primary)]' : 'text-[var(--text-secondary)]'}`}>{SPLASH_STAGES[stage]}</p>
      </div>
    </div>
  );
}
