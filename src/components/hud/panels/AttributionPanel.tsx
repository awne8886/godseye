'use client';
/**
 * SOURCES & LICENCES. Three sections:
 *  1. ON SCREEN NOW: the basemap/imagery attribution for the current view.
 *  2. MAP LAYERS: every deployable layer with its kind (REALTIME / REFERENCE; "LIVE" is never shown
 *     for a feed that has not been observed), its freshness once the feed has answered, the
 *     registry sources behind it, and the attribution its feed reported (appended once it answers).
 *  3. ALL SOURCES: the full static registry (src/lib/sources.ts), whatever layers are on:
 *     name, use, licence, terms link and the key/flag that gates it.
 * Owner: design-system-hud.
 */
import type { ReactNode } from 'react';
import { REPO_URL } from '@/lib/config';
import type { PanelProps } from '@/lib/feature-module';
import { LAYER_GROUPS, type LayerDef, type LayerId } from '@/lib/layer-registry';
import { useLayerStatusStore } from '@/lib/layer-host';
import { SOURCES, sourcesByGroup, sourcesForLayer, type SourceEntry } from '@/lib/sources';
import { useUiStore } from '@/lib/store';
import { useVisibleLayers } from '../hooks';
import { AttributionLine, FreshnessLed, statusAttribution } from '../LayerRows';
import { usePanelChip } from '../PanelChrome';
import { refreshLabel } from '../status-logic';

const BASE = [
  { text: 'OpenFreeMap', url: 'https://openfreemap.org', licence: 'Tiles' },
  { text: '© OpenMapTiles', url: 'https://www.openmaptiles.org/', licence: 'BSD-3 / CC-BY' },
  { text: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright', licence: 'ODbL' },
];
const SAT = { text: 'Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community', url: 'https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9', licence: 'Esri terms of use' };

const MODE_LABEL: Record<SourceEntry['mode'], string> = { live: 'REALTIME', reference: 'REFERENCE', tiles: 'TILES', 'on-demand': 'ON REQUEST' };

/** Kind chip text: "REALTIME" describes the feed type, never an observed-live claim. */
export function layerKindLabel(kind: LayerDef['kind']): string {
  return kind === 'reference' ? 'REFERENCE' : kind === 'mixed' ? 'REALTIME + REFERENCE' : 'REALTIME';
}

/** Refresh label; layers without a route draw browser tiles or compute locally. */
export function layerCadenceLabel(l: LayerDef): string {
  if (!l.route && sourcesForLayer(l.id).some((s) => s.mode === 'tiles')) return 'TILES';
  return refreshLabel(l.refreshMs, l.transport);
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return /^https?:\/\//.test(href) ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline decoration-[var(--border-active)] underline-offset-2 hover:text-[var(--gold-light)]">
      {children}
    </a>
  ) : (
    <span>{children}</span>
  );
}

function LayerItem({ l }: { l: LayerDef }) {
  const st = useLayerStatusStore((s) => s.status[l.id as LayerId]);
  const attr = st ? statusAttribution(st) : [];
  const registry = sourcesForLayer(l.id);
  return (
    <li>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="hud-text text-[11px] text-[var(--text-primary)]">{l.label}</span>
        <span className="instrument-chip text-[var(--text-secondary)]">{layerKindLabel(l.kind)}</span>
        <span className="hud-micro text-[var(--text-muted)]">{layerCadenceLabel(l)}</span>
        {st && <FreshnessLed layer={l} status={st} />}
      </div>
      {l.description && <p className="font-sans text-[var(--text-secondary)]">{l.description}</p>}
      {registry.length > 0 && (
        <p className="font-sans text-[var(--text-secondary)]">
          <span className="hud-micro text-[var(--text-muted)]">SOURCES </span>
          {registry.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ' · '}
              <Ext href={s.url}>{s.name}</Ext> <span className="text-[var(--text-muted)]">({s.licence.split(';')[0]})</span>
            </span>
          ))}
        </p>
      )}
      {attr.map((a) => (
        <p key={a.text} className="text-[var(--text-primary)]" data-testid={`sources-${l.id}`}>
          <AttributionLine a={a} />
        </p>
      ))}
    </li>
  );
}

export default function AttributionPanel(_: PanelProps) {
  const layers = useVisibleLayers();
  const basemap = useUiStore((s) => s.basemap);
  usePanelChip(`${layers.length} LAYERS · ${SOURCES.length} SOURCES`, 'idle');
  return (
    <div className="space-y-5 text-[12px]">
      <p className="hud-micro text-[var(--text-secondary)] tabular-nums">
        {layers.length} MAP LAYERS · {SOURCES.length} SOURCES IN THE REGISTER
      </p>
      <section aria-label="On screen now">
        <h3 className="hud-micro mb-1 text-[var(--text-secondary)]">ON SCREEN NOW · BASEMAP</h3>
        <ul className="space-y-0.5 text-[var(--text-primary)]">
          {[...BASE, ...(basemap === 'satellite' ? [SAT] : [])].map((a) => (
            <li key={a.text}>
              <Ext href={a.url}>{a.text}</Ext> <span className="text-[var(--text-muted)]">· {a.licence}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Map layers" className="space-y-3">
        <h3 className="hud-title text-[var(--gold-primary)]">MAP LAYERS</h3>
        {LAYER_GROUPS.map((g) => {
          const inGroup = layers.filter((l) => l.group === g.id);
          if (!inGroup.length) return null;
          return (
            <section key={g.id} aria-label={g.label}>
              <h4 className="hud-micro mb-1 text-[var(--text-secondary)]">{g.label}</h4>
              <ul className="space-y-2">
                {inGroup.map((l) => (
                  <LayerItem key={l.id} l={l} />
                ))}
              </ul>
            </section>
          );
        })}
      </section>

      <section aria-label="All sources" className="space-y-3">
        <h3 className="hud-title text-[var(--gold-primary)]">ALL SOURCES &amp; LICENCES</h3>
        <p className="font-sans text-[var(--text-secondary)]">
          Every upstream this instance can use, whether or not its layer is on. Sources with a key or flag stay off until the operator enables them.
        </p>
        {sourcesByGroup().map(({ group, entries }) => (
          <section key={group.id} aria-label={group.label}>
            <h4 className="hud-micro mb-1 text-[var(--text-secondary)]">{group.label}</h4>
            <ul className="space-y-1.5">
              {entries.map((s) => (
                <li key={s.id} data-testid={`source-${s.id}`}>
                  <div className="flex flex-wrap items-center gap-x-2">
                    <Ext href={s.url}>
                      <span className="text-[var(--text-primary)]">{s.name}</span>
                    </Ext>
                    <span className="hud-micro text-[var(--text-muted)]">{MODE_LABEL[s.mode]}</span>
                  </div>
                  <p className="font-sans text-[var(--text-secondary)]">
                    {s.usedFor}. <span className="text-[var(--text-primary)]">{s.licence}</span>
                  </p>
                  {s.gate && <p className="hud-micro text-[var(--alert-orange)]">GATED · {s.gate.note}</p>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </section>

      <p className="font-sans text-[var(--text-secondary)]">
        This list is the full source register. Probe logs with status, latency and rate limits for each upstream are in{' '}
        <Ext href={`${REPO_URL}/blob/main/docs/DATA_SOURCES.md`}>docs/DATA_SOURCES.md</Ext>.
      </p>
    </div>
  );
}
