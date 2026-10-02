'use client';
/**
 * ARCGIS: search public Feature/Map Services on arcgis.com, or paste any public
 * …/rest/services/…/(Feature|Map)Server[/n] URL, and import the layer as GeoJSON (fetched by this
 * server through the SSRF guard, capped at 1000 features, truncation stated). Imported layers
 * are drawn by ReconOverlays; toggle, zoom to, export or remove them here. Owner: panels-recon.
 */
import { Database, Download, Eye, EyeOff, Import, Search, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { usePanelChip } from '@/components/hud/PanelChrome';
import type { PanelProps } from '@/lib/feature-module';
import { useUiStore } from '@/lib/store';
import type { ArcgisResponse } from '@/lib/types';
import { ErrorLine, HudButton, HudInput, Label, ProviderChips, Prose, SectionTitle, apiGet, downloadJson } from '../recon/ui';
import { MAX_ARCGIS_LAYERS, nextId, useOverlayStore, zoomForBbox } from '../recon/overlay-store';
import { featureBbox } from '../draw/geometry';

export default function ArcgisPanel(_: PanelProps) {
  const requestFlyTo = useUiStore((s) => s.requestFlyTo);
  const { arcgis, addArcgis, toggleArcgis, removeArcgis } = useOverlayStore();
  const [q, setQ] = useState('');
  const [url, setUrl] = useState('');
  const [search, setSearch] = useState<ArcgisResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<{ error?: string; detail?: string; providers?: ArcgisResponse['providers'] } | null>(null);
  const qId = useId();
  const urlId = useId();
  usePanelChip(busy ? 'LOADING' : search ? `${search.items.length} RESULTS` : arcgis.length ? `${arcgis.length} LAYERS` : 'STANDBY', busy ? 'busy' : search || arcgis.length ? 'live' : 'idle');

  const runSearch = async () => {
    if (q.trim().length < 2) return;
    setBusy('search');
    setErr(null);
    const r = await apiGet<ArcgisResponse>(`/api/arcgis?q=${encodeURIComponent(q.trim())}`).catch(() => null);
    setBusy(null);
    if (r?.ok) setSearch(r.body);
    else setErr(r?.body ?? { error: 'network_error' });
  };

  const importLayer = async (serviceUrl: string, title: string) => {
    setBusy(serviceUrl);
    setErr(null);
    const r = await apiGet<ArcgisResponse>(`/api/arcgis?url=${encodeURIComponent(serviceUrl)}`).catch(() => null);
    setBusy(null);
    if (!r?.ok || !r.body.features) {
      setErr(r?.body ?? { error: 'network_error' });
      return;
    }
    const fc = r.body.features;
    addArcgis({ id: nextId('arcgis'), title, source: r.body.source ?? serviceUrl, fc, truncated: r.body.truncated, visible: true, importedAt: r.body.timestamp });
    if (fc.features.length) {
      const bb = featureBbox(fc);
      requestFlyTo({ lat: (bb[1] + bb[3]) / 2, lng: (bb[0] + bb[2]) / 2, zoom: zoomForBbox(bb), durationMs: 1800 });
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="arcgis-panel">
      <form
        className="flex flex-col gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch();
        }}
      >
        <Label htmlFor={qId}>Search arcgis.com</Label>
        <div className="flex gap-1.5">
          <HudInput id={qId} value={q} onChange={(e) => setQ(e.target.value)} placeholder="earthquakes, wildfire, ports…" maxLength={120} />
          <HudButton type="submit" aria-label="Search ArcGIS" disabled={busy !== null}>
            <Search size={14} aria-hidden />
          </HudButton>
        </div>
      </form>
      <form
        className="flex flex-col gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) void importLayer(url.trim(), url.trim().replace(/^https?:\/\//, '').split('/rest/services/')[1] ?? url.trim());
        }}
      >
        <Label htmlFor={urlId}>Or paste a service URL</Label>
        <div className="flex gap-1.5">
          <HudInput id={urlId} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/rest/services/…/FeatureServer/0" maxLength={2048} />
          <HudButton type="submit" aria-label="Import layer" disabled={busy !== null}>
            <Import size={14} aria-hidden />
          </HudButton>
        </div>
        <Prose>A public Feature/Map Server layer on an ArcGIS host (ArcGIS Online hosted services, *.arcgisonline.com, or a host the operator allows). Fetched by this server, up to 1000 features.</Prose>
      </form>
      {err && <ErrorLine error={err.error} detail={err.detail} />}
      {err?.providers && <ProviderChips providers={err.providers} />}
      {arcgis.length > 0 && (
        <>
          <SectionTitle right={<span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{arcgis.length}/{MAX_ARCGIS_LAYERS}</span>}>Imported layers</SectionTitle>
          <ul className="flex flex-col gap-1.5" data-testid="arcgis-layers">
            {arcgis.map((l) => (
              <li key={l.id} className="rounded-md border border-[var(--border-secondary)] px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  <Database size={13} className="shrink-0 text-[var(--cyan-primary)]" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-sans text-[12px] text-[var(--text-primary)]" title={l.source}>
                    {l.title}
                  </span>
                  <HudButton tone="muted" aria-label={l.visible ? `Hide ${l.title}` : `Show ${l.title}`} pressed={l.visible} onClick={() => toggleArcgis(l.id)}>
                    {l.visible ? <Eye size={13} aria-hidden /> : <EyeOff size={13} aria-hidden />}
                  </HudButton>
                  <HudButton tone="muted" aria-label={`Export ${l.title}`} onClick={() => downloadJson('arcgis-layer.geojson', l.fc, 'application/geo+json')}>
                    <Download size={13} aria-hidden />
                  </HudButton>
                  <HudButton tone="muted" aria-label={`Remove ${l.title}`} onClick={() => removeArcgis(l.id)}>
                    <Trash2 size={13} aria-hidden />
                  </HudButton>
                </div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] tabular-nums text-[var(--text-secondary)]">
                  {l.fc.features.length} features{l.truncated ? ' · TRUNCATED (more on the server)' : ''} · imported {l.importedAt.slice(11, 16)}Z
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
      {search && (
        <>
          <SectionTitle>Results</SectionTitle>
          <ProviderChips providers={search.providers} at={search.timestamp} />
          <ul className="flex flex-col gap-1.5">
            {search.items.map((it) => (
              <li key={it.id} className="rounded-md border border-[var(--border-secondary)] px-2 py-1.5">
                <p className="font-sans text-[13px] text-[var(--text-primary)]">{it.title}</p>
                {it.snippet && <p className="line-clamp-2 font-sans text-[12px] text-[var(--text-secondary)]">{it.snippet}</p>}
                <div className="mt-1 flex items-center gap-2">
                  <span className="flex-1 truncate font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{it.owner ?? 'unknown owner'}</span>
                  {it.importable === false ? (
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]" title={`${hostOf(it.url)} is not on this server's ArcGIS host allow-list`}>
                      Host not allowed
                    </span>
                  ) : (
                    <HudButton tone="cyan" disabled={busy !== null} onClick={() => void importLayer(it.url, it.title)}>
                      <Import size={13} aria-hidden /> {busy === it.url ? 'Importing…' : 'Import'}
                    </HudButton>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {!search.items.length && <Prose>No public Feature or Map Services match.</Prose>}
        </>
      )}
    </div>
  );
}

function hostOf(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return 'This host';
  }
}
