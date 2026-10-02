'use client';
/**
 * Candlestick chart for one symbol (lightweight-charts, loaded lazily with the panel's chart
 * section). Colours are read from the theme tokens at mount. Owner: panels-alerts-markets-dossier-graph.
 */
import { useQuery } from '@tanstack/react-query';
import { CandlestickSeries, createChart, type IChartApi, type UTCTimestamp } from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import { hudFontFamily } from '@/lib/tokens';
import type { MarketHistoryResponse, MarketRange } from '@/lib/types';
import { FeedOfflineError, getJson } from '../intel/client';

const RANGES: MarketRange[] = ['24H', '1W', '1M', '6M', '1Y'];

const cssVar = (name: string, el: Element) => getComputedStyle(el).getPropertyValue(name).trim() || undefined;

export default function MarketChart({ symbol, name }: { symbol: string; name: string }) {
  const [range, setRange] = useState<MarketRange>('1M');
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const q = useQuery({
    queryKey: ['intel', 'history', symbol, range],
    queryFn: ({ signal }) => getJson<MarketHistoryResponse>(`/api/markets/history?symbol=${encodeURIComponent(symbol)}&range=${range}`, signal),
    staleTime: 60_000,
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || !q.data?.candles.length) return;
    const chart = createChart(el, {
      height: 180,
      layout: { background: { color: 'transparent' }, textColor: cssVar('--text-secondary', el), fontFamily: hudFontFamily(el), fontSize: 10 },
      grid: { vertLines: { color: cssVar('--border-secondary', el) }, horzLines: { color: cssVar('--border-secondary', el) } },
      timeScale: { timeVisible: range === '24H' || range === '1W', borderColor: cssVar('--border-secondary', el) },
      rightPriceScale: { borderColor: cssVar('--border-secondary', el) },
      autoSize: true,
    });
    const up = cssVar('--up', el);
    const down = cssVar('--down', el);
    const series = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false });
    series.setData(q.data.candles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));
    chart.timeScale().fitContent();
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [q.data, range]);

  const offline = q.error instanceof FeedOfflineError;
  return (
    <figure className="flex flex-col gap-1" data-testid="market-chart">
      <div className="flex items-center gap-1">
        <figcaption className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-heading)]">
          {name} <span className="text-[var(--text-muted)]">{symbol}</span>
        </figcaption>
        <div role="group" aria-label="Chart range" className="ml-auto flex gap-0.5">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={range === r}
              onClick={() => setRange(r)}
              className="min-h-6 phone:min-h-11 rounded-sm px-1 font-mono text-[10px] uppercase tracking-[0.16em] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]"
              style={{ color: range === r ? 'var(--gold-primary)' : 'var(--text-secondary)' }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <div ref={ref} className="h-[180px] w-full" role="img" aria-label={`${name} candlestick chart, range ${range}`} />
      <p className="font-sans text-[12px] text-[var(--text-muted)]">
        {q.isPending ? 'Loading candles…' : offline ? 'SOURCE OFFLINE — Yahoo chart did not answer.' : q.data ? `${q.data.candles.length} candles · ${q.data.interval} · Yahoo chart (unofficial, delayed)` : ''}
      </p>
    </figure>
  );
}
