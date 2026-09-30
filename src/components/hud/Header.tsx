import { APP_NAME, APP_STRAPLINE, APP_SUBTITLE } from '@/lib/config';
import GodseyeMark from './GodseyeMark';

/**
 * Top-left identity block (§1). The strapline uses the muted token rather than 40 % opacity, which
 * dropped it under 4.5:1. Owner: design-system-hud.
 */
export default function Header() {
  return (
    <header className="pointer-events-none fixed left-4 top-4 z-[var(--z-hud)] flex items-center gap-3 md:left-16">
      <GodseyeMark size={38} className="drop-shadow-[0_0_8px_var(--gold-glow)]" />
      <div>
        <h1 className="font-mono text-[17px] font-bold tracking-[0.4em] text-[var(--gold-primary)] md:text-xl">{APP_NAME}</h1>
        <p className="hud-micro hidden text-[var(--text-secondary)] sm:block">{APP_SUBTITLE}</p>
        <p className="hud-micro mt-0.5 hidden text-[var(--text-muted)] lg:block">{APP_STRAPLINE}</p>
      </div>
    </header>
  );
}
