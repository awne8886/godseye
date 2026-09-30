'use client';
/**
 * ENTITY GRAPH: a canvas force graph over /api/entity/expand. Start from an identifier (Wikidata
 * QID, ISO country, IP, ASN, ICAO hex, MMSI/IMO) or from the selected map entity; click a node to
 * expand it. Every link lists its provenance below the canvas (the accessible alternative).
 * Person nodes only appear from Wikidata statements / OpenSanctions records — no name search.
 * Owner: panels-alerts-markets-dossier-graph.
 */
import { Network } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePanelChip } from '@/components/hud/PanelChrome';
import type { PanelProps } from '@/lib/feature-module';
import { useSelectionStore } from '@/lib/layer-host';
import type { EntityGraphResponse } from '@/lib/types';
import { FeedOfflineError, getJson, safeHref } from '../intel/client';
import { seedPosition, step, type LayoutNode } from './layout';

type Node = EntityGraphResponse['nodes'][number];
type Link = EntityGraphResponse['links'][number];
const EXPANDABLE = ['company', 'person', 'country', 'ip', 'asn', 'aircraft', 'vessel'] as const;
type Expandable = (typeof EXPANDABLE)[number];

const TYPE_TOKEN: Record<Node['type'], string> = {
  aircraft: '--map-aircraft-commercial',
  vessel: '--cyan-primary',
  company: '--gold-primary',
  person: '--bloc-russian',
  ip: '--bloc-regional',
  asn: '--bloc-western',
  country: '--text-heading',
  sanction: '--alert-red',
};

const color = (el: Element, token: string) => getComputedStyle(el).getPropertyValue(token).trim() || getComputedStyle(el).getPropertyValue('--text-primary').trim();

