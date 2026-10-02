'use client';
/**
 * 28 px status bar: ONLINE (navigator.onLine), per-layer freshness LEDs for active layers, a ticker
 * of observed events (/api/ticker when available, else the Intel Feed events already on the client;
 * each item carries its own observation time), SHARE / SHORTCUTS / SOURCES & LICENCES launchers,
 * DOCS / PRIVACY links and UTC + local clocks. Owner: design-system-hud.
 */
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { FRESHNESS_COLOR_TOKEN, formatAge } from '@/lib/freshness';
import type { LayerId } from '@/lib/layer-registry';
import { useFeedEventStore, useLayerStatusStore } from '@/lib/layer-host';
import { useUiStore } from '@/lib/store';
import type { TickerResponse } from '@/lib/types';
import { useApiRoute, useVisibleLayers } from './hooks';
import { eventTickerAt, zoomGateLabel } from './status-logic';

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

function useClock() {
  const [clock, setClock] = useState({ utc: '--:--', local: '--:--', now: 0 });
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setClock({ utc: d.toISOString().slice(11, 16), local: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), now: d.getTime() });
    };
    tick();
    const t = setInterval(tick, 10_000);
    return () => clearInterval(t);
  }, []);
  return clock;
}

interface TickerItem {
  key: string;
  text: string;
  at: string | null;
  tone: string;
}

function useTickerItems(): TickerItem[] {
  const tickerRoute = useApiRoute('/api/ticker');
  const ticker = useQuery({
    enabled: tickerRoute,
    queryKey: ['ticker'],
    queryFn: async ({ signal }) => {
      const r = await fetch('/api/ticker', { signal });
      if (!r.ok) throw new Error(`ticker HTTP ${r.status}`);
      return (await r.json()) as TickerResponse;
    },
    refetchInterval: 60_000,
    retry: false,
  });
  const events = useFeedEventStore((s) => s.events);
  return useMemo(() => {
    const items: TickerItem[] = [];
    if (ticker.data) {
      for (const q of ticker.data.crypto)
        items.push({
          key: `c-${q.symbol}`,
          text: `${q.symbol} ${q.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}${q.changePct === null ? '' : ` ${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}%`}`,
          at: q.observedAt,
          tone: q.changePct === null ? 'var(--text-secondary)' : q.changePct >= 0 ? 'var(--up)' : 'var(--down)',
        });
      for (const q of ticker.data.quakes) items.push({ key: `q-${q.id}`, text: `M${q.magnitude.toFixed(1)} ${q.place ?? ''}`.trim(), at: q.observedAt, tone: 'var(--map-seismic)' });
    }
    if (items.length < 4)
      for (const e of events.slice(0, 12)) items.push({ key: `e-${e.layer}-${e.id}`, text: e.title, at: eventTickerAt(e), tone: 'var(--text-primary)' });
    return items;
  }, [ticker.data, events]);
}

export default function StatusBar() {
  const clock = useClock();
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const active = useUiStore((s) => s.activeLayers);
  const setOpenPanel = useUiStore((s) => s.setOpenPanel);
  const status = useLayerStatusStore((s) => s.status);
  const visible = useVisibleLayers();
  const leds = visible.filter((l) => active.has(l.id as LayerId) && l.route && !l.parent);
  const items = useTickerItems();

  return (
    <footer data-map-inset="status-bar" className="hud-micro fixed inset-x-0 bottom-0 z-[var(--z-status)] flex h-7 items-center gap-3 border-t border-[var(--border-secondary)] bg-[var(--glass-3)] px-3 text-[var(--text-secondary)] phone:hidden">
      <span className="flex items-center gap-1.5" style={{ color: online ? 'var(--alert-green)' : 'var(--alert-red)' }} role="status">
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />
        {online ? 'ONLINE' : 'OFFLINE'}
      </span>
      <ul className="flex items-center gap-1" aria-label="Feed freshness">
        {leds.map((l) => {
          const st = status[l.id as LayerId];
          const state = !st || st.state === 'idle' || st.state === 'loading' ? null : l.kind === 'reference' && st.state !== 'offline' ? 'reference' : st.state;
          const color = state ? `var(${FRESHNESS_COLOR_TOKEN[state]})` : 'var(--text-muted)';
          const label = `${l.label}: ${state ? state.toUpperCase() : (zoomGateLabel(st) ?? 'ACQUIRING')}`;
          return (
            <li key={l.id} title={label} aria-label={label} className="grid h-4 w-3 place-items-center">
              <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color, opacity: state ? 1 : 0.5 }} />
            </li>
          );
        })}
      </ul>
      <div className="hud-ticker relative min-w-0 flex-1 overflow-hidden" aria-label="Latest observed events" role="marquee">
        {items.length > 0 ? (
          <div className="hud-ticker-track flex w-max gap-8 whitespace-nowrap" data-ticker>
            {[0, 1].map((copy) => (
              <span key={copy} className="flex gap-8" aria-hidden={copy === 1}>
                {items.map((it) => (
                  <span key={it.key}>
                    <span style={{ color: it.tone }}>{it.text}</span>
                    {it.at && clock.now > 0 && <span className="ml-1 text-[var(--text-muted)]">{formatAge(clock.now - Date.parse(it.at))}</span>}
                  </span>
                ))}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-[var(--text-muted)]">NO EVENTS RECEIVED YET</span>
        )}
      </div>
      <nav className="flex items-center gap-3" aria-label="Site">
        <button type="button" className="hud-micro min-h-[24px] hover:text-[var(--gold-light)]" onClick={() => setOpenPanel('share')}>
          SHARE
        </button>
        <button type="button" className="hud-micro min-h-[24px] hover:text-[var(--gold-light)]" onClick={() => setOpenPanel('help')}>
          SHORTCUTS
        </button>
        <button type="button" className="hud-micro min-h-[24px] hover:text-[var(--gold-light)]" onClick={() => setOpenPanel('attribution')}>
          SOURCES &amp; LICENCES
        </button>
        <Link href="/docs" prefetch={false} className="min-h-[24px] leading-[24px] text-[var(--gold-primary)]">
          DOCS
        </Link>
        <Link href="/privacy" prefetch={false} className="min-h-[24px] leading-[24px]">
          PRIVACY
        </Link>
      </nav>
      <span className="whitespace-nowrap">
        UTC {clock.utc} · LOCAL {clock.local}
      </span>
    </footer>
  );
}
