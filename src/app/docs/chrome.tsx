/**
 * Shared chrome for the static document pages (/docs, /privacy): skip link, site header,
 * footer and a fixed, full-viewport scroll container (the map shell locks `html, body` to the
 * viewport; `position: fixed` avoids depending on `dvh` support).
 * Server components only. Internal links use next/link with prefetch off, so these light pages
 * never download the map route in the background.
 * Owner: pages-docs-privacy-ops.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { APP_NAME, APP_SUBTITLE, APP_VERSION, REPO_URL } from '@/lib/config';

export type PageKey = 'docs' | 'privacy';

const NAV: { key: PageKey | 'map' | 'cameras' | 'source'; href: string; label: string }[] = [
  { key: 'map', href: '/', label: 'Globe' },
  { key: 'docs', href: '/docs', label: 'API reference' },
  { key: 'privacy', href: '/privacy', label: 'Privacy' },
  { key: 'cameras', href: '/cameras-notice', label: 'Camera notice' },
  { key: 'source', href: REPO_URL, label: 'Source code' },
];

export function PageShell({ current, children }: { current: PageKey; children: ReactNode }) {
  return (
    <div data-scroll-root className="fixed inset-0 overflow-y-auto bg-primary-bg text-fg [scroll-padding-top:1rem]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-secondary-bg focus:px-4 focus:py-3 focus:text-[13px] focus:text-gold-light"
      >
        Skip to content
      </a>
      <header className="border-b border-[var(--border-primary)] bg-void">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-8 gap-y-3 px-5 py-4">
          <Link href="/" prefetch={false} className="group flex flex-col rounded-sm leading-none">
            <span className="font-display text-[17px] font-bold tracking-[0.3em] text-gold">{APP_NAME}</span>
            <span className="hud-micro mt-1.5 text-fg-secondary">{APP_SUBTITLE}</span>
          </Link>
          <nav aria-label="Site">
            <ul className="flex flex-wrap gap-x-1 gap-y-1">
              {NAV.map((n) => {
                const cls = 'hud-text inline-flex min-h-11 items-center rounded-md px-3 text-[11px] text-fg-secondary hover:text-gold-light aria-[current=page]:text-gold';
                return (
                  <li key={n.key}>
                    {n.href.startsWith('/') ? (
                      <Link href={n.href} prefetch={false} aria-current={n.key === current ? 'page' : undefined} className={cls}>
                        {n.label}
                      </Link>
                    ) : (
                      <a href={n.href} rel="noopener noreferrer" className={cls}>
                        {n.label}
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      </header>
      {children}
      <footer className="border-t border-[var(--border-primary)] bg-void">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-6 text-[12px] text-fg-secondary">
          <p>
            {APP_NAME} v{APP_VERSION} · MIT licence · open source at{' '}
            <a className="text-fg underline decoration-[var(--gold-dim)] underline-offset-4 hover:text-gold-light" href={REPO_URL} rel="noopener noreferrer">
              {REPO_URL.replace('https://', '')}
            </a>
          </p>
          <p className="hud-micro text-fg-muted">No cookies · no analytics · no accounts</p>
        </div>
      </footer>
    </div>
  );
}

/** Section heading in the HUD voice with a gold accent bar. */
export function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="flex items-center gap-3 font-display text-[17px] font-bold tracking-[0.04em] text-fg-heading">
      <span aria-hidden="true" className="inline-block h-4 w-1 rounded-full bg-gold" />
      {children}
    </h2>
  );
}

/** Inline link inside prose: underlined so it never relies on colour alone. */
export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  const className = 'text-gold-light underline decoration-[var(--gold-dim)] underline-offset-4 hover:decoration-[var(--gold-light)]';
  if (href.startsWith('/')) {
    return (
      <Link href={href} prefetch={false} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}
