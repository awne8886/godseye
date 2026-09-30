'use client';
/**
 * Client fetch helpers and small shared UI utilities for the intel panels. Owner:
 * panels-alerts-markets-dossier-graph.
 */
import { useEffect, useState } from 'react';
import type { AiOverviewResponse, FeedMeta, NewsResponse, Providers } from '@/lib/types';

/** A 503 SOURCE OFFLINE (or other failure) with the feed's last-good metadata when present. */
export class FeedOfflineError extends Error {
  constructor(
    readonly status: number,
    readonly meta: FeedMeta | null,
    readonly providers: Providers | null,
  ) {
    super(`HTTP ${status}`);
    this.name = 'FeedOfflineError';
  }
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { meta?: FeedMeta; providers?: Providers } | null;
    throw new FeedOfflineError(res.status, body?.meta ?? null, body?.providers ?? null);
  }
  return (await res.json()) as T;
}

export const NEWS_QUERY_KEY = ['intel', 'news'] as const;
export const fetchNews = ({ signal }: { signal?: AbortSignal } = {}) => getJson<NewsResponse>('/api/news', signal);

export type AiProviderPref = 'auto' | 'claude' | 'gemini' | 'ollama' | 'analyst';

/** POST to an AI route. The optional visitor key goes in the `x-ai-key` header only (never stored here). */
export async function postAi(path: string, body: Record<string, unknown>, opts: { key?: string | null; signal?: AbortSignal } = {}): Promise<AiOverviewResponse> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(opts.key ? { 'x-ai-key': opts.key } : {}) },
    body: JSON.stringify(body),
    signal: opts.signal,
    cache: 'no-store',
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null;
    throw new Error(res.status === 429 ? 'Rate limited — AI requests are limited to 5 per minute.' : (b?.detail ?? b?.error ?? `HTTP ${res.status}`));
  }
  return (await res.json()) as AiOverviewResponse;
}

/** Re-render every `ms` (ages, session clocks). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Only http(s) links are rendered as anchors. */
export const safeHref = (u: string | null | undefined): string | null => (u && /^https?:\/\//i.test(u) ? u : null);

export const BLOC_SHORT: Record<string, string> = { western: 'WEST', russian: 'RU-ALIGNED', regional: 'REGIONAL', independent: 'INDEPENDENT' };
export const BLOC_TOKEN: Record<string, string> = { western: '--bloc-western', russian: '--bloc-russian', regional: '--bloc-regional', independent: '--bloc-independent' };
export const KIND_TOKEN: Record<string, string> = { rocket: '--map-alert-rocket', event: '--map-alert-event', news: '--map-alert-news' };

export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export const GENERATED_BY_LABEL: Record<AiOverviewResponse['generatedBy'], string> = {
  claude: 'Claude (Anthropic)',
  gemini: 'Gemini (Google)',
  ollama: 'Ollama (operator-hosted)',
  analyst: 'ANALYST — keyword heuristic, not AI',
};
