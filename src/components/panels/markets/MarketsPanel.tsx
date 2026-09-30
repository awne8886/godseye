'use client';
/**
 * MARKETS panel: exchange sessions (12, computed from hours + time zone), breadth, quotes by group
 * with sparklines and their own observation time (Yahoo quotes flagged UNOFFICIAL), a lazy
 * candlestick chart, space weather (/api/space-weather), supply-chain risk (/api/scm-suppliers +
 * maritime chokepoints) and the chain brief (/api/chain/daily). Owner: panels-alerts-markets-dossier-graph.
 */
import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { usePanelChip } from '@/components/hud/PanelChrome';
import type { PanelProps } from '@/lib/feature-module';
import { formatAge } from '@/lib/freshness';
import type { ChainBriefResponse, MarketsResponse, Quote, ScmSuppliersResponse, SpaceWeatherResponse } from '@/lib/types';
import { AiReadout } from '../intel/AiReadout';
import { FeedOfflineError, fmtNum, fmtPct, getJson, useNow } from '../intel/client';
import { marketsChip } from './markets-chip';

const MarketChart = dynamic(() => import('./MarketChart'), { ssr: false, loading: () => <p className="font-sans text-[12px] text-[var(--text-muted)]">Loading chart…</p> });

const GROUPS: { id: Quote['group']; label: string }[] = [
  { id: 'indices', label: 'Indices' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'defense', label: 'Defense' },
  { id: 'energy', label: 'Energy' },
  { id: 'commodities', label: 'Commodities' },
  { id: 'fx', label: 'FX' },
];

function Spark({ v, up }: { v: number[]; up: boolean }) {
  if (v.length < 2) return <span className="inline-block h-4 w-14" aria-hidden />;
  const min = Math.min(...v);
  const max = Math.max(...v);
  const pts = v.map((y, i) => `${((i / (v.length - 1)) * 56).toFixed(1)},${(16 - ((y - min) / (max - min || 1)) * 14 - 1).toFixed(1)}`).join(' ');
  return (
    <svg viewBox="0 0 56 16" className="h-4 w-14" aria-hidden>
      <polyline points={pts} fill="none" stroke={up ? 'var(--up)' : 'var(--down)'} strokeWidth={1.2} />
    </svg>
  );
}

function Section({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="flex flex-col gap-1.5 border-t border-[var(--border-secondary)] pt-2">
      <h3 className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-heading)]">{title}</h3>
      {children}
      {note && <p className="font-sans text-[12px] text-[var(--text-muted)]">{note}</p>}
    </section>
  );
}

const offlineText = (e: unknown, what: string) =>
  e instanceof FeedOfflineError ? `SOURCE OFFLINE — ${what}${e.meta?.lastGoodAt ? `; last good ${e.meta.lastGoodAt.slice(11, 16)} UTC` : ''}.` : `SOURCE OFFLINE — ${what}.`;

