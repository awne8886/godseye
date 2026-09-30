'use client';
/** 28 px status bar with UTC + local clocks (design-system-hud adds the ticker and freshness LEDs). Owner: design-system-hud. */
import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function StatusBar() {
  const [clock, setClock] = useState({ utc: '--:--', local: '--:--' });
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setClock({ utc: d.toISOString().slice(11, 16), local: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) });
    };
    tick();
    const t = setInterval(tick, 10_000);
    return () => clearInterval(t);
  }, []);
  return (
    <footer className="hud-micro absolute inset-x-0 bottom-0 z-[var(--z-status)] flex h-7 items-center justify-between border-t border-white/5 bg-[rgba(10,10,15,0.95)] px-3 text-[var(--text-secondary)]">
      <nav className="flex gap-3" aria-label="Site">
        <Link href="/docs" className="text-[var(--gold-primary)]">DOCS</Link>
        <Link href="/privacy">PRIVACY</Link>
      </nav>
      <span>
        UTC {clock.utc} · LOCAL {clock.local}
      </span>
    </footer>
  );
}
