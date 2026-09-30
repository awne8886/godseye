'use client';
/**
 * SOURCES & LICENCES: basemap/imagery attribution plus every deployable layer with its kind
 * (LIVE / REFERENCE), refresh interval, route and the attribution its feed reported. Layers whose
 * feed has not answered yet say so rather than guessing. Owner: design-system-hud.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { PanelProps } from '@/lib/feature-module';
import { LAYER_GROUPS, type LayerId } from '@/lib/layer-registry';
import { useLayerStatusStore } from '@/lib/layer-host';
import { useUiStore } from '@/lib/store';
import { useVisibleLayers } from '../hooks';
import { AttributionLine, statusAttribution } from '../LayerRows';
import { usePanelChip } from '../PanelChrome';
import { refreshLabel } from '../status-logic';

const BASE = [
  { text: 'OpenFreeMap', url: 'https://openfreemap.org', licence: 'Tiles' },
  { text: '© OpenMapTiles', url: 'https://www.openmaptiles.org/', licence: 'BSD-3 / CC-BY' },
  { text: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright', licence: 'ODbL' },
];
const SAT = { text: 'Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community', url: 'https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9', licence: 'Esri terms of use' };

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return /^https?:\/\//.test(href) ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline decoration-[var(--border-active)] underline-offset-2 hover:text-[var(--gold-light)]">
      {children}
    </a>
  ) : (
    <span>{children}</span>
  );
}

export default function AttributionPanel(_: PanelProps) {
  const layers = useVisibleLayers();
  const basemap = useUiStore((s) => s.basemap);
  const status = useLayerStatusStore((s) => s.status);
  usePanelChip(`${layers.length} SOURCES`, 'idle');
  return (
    <div className="space-y-4 text-[12px]">
      <section aria-label="Basemap">
        <h3 className="hud-micro mb-1 text-[var(--text-secondary)]">BASEMAP</h3>
        <ul className="space-y-0.5 text-[var(--text-primary)]">
          {[...BASE, ...(basemap === 'satellite' ? [SAT] : [])].map((a) => (
            <li key={a.text}>
              <Ext href={a.url}>{a.text}</Ext> <span className="text-[var(--text-muted)]">· {a.licence}</span>
            </li>
          ))}
        </ul>
      </section>
      {LAYER_GROUPS.map((g) => {
        const inGroup = layers.filter((l) => l.group === g.id);
        if (!inGroup.length) return null;
        return (
          <section key={g.id} aria-label={g.label}>
            <h3 className="hud-micro mb-1 text-[var(--text-secondary)]">{g.label}</h3>
            <ul className="space-y-2">
              {inGroup.map((l) => {
                const st = status[l.id as LayerId];
                const attr = st ? statusAttribution(st) : [];
                const providers = st?.providers ? Object.keys(st.providers) : [];
                return (
                  <li key={l.id}>
                    <div className="flex items-center gap-2">
                      <span className="hud-text text-[11px] text-[var(--text-primary)]">{l.label}</span>
                      <span className="instrument-chip text-[var(--text-secondary)]">{l.kind === 'reference' ? 'REFERENCE' : l.kind === 'mixed' ? 'LIVE + REFERENCE' : 'LIVE'}</span>
                      <span className="hud-micro text-[var(--text-muted)]">{refreshLabel(l.refreshMs, l.transport)}</span>
                    </div>
                    {l.description && <p className="font-sans text-[var(--text-secondary)]">{l.description}</p>}
                    {attr.length > 0 ? (
                      attr.map((a) => (
                        <p key={a.text} className="text-[var(--text-primary)]" data-testid={`sources-${l.id}`}>
                          <AttributionLine a={a} />
                        </p>
                      ))
                    ) : providers.length > 0 ? (
                      <p className="text-[var(--text-primary)]">Providers: {providers.join(', ')}</p>
                    ) : (
                      <p className="text-[var(--text-muted)]">{l.route ? `Attribution appears once ${l.route} has answered (switch the layer on).` : 'Computed in the browser.'}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <p className="font-sans text-[var(--text-secondary)]">
        Full source list with licences and rate limits:{' '}
        <Link href="/docs" prefetch={false} className="underline decoration-[var(--border-active)] underline-offset-2">
          /docs
        </Link>
        .
      </p>
    </div>
  );
}