export function MarketsPanel(_: PanelProps) {
  const now = useNow(30_000);
  const m = useQuery({ queryKey: ['intel', 'markets'], queryFn: ({ signal }) => getJson<MarketsResponse>('/api/markets', signal), refetchInterval: 60_000, staleTime: 30_000 });
  const sw = useQuery({ queryKey: ['space', 'weather-markets'], queryFn: ({ signal }) => getJson<SpaceWeatherResponse>('/api/space-weather', signal), refetchInterval: 300_000, staleTime: 120_000 });
  const scm = useQuery({ queryKey: ['intel', 'scm'], queryFn: ({ signal }) => getJson<ScmSuppliersResponse>('/api/scm-suppliers', signal), refetchInterval: 900_000, staleTime: 600_000 });
  const chain = useQuery({ queryKey: ['intel', 'chain', 30], queryFn: ({ signal }) => getJson<ChainBriefResponse>('/api/chain/daily?days=30', signal), staleTime: 1_800_000 });
  const [chart, setChart] = useState<{ symbol: string; name: string } | null>(null);
  const chip = m.data ? marketsChip(m.data) : null;
  usePanelChip(chip ? chip.text : m.isPending ? 'PLOTTING' : 'SOURCE OFFLINE', chip ? chip.tone : m.isPending ? 'busy' : 'error');

  const d = m.data;
  return (
    <div className="flex flex-col gap-3" data-testid="markets-panel">
      <AiReadout path="/api/ai/overview" body={{ scope: 'markets' }} label="Market read-out" />
      {!d && <p className="font-sans text-[12px] text-[var(--text-secondary)]">{m.isPending ? 'Acquiring quotes…' : offlineText(m.error, 'no quote provider answered')}</p>}
      {d && (
        <>
          <Section
            title="Exchange sessions"
            note={`Regular hours in each exchange's time zone. Holiday closures modelled for ${d.sessions.filter((s) => s.holidaysModelled).map((s) => s.exchange).join(', ') || 'none'}; * = holidays not modelled; half days never.`}
          >
            <ul className="grid grid-cols-2 gap-x-3 gap-y-1" aria-label="Exchange sessions">
              {d.sessions.map((s) => (
                <li key={s.exchange} title={`${s.name} (${s.tz})${s.nextChangeAt ? ` — ${s.open ? 'closes' : 'opens'} ${s.nextChangeAt.slice(0, 16).replace('T', ' ')} UTC` : ''}`} className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em]">
                  <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: s.open ? 'var(--alert-green)' : 'var(--text-muted)' }} />
                  <span className="min-w-0 truncate text-[var(--text-primary)]">
                    {s.exchange}
                    {s.holidaysModelled ? '' : '*'}
                  </span>
                  <span className={`ml-auto shrink-0 whitespace-nowrap ${s.open ? 'text-[var(--alert-green)]' : 'text-[var(--text-muted)]'}`}>{s.open ? 'Open' : 'Closed'}</span>
                </li>
              ))}
            </ul>
          </Section>
          <p className="font-mono text-[11px] uppercase tabular-nums tracking-[0.08em] text-[var(--text-secondary)]" aria-live="polite">
            Breadth <span className="text-[var(--up)]">{d.breadth.up} up</span> · <span className="text-[var(--down)]">{d.breadth.down} down</span> · {d.breadth.flat} flat
          </p>
          {GROUPS.map((g) => {
            const qs = d.quotes.filter((q) => q.group === g.id);
            if (!qs.length) return null;
            return (
              <Section key={g.id} title={g.label} note={g.id === 'crypto' ? undefined : 'Yahoo chart endpoint — unofficial, delayed per exchange rules.'}>
                <ul className="flex flex-col">
                  {qs.map((q) => {
                    const up = (q.changePct ?? 0) >= 0;
                    return (
                      <li key={q.symbol}>
                        <button
                          type="button"
                          onClick={() => setChart(q.group === 'crypto' ? { symbol: `${q.symbol}-USD`, name: q.name } : { symbol: q.symbol, name: q.name })}
                          className="grid min-h-11 md:min-h-8 w-full grid-cols-[1fr_auto_auto_auto] items-center gap-2 rounded-sm px-1 text-left hover:bg-[var(--bg-tertiary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]"
                          title={`${q.source}${q.unofficial ? ' (unofficial)' : ''} · observed ${q.observedAt ?? 'unknown'}`}
                        >
                          <span className="truncate font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-primary)]">{q.name}</span>
                          <Spark v={q.spark} up={up} />
                          <span className="font-mono text-[11px] tabular-nums text-[var(--text-primary)]">{fmtNum(q.price, q.price !== null && q.price < 10 ? 4 : 2)}</span>
                          <span className="w-16 text-right font-mono text-[11px] tabular-nums" style={{ color: q.changePct === null ? 'var(--text-secondary)' : up ? 'var(--up)' : 'var(--down)' }}>
                            {fmtPct(q.changePct)}
                          </span>
                        </button>
                        <span className="sr-only">Observed {q.observedAt ? `${formatAge(now - Date.parse(q.observedAt))} ago` : 'at an unknown time'}</span>
                      </li>
                    );
                  })}
                </ul>
              </Section>
            );
          })}
          {chart && <MarketChart key={chart.symbol} symbol={chart.symbol} name={chart.name} />}
        </>
      )}

      <Section title="Space weather" note="NOAA SWPC via /api/space-weather.">
        {sw.data ? (
          <dl className="grid grid-cols-3 gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums tracking-[0.08em]">
            {[
              ['Kp', sw.data.kp.kp === null ? '—' : String(sw.data.kp.kp)],
              ['Storm', sw.data.kp.stormLevel],
              ['X-ray', sw.data.xray.class ?? '—'],
              ['Wind', sw.data.solarWind.speedKmS === null ? '—' : `${Math.round(sw.data.solarWind.speedKmS)} km/s`],
              ['Bz', sw.data.solarWind.bzNt === null ? '—' : `${sw.data.solarWind.bzNt.toFixed(1)} nT`],
              ['R/S/G', `${sw.data.scales.R ?? '—'}/${sw.data.scales.S ?? '—'}/${sw.data.scales.G ?? '—'}`],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{k}</dt>
                <dd className="text-[var(--text-primary)]">{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="font-sans text-[12px] text-[var(--text-secondary)]">{sw.isPending ? 'Acquiring…' : offlineText(sw.error, 'NOAA SWPC did not answer')}</p>
        )}
      </Section>

      <Section title="Supply chain" note="Reference sites (city-level); threats are distance rules with the method shown.">
        {d?.scmAlerts.length ? (
          <ul className="flex flex-col gap-0.5">
            {d.scmAlerts.map((a) => (
              <li key={a.chokepoint} className="font-sans text-[12px] text-[var(--alert-orange)]">
                {a.chokepoint}: {a.risk} — {a.message}
              </li>
            ))}
          </ul>
        ) : null}
        {scm.data ? (
          <ul className="flex flex-col gap-0.5">
            {scm.data.items
              .filter((s) => s.riskLevel !== 'NORMAL')
              .map((s) => (
                <li key={s.id} className="font-sans text-[12px] text-[var(--text-primary)]">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: s.riskLevel === 'CRITICAL' ? 'var(--alert-red)' : 'var(--alert-orange)' }}>
                    {s.riskLevel}
                  </span>{' '}
                  {s.name}, {s.city} — {s.threats[0]?.label} ({s.threats[0]?.distanceKm} km; {s.threats[0]?.method})
                </li>
              ))}
            <li className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">
              {scm.data.items.filter((s) => s.riskLevel === 'NORMAL').length} of {scm.data.items.length} sites with no hazard in range
            </li>
          </ul>
        ) : (
          <p className="font-sans text-[12px] text-[var(--text-secondary)]">{scm.isPending ? 'Checking sites…' : offlineText(scm.error, 'hazard feeds unavailable, sites not checked')}</p>
        )}
      </Section>

      <Section title="Chain brief · 30 days" note="DefiLlama hacks, NVD CVEs; sanctioned wallets need an OpenSanctions key.">
        {chain.data ? (
          <div className="flex flex-col gap-1 font-sans text-[12px] text-[var(--text-primary)]">
            <p>
              {chain.data.exploits.length} exploits · ${fmtNum(chain.data.exploits.reduce((s, e) => s + (e.amountUsd ?? 0), 0) / 1e6, 1)}M · {chain.data.cves.length} CVEs · {chain.data.sanctionedWallets.length} sanctioned wallets
            </p>
            <ul className="flex flex-col gap-0.5 text-[var(--text-secondary)]">
              {chain.data.exploits.slice(0, 4).map((e) => (
                <li key={`${e.name}-${e.date}`}>
                  {e.date} · {e.name}
                  {e.chain ? ` (${e.chain})` : ''} · {e.amountUsd ? `$${fmtNum(e.amountUsd / 1e6, 1)}M` : 'amount unknown'}
                  {e.technique ? ` · ${e.technique}` : ''}
                </li>
              ))}
            </ul>
            {chain.data.degraded.length > 0 && <p className="text-[var(--text-muted)]">Degraded: {chain.data.degraded.join(', ')}</p>}
          </div>
        ) : (
          <p className="font-sans text-[12px] text-[var(--text-secondary)]">{chain.isPending ? 'Loading…' : offlineText(chain.error, 'DefiLlama and NVD did not answer')}</p>
        )}
      </Section>
    </div>
  );
}