export function GraphPanel(_: PanelProps) {
  const selection = useSelectionStore((s) => s.selection);
  const [type, setType] = useState<Expandable>('company');
  const [id, setId] = useState('Q95');
  const [nodes, setNodes] = useState<Node[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<{ busy: boolean; error: string | null; providers: EntityGraphResponse['providers'] | null }>({ busy: false, error: null, providers: null });
  const canvas = useRef<HTMLCanvasElement>(null);
  const layout = useRef<LayoutNode[]>([]);
  usePanelChip(status.busy ? 'PLOTTING' : nodes.length ? `${nodes.length} NODES` : 'STANDBY', status.busy ? 'busy' : status.error ? 'error' : nodes.length ? 'live' : 'idle');

  const expand = useCallback(async (t: Expandable, raw: string, reset = false) => {
    setStatus((s) => ({ ...s, busy: true, error: null }));
    try {
      const g = await getJson<EntityGraphResponse>(`/api/entity/expand?type=${t}&id=${encodeURIComponent(raw)}`);
      setNodes((prev) => {
        const base = reset ? [] : prev;
        const seen = new Set(base.map((n) => n.id));
        return [...base, ...g.nodes.filter((n) => !seen.has(n.id))];
      });
      setLinks((prev) => {
        const base = reset ? [] : prev;
        const key = (l: Link) => `${l.source}|${l.target}|${l.relation}`;
        const seen = new Set(base.map(key));
        return [...base, ...g.links.filter((l) => !seen.has(key(l)))];
      });
      setExpanded((prev) => new Set([...(reset ? [] : prev), g.root]));
      setStatus({ busy: false, error: null, providers: g.providers });
    } catch (e) {
      setStatus({ busy: false, error: e instanceof FeedOfflineError ? (e.status === 400 ? 'Not a valid identifier for that type.' : 'SOURCE OFFLINE — no entity upstream answered.') : 'Request failed.', providers: e instanceof FeedOfflineError ? e.providers : null });
    }
  }, []);

  // Keep the layout array in step with the node list (new nodes seeded deterministically).
  useEffect(() => {
    const byId = new Map(layout.current.map((n) => [n.id, n]));
    layout.current = nodes.map((n, i) => byId.get(n.id) ?? { id: n.id, ...seedPosition(i), vx: 0, vy: 0 });
  }, [nodes]);

  // Simulate + draw.
  useEffect(() => {
    const c = canvas.current;
    if (!c || !nodes.length) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    let frame = 0;
    let raf = 0;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== w * dpr) c.width = w * dpr;
      if (c.height !== h * dpr) c.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, w / 2 * dpr, h / 2 * dpr);
      ctx.clearRect(-w / 2, -h / 2, w, h);
      const pos = new Map(layout.current.map((n) => [n.id, n]));
      ctx.strokeStyle = color(c, '--border-secondary');
      ctx.lineWidth = 1;
      for (const l of links) {
        const a = pos.get(l.source);
        const b = pos.get(l.target);
        if (!a || !b) continue;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.font = '10px JetBrains Mono, monospace';
      for (const n of nodes) {
        const p = pos.get(n.id);
        if (!p) continue;
        ctx.fillStyle = color(c, TYPE_TOKEN[n.type]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, expanded.has(n.id) ? 6 : 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = color(c, '--text-secondary');
        ctx.fillText(n.label.slice(0, 22), p.x + 7, p.y + 3);
      }
    };
    const tick = () => {
      const e = step(layout.current, links);
      draw();
      frame++;
      if (!reduced && e > 0.05 && frame < 400) raf = requestAnimationFrame(tick);
    };
    if (reduced) {
      for (let i = 0; i < 300; i++) if (step(layout.current, links) < 0.05) break;
      draw();
    } else raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [nodes, links, expanded]);

  const onCanvasClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const c = canvas.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const x = ev.clientX - r.left - r.width / 2;
    const y = ev.clientY - r.top - r.height / 2;
    const hit = layout.current.find((n) => (n.x - x) ** 2 + (n.y - y) ** 2 < 100);
    const node = hit && nodes.find((n) => n.id === hit.id);
    if (node && (EXPANDABLE as readonly string[]).includes(node.type) && !expanded.has(node.id)) void expand(node.type as Expandable, node.id);
  };

  const fromSelection = selection && (selection.kind === 'aircraft' || selection.kind === 'vessel') ? { type: selection.kind as Expandable, id: selection.id.replace(/^~/, '') } : null;

  return (
    <div className="flex flex-col gap-3" data-testid="graph-panel">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void expand(type, id.trim(), true);
        }}
      >
        <label className="flex flex-col gap-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
          Type
          <select value={type} onChange={(e) => setType(e.target.value as Expandable)} className="min-h-11 md:min-h-9 rounded-md border border-[var(--border-secondary)] bg-[var(--bg-void)] px-1 font-mono text-[11px] text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]">
            {EXPANDABLE.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
          Identifier
          <input value={id} onChange={(e) => setId(e.target.value)} spellCheck={false} placeholder="Q95 · UA · 8.8.8.8 · AS15169" className="min-h-11 md:min-h-9 rounded-md border border-[var(--border-secondary)] bg-[var(--bg-void)] px-2 font-mono text-[11px] text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]" />
        </label>
        <button type="submit" disabled={status.busy} className="inline-flex min-h-11 md:min-h-9 items-center gap-1 rounded-md border border-[var(--border-secondary)] px-2 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--gold-primary)] hover:bg-[var(--bg-tertiary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)] disabled:opacity-60">
          <Network aria-hidden className="h-3.5 w-3.5" /> Graph
        </button>
      </form>
      {fromSelection && (
        <button type="button" onClick={() => void expand(fromSelection.type, fromSelection.id, true)} className="self-start font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--cyan-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]">
          Graph selected {fromSelection.type} {fromSelection.id}
        </button>
      )}
      <canvas ref={canvas} onClick={onCanvasClick} className="h-64 w-full rounded-md border border-[var(--border-secondary)] bg-[var(--bg-void)]" role="img" aria-label={`Entity graph with ${nodes.length} nodes and ${links.length} links; the list below describes every link.`} />
      <p aria-live="polite" className="font-sans text-[12px] text-[var(--text-secondary)]">
        {status.busy ? 'Expanding…' : status.error ? status.error : nodes.length ? 'Click a node to expand it.' : 'Enter an identifier to start a graph.'}
      </p>
      {status.providers && (
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
          {Object.entries(status.providers)
            .map(([k, p]) => `${k}: ${p.ok ? `ok (${p.count})` : (p.skipped ?? p.error ?? 'failed')}`)
            .join(' · ')}
        </p>
      )}
      {links.length > 0 && (
        <ul className="flex flex-col gap-0.5 font-sans text-[12px] text-[var(--text-secondary)]" aria-label="Links with provenance">
          {links.slice(0, 80).map((l) => {
            const s = nodes.find((n) => n.id === l.source);
            const t = nodes.find((n) => n.id === l.target);
            const href = safeHref(t?.url);
            return (
              <li key={`${l.source}|${l.target}|${l.relation}`}>
                {s?.label ?? l.source} → <span className="text-[var(--text-primary)]">{l.relation}</span> →{' '}
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--cyan-primary)] hover:underline">
                    {t?.label ?? l.target}
                  </a>
                ) : (
                  (t?.label ?? l.target)
                )}{' '}
                <span className="font-mono text-[10px] text-[var(--text-muted)]">({l.provenance})</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
