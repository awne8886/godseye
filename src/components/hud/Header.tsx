import { APP_NAME, APP_STRAPLINE, APP_SUBTITLE } from '@/lib/config';
import GodseyeMark from './GodseyeMark';

/**
 * Top-left identity block (§1). The strapline uses the muted token rather than 40 % opacity, which
 * dropped it under 4.5:1. The text sits on a void-coloured scrim (`.hud-header-scrim`, base.css) so
 * basemap labels never print through the tagline (round 5 visual-qa m6). Phones follow the HUD's
 * `phone:` layout (round 5 M2). Owner: design-system-hud.
 */
export default function Header() {
  return (
    <header data-map-inset="header" className="hud-header-scrim pointer-events-none fixed left-16 top-4 z-[var(--z-hud)] flex items-center gap-3 phone:left-4">
      <GodseyeMark size={38} className="drop-shadow-[0_0_8px_var(--gold-glow)]" />
      <div className="hud-legible">
        <h1 className="font-mono text-xl font-bold tracking-[0.4em] text-[var(--gold-primary)] phone:text-[17px]">{APP_NAME}</h1>
        {/* Phones show the mark and the name only, in both orientations (a landscape phone has a
            390 px tall screen to share with the sheet, the view bar and the credits). */}
        <p className="hud-micro block text-[var(--text-secondary)] phone:hidden">{APP_SUBTITLE}</p>
        <p className="hud-micro mt-0.5 hidden text-[var(--text-muted)] lg:block phone:hidden">{APP_STRAPLINE}</p>
      </div>
    </header>
  );
}
