'use client';
/**
 * READ-OUT block shared by ALERTS / MARKETS / DOSSIER: asks an /api/ai/* route and always shows who
 * answered (model + provider, or the ANALYST heuristic with the reason no model answered). The
 * optional visitor key lives in this component's state only and is sent once per request in the
 * `x-ai-key` header — never persisted. Text is rendered as text. Owner:
 * panels-alerts-markets-dossier-graph.
 */
import { useMutation } from '@tanstack/react-query';
import { KeyRound, Sparkles } from 'lucide-react';
import { useId, useState } from 'react';
import { useUiStore } from '@/lib/store';
import type { AiOverviewResponse } from '@/lib/types';
import { GENERATED_BY_LABEL, postAi } from './client';

interface Props {
  path: '/api/ai/overview' | '/api/ai/analyze' | '/api/ai/briefing';
  body: Record<string, unknown>;
  label?: string;
  onThread?: (itemIds: string[] | null) => void;
}

export function AiReadout({ path, body, label = 'Read-out', onThread }: Props) {
  const provider = useUiStore((s) => s.settings.aiProvider);
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const keyId = useId();
  const m = useMutation<AiOverviewResponse, Error>({ mutationFn: () => postAi(path, { ...body, provider }, { key: key.trim() || null }) });
  const r = m.data;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-[var(--border-secondary)] p-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => m.mutate()}
          disabled={m.isPending}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-[var(--border-secondary)] px-2 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--gold-primary)] hover:bg-[var(--bg-tertiary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)] disabled:opacity-60"
        >
          <Sparkles aria-hidden className="h-3.5 w-3.5" />
          {m.isPending ? 'Generating…' : r ? `Regenerate ${label}` : label}
        </button>
        <button
          type="button"
          aria-expanded={showKey}
          aria-controls={keyId}
          onClick={() => setShowKey((v) => !v)}
          className="ml-auto inline-flex min-h-9 items-center gap-1 rounded-md px-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]"
        >
          <KeyRound aria-hidden className="h-3 w-3" /> Own key
        </button>
      </div>
      {showKey && (
        <label id={keyId} className="flex flex-col gap-1 font-sans text-[12px] text-[var(--text-secondary)]">
          Your Anthropic or Gemini key — sent once per request in a header, never stored or logged.
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="min-h-9 rounded-md border border-[var(--border-secondary)] bg-[var(--bg-void)] px-2 font-mono text-[12px] text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]"
          />
        </label>
      )}
      {m.error && (
        <p role="alert" className="font-sans text-[12px] text-[var(--alert-red)]">
          {m.error.message}
        </p>
      )}
      {r && (
        <div className="flex flex-col gap-1.5" data-testid="ai-readout">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">
            <span className={r.generatedBy === 'analyst' ? 'text-[var(--alert-orange)]' : 'text-[var(--cyan-primary)]'}>{GENERATED_BY_LABEL[r.generatedBy]}</span>
            {r.model ? ` · ${r.model}` : ''}
            {r.keySource === 'user' ? ' · your key' : r.keySource === 'server' ? ' · server key' : ''}
          </p>
          {r.fallbackReason && <p className="font-sans text-[12px] text-[var(--text-muted)]">Why the analyst answered: {r.fallbackReason}.</p>}
          <p className="whitespace-pre-line font-sans text-[13px] leading-snug text-[var(--text-primary)]">{r.text}</p>
          {r.brief && r.brief.threads.length > 0 && onThread && (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter alerts by thread">
              {r.brief.threads.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onThread(t.itemIds)}
                  className="rounded-sm border border-[var(--border-secondary)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]"
                >
                  {t.label} · {t.count} · {t.perspective}
                </button>
              ))}
              <button type="button" onClick={() => onThread(null)} className="rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                All
              </button>
            </div>
          )}
          {r.citations.length > 0 && (
            <details className="font-sans text-[12px] text-[var(--text-secondary)]">
              <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.16em]">{r.citations.length} cited rows</summary>
              <ul className="mt-1 flex flex-col gap-0.5">
                {r.citations.map((c) => (
                  <li key={`${c.feed}:${c.id}`}>
                    [{c.feed}] {c.label}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Generated {r.timestamp.slice(11, 16)} UTC</p>
        </div>
      )}
    </div>
  );
}
