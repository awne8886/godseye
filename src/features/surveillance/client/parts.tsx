'use client';
/**
 * Shared bits for surveillance cards and panels: definition rows, safe external links, the provider
 * provenance block (operator · licence · attribution · terms) and the report/remove link.
 * Upstream strings render as React text only. Owner: layers-surveillance.
 */
import { ExternalLink, Flag } from 'lucide-react';
import type { ReactNode } from 'react';
import { REPO_URL } from '@/lib/config';
import type { Camera, CameraProvider } from '@/lib/types';
import { removalUrl } from './rows';

export const safeHttp = (u: unknown): string | null => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);

export const isoShort = (s: string | null) => (s ? `${s.slice(0, 10)} ${s.slice(11, 19)}Z` : null);

export function Row({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]" data-testid={testId}>
      <dt className="shrink-0 font-mono text-[10px] uppercase tracking-[.16em] text-[var(--text-muted)]">{label}</dt>
      <dd className="min-w-0 text-right font-mono text-[11px] uppercase tracking-[.08em] tabular-nums text-[var(--text-primary)] [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export function OutLink({ href, children, testId }: { href: string | null; children: ReactNode; testId?: string }) {
  const safe = safeHttp(href);
  if (!safe) return null;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={testId}
      className="inline-flex min-h-[28px] items-center gap-1 font-mono text-[11px] uppercase tracking-[.08em] text-[var(--gold-primary)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--gold-primary)]"
    >
      {children}
      <ExternalLink size={12} aria-hidden />
    </a>
  );
}

/** Operator, licence, attribution and terms for the provider (shown in the card and viewer header). */
export function ProviderBlock({ provider }: { provider: CameraProvider | null | undefined }) {
  if (!provider) return <p className="font-sans text-[12px] text-[var(--text-secondary)]">Loading provider terms…</p>;
  return (
    <dl data-testid="camera-provider">
      <Row label="Operator" testId="camera-operator">{provider.operator}</Row>
      <Row label="Licence" testId="camera-licence">{provider.licence}</Row>
      <p className="py-1 font-sans text-[12px] normal-case text-[var(--text-secondary)]" data-testid="camera-attribution">
        {provider.attribution_string}
      </p>
      <div className="flex flex-wrap gap-x-3">
        <OutLink href={provider.terms_url}>Terms</OutLink>
      </div>
    </dl>
  );
}

export function ReportLink({ camera, provider }: { camera: Pick<Camera, 'id' | 'name' | 'providerId'>; provider: CameraProvider | null | undefined }) {
  return (
    <a
      href={removalUrl(REPO_URL, camera, provider?.operator ?? null, provider?.terms_url ?? null)}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="camera-report"
      className="inline-flex min-h-[28px] items-center gap-1 font-mono text-[11px] uppercase tracking-[.08em] text-[var(--alert-orange)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--gold-primary)]"
    >
      <Flag size={12} aria-hidden />
      Report / remove this camera
    </a>
  );
}
