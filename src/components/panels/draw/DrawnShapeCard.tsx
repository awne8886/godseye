'use client';
/**
 * Card body for a `drawn_shape` selection (the HUD frame supplies the title, source and the
 * observed-at line): a drawn shape with its geodesic measurements in the visitor's units, the
 * planned route (engine, mode, distance, time, tolls/highways/ferries) or an imported ArcGIS
 * feature's attributes. Everything is local or user-imported — nothing here is a live observation.
 * All strings are rendered as React text (never HTML). Owner: panels-recon.
 */
import type { CardProps } from '@/lib/feature-module';
import { useSelectionStore } from '@/lib/layer-host';
import { useUiStore } from '@/lib/store';
import { HudButton, KeyValues, Prose } from '../recon/ui';
import { useOverlayStore } from '../recon/overlay-store';
import { formatDuration } from '../directions/format';
import { formatArea, formatDistance } from './geometry';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function Rows({ rows }: { rows: [string, string | null][] }) {
  const shown = rows.filter((r): r is [string, string] => r[1] !== null);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[11px] tracking-[0.08em]">
      {shown.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="uppercase text-[var(--text-muted)]">{k}</dt>
          <dd className="break-words tabular-nums text-[var(--text-primary)]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function DrawnBody({ d }: { d: Record<string, unknown> }) {
  const units = useUiStore((s) => s.settings.units);
  const id = str(d.featureId);
  const exists = useOverlayStore((s) => (id ? s.features.some((f) => f.properties.id === id) : false));
  const len = num(d.lengthM);
  const area = num(d.areaM2);
  const per = num(d.perimeterM);
  const rad = num(d.radiusM);
  return (
    <div className="flex flex-col gap-2" data-testid="drawn-shape-card">
      <Rows
        rows={[
          ['Shape', str(d.shape)?.toUpperCase() ?? null],
          ['Vertices', num(d.vertices) !== null ? String(d.vertices) : null],
          ['Length', len !== null ? formatDistance(len, units) : null],
          ['Radius', rad !== null ? formatDistance(rad, units) : null],
          ['Area', area !== null ? formatArea(area, units) : null],
          ['Perimeter', per !== null ? formatDistance(per, units) : null],
          ['AOI', d.aoi === true ? 'YES' : null],
        ]}
      />
      <Prose>Drawn on this device and kept in this browser only; measurements are geodesic.</Prose>
      {exists && id && (
        <HudButton
          tone="red"
          onClick={() => {
            useOverlayStore.getState().removeFeature(id);
            useSelectionStore.getState().clear();
          }}
        >
          Remove shape
        </HudButton>
      )}
    </div>
  );
}

function RouteBody({ d }: { d: Record<string, unknown> }) {
  const units = useUiStore((s) => s.settings.units);
  const idx = num(d.routeIndex);
  const current = useOverlayStore((s) => s.route?.active ?? null);
  const dist = num(d.distanceM);
  const dur = num(d.durationS);
  const up = num(d.ascentM);
  const down = num(d.descentM);
  const flags = [d.hasToll === true && 'tolls', d.hasHighway === true && 'highways', d.hasFerry === true && 'ferries'].filter(Boolean).join(', ');
  return (
    <div className="flex flex-col gap-2" data-testid="drawn-route-card">
      <Rows
        rows={[
          ['Engine', str(d.engine)?.toUpperCase() ?? null],
          ['Mode', str(d.mode)?.toUpperCase() ?? null],
          ['Distance', dist !== null ? formatDistance(dist, units) : null],
          ['Time', dur !== null ? formatDuration(dur) : null],
          ['Steps', num(d.steps) !== null ? String(d.steps) : null],
          ['Uses', flags || 'no tolls, highways or ferries reported'],
          ['Climb', up !== null && down !== null ? `+${Math.round(up)} m / -${Math.round(down)} m` : null],
          ['Option', idx !== null && num(d.routes) !== null ? `${idx + 1} of ${String(d.routes)}` : null],
        ]}
      />
      <Prose>Computed by the routing engine when you asked for it ({str(d.computedAt) ?? 'time unknown'}); traffic is not included. {str(d.attribution) ?? ''}</Prose>
      {idx !== null && current !== null && idx !== current && (
        <HudButton tone="cyan" onClick={() => useOverlayStore.getState().setActiveRoute(idx)}>
          Use this route
        </HudButton>
      )}
    </div>
  );
}

function ArcgisBody({ d }: { d: Record<string, unknown> }) {
  const attrs = (d.attributes && typeof d.attributes === 'object' ? d.attributes : {}) as Record<string, unknown>;
  const omitted = num(d.omittedAttributes) ?? 0;
  return (
    <div className="flex flex-col gap-2" data-testid="drawn-arcgis-card">
      <Rows
        rows={[
          ['Layer', str(d.layerTitle)],
          ['Feature', num(d.featureIndex) !== null ? `#${Number(d.featureIndex) + 1}` : null],
          ['Geometry', str(d.geometryType)],
          ['Imported', str(d.importedAt)],
        ]}
      />
      {Object.keys(attrs).length ? <KeyValues data={attrs} /> : <Prose>This feature has no attributes.</Prose>}
      {omitted > 0 && <Prose>{omitted} more attribute(s) not shown (non-text values or over the card limit).</Prose>}
      {str(d.serviceUrl) && <p className="break-all font-mono text-[10px] tracking-[0.16em] text-[var(--text-muted)]">{str(d.serviceUrl)}</p>}
      <Prose>Imported from a public ArcGIS Feature Service as published by its owner; the attributes are theirs and were not verified here.</Prose>
    </div>
  );
}

export function DrawnShapeCard({ selection }: CardProps) {
  const d = selection.data;
  if (d.type === 'drawn') return <DrawnBody d={d} />;
  if (d.type === 'route') return <RouteBody d={d} />;
  if (d.type === 'arcgis') return <ArcgisBody d={d} />;
  return null;
}

export default DrawnShapeCard;
