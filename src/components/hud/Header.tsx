import { APP_NAME, APP_STRAPLINE, APP_SUBTITLE } from '@/lib/config';
import GodseyeMark from './GodseyeMark';

/** Top-left identity block (§1). Owner: design-system-hud. */
export default function Header() {
  return (
    <header className="pointer-events-none absolute left-6 top-4 z-[var(--z-hud)] flex items-center gap-3 md:left-16">
      <GodseyeMark size={38} className="drop-shadow-[0_0_8px_rgba(212,175,55,0.45)]" />
      <div>
        <h1 className="font-mono text-lg font-bold tracking-[0.4em] text-[var(--gold-primary)] md:text-xl">{APP_NAME}</h1>
        <p className="hud-micro text-[var(--text-secondary)]">{APP_SUBTITLE}</p>
        <p className="hud-micro mt-0.5 hidden text-[var(--text-primary)] opacity-40 lg:block">{APP_STRAPLINE}</p>
      </div>
    </header>
  );
}
