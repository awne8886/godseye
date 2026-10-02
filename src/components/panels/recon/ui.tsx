'use client';
/**
 * Small UI primitives shared by the RECON / SEARCH / ROUTE / DRAW / ARCGIS / REMOTE panels:
 * HUD buttons and inputs (44 px touch targets on phones), provider status chips (who answered,
 * how long ago, who failed or was skipped), findings, key/value data, and file download.
 * Upstream strings are always rendered as text. Owner: panels-recon.
 */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import type { Providers } from '@/lib/types';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--gold-primary)]';

export function HudButton({ tone = 'gold', pressed, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'gold' | 'cyan' | 'muted' | 'red'; pressed?: boolean }) {
  const color = tone === 'cyan' ? 'var(--cyan-primary)' : tone === 'red' ? 'var(--alert-red)' : tone === 'muted' ? 'var(--text-secondary)' : 'var(--gold-primary)';
  return (
    <button
      type="button"
      aria-pressed={pressed}
      {...rest}
      style={{ color, borderColor: pressed ? color : undefined, ...rest.style }}
      className={cx(
        'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md [&>svg]:shrink-0 border border-[var(--border-secondary)] px-2.5 font-mono text-[11px] uppercase tracking-[0.08em] tabular-nums hover:bg-[var(--bg-tertiary)] disabled:cursor-not-allowed disabled:opacity-50 phone:min-h-11',
        pressed && 'bg-[var(--bg-tertiary)]',
        FOCUS,
        className,
      )}
    />
  );
}

export function HudInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={cx(
        'min-h-9 w-full rounded-md border border-[var(--border-secondary)] bg-[var(--bg-void)] px-2.5 font-mono text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] phone:min-h-11',
        FOCUS,
        className,
      )}
    />
  );
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
      {children}
    </label>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mt-1 flex items-center gap-2">
      <h3 className="flex-1 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-heading)]">{children}</h3>
      {right}
    </div>
  );
}

export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('font-sans text-[12px] leading-snug text-[var(--text-secondary)]', className)}>{children}</p>;
}

const ago = (s: number | null) => (s === null ? '' : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`);

/** One chip per provider: OK (count · ms · age) / ERR reason / SKIPPED reason. Never hidden. */
export function ProviderChips({ providers, at }: { providers: Providers | undefined; at?: string | null }) {
  if (!providers) return null;
  return (
    <ul aria-label="Providers" className="flex flex-wrap items-center gap-1">
      {Object.entries(providers).map(([name, p]) => {
        const state = p.ok ? 'ok' : p.skipped ? 'skipped' : 'error';
        const color = state === 'ok' ? 'var(--alert-green)' : state === 'skipped' ? 'var(--text-muted)' : 'var(--alert-red)';
        const detail = state === 'ok' ? `${p.count} · ${p.ms} ms${p.age_s ? ` · ${ago(p.age_s)}` : ''}` : state === 'skipped' ? `skipped: ${p.skipped}` : (p.error ?? 'error');
        return (
          <li
            key={name}
            data-provider={name}
            data-state={state}
            className="rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] tabular-nums"
            style={{ color, borderColor: color }}
            title={`${name}: ${detail}`}
          >
            {name} <span className="text-[var(--text-secondary)]">{detail}</span>
          </li>
        );
      })}
      {at && (
        <li className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)] tabular-nums">
          <time dateTime={at}>{at.replace('T', ' ').slice(0, 19)}Z</time>
        </li>
      )}
    </ul>
  );
}

export type FindingLevel = 'info' | 'low' | 'medium' | 'high' | 'critical';
const LEVEL_COLOR: Record<FindingLevel, string> = {
  info: 'var(--text-secondary)',
  low: 'var(--cyan-primary)',
  medium: 'var(--alert-orange)',
  high: 'var(--alert-red)',
  critical: 'var(--alert-red)',
};

export function Findings({ items }: { items: { level: FindingLevel; label: string; detail: string }[] }) {
  if (!items.length) return null;
  return (
    <ul className="flex flex-col gap-1">
      {items.map((f, i) => (
        <li key={i} className="border-l-2 pl-2" style={{ borderColor: LEVEL_COLOR[f.level] }}>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: LEVEL_COLOR[f.level] }}>
            {f.level}
          </span>{' '}
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-primary)]">{f.label}</span>
          <p className="font-sans text-[12px] text-[var(--text-secondary)]">{f.detail}</p>
        </li>
      ))}
    </ul>
  );
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) {
    if (!v.length) return '—';
    if (v.every((x) => typeof x !== 'object' || x === null)) return v.slice(0, 40).join(', ') + (v.length > 40 ? ` … (+${v.length - 40})` : '');
    return `${v.length} item${v.length === 1 ? '' : 's'}`;
  }
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${typeof x === 'object' && x !== null ? '…' : String(x)}`).join(' · ');
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('en-US') : String(Number(v.toFixed(6)));
  return String(v);
}

/** Flat key/value rendering of a tool's data (text only). */
export function KeyValues({ data, skip = [] }: { data: Record<string, unknown>; skip?: string[] }) {
  const rows = Object.entries(data).filter(([k]) => !skip.includes(k));
  return (
    <dl className="grid grid-cols-[minmax(84px,auto)_1fr] gap-x-3 gap-y-0.5">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{k}</dt>
          <dd className="break-words font-mono text-[11px] tabular-nums text-[var(--text-primary)]">{renderValue(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Save JSON/GeoJSON as a file (Blob URL, revoked right after). */
export function downloadJson(filename: string, data: unknown, type = 'application/json') {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Fetch JSON from our own API; non-2xx bodies (error + providers) are returned, not thrown. */
export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<{ ok: boolean; status: number; body: T & { error?: string; detail?: string; providers?: Providers } }> {
  const r = await fetch(path, { signal, headers: { accept: 'application/json' } });
  let body: T & { error?: string; detail?: string; providers?: Providers };
  try {
    body = (await r.json()) as typeof body;
  } catch {
    body = { error: 'bad_response', detail: `HTTP ${r.status}` } as typeof body;
  }
  return { ok: r.ok, status: r.status, body };
}

export function ErrorLine({ error, detail }: { error?: string; detail?: string }) {
  if (!error) return null;
  const offline = error === 'source_offline';
  return (
    <p role="status" className="font-mono text-[11px] uppercase tracking-[0.08em]" style={{ color: offline ? 'var(--alert-orange)' : 'var(--alert-red)' }}>
      {offline ? 'SOURCE OFFLINE' : error.replace(/_/g, ' ')}
      {detail && <span className="block font-sans text-[12px] normal-case tracking-normal text-[var(--text-secondary)]">{detail}</span>}
    </p>
  );
}
