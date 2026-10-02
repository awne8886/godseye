'use client';
/**
 * Entity card bodies for the threats, network and maritime layers (the HUD frame supplies the
 * freshness badge, source line and observed-at / REFERENCE). Bodies add what honesty needs on top:
 * INDICATOR labels on blocklist points, REFERENCE on curated records inside mixed layers, position
 * precision for IP/country placements, methods for computed flags and heuristics.
 * Upstream strings render as React text only; links are http(s) with noopener. Owner:
 * layers-threats-network.
 */
import type { ReactNode } from 'react';
import type { CardProps } from '@/lib/feature-module';
import { useLayerStatus } from '@/lib/layer-host';
import type { AttackOrigin, C2Server, Chokepoint, ConflictZone, CountryRisk, GdacsIncident, GdeltEvent, LandingPoint, MalwareHost, NuclearSite, Outage, Port, SubmarineCable, ThreatIndicator, Vessel } from '@/lib/types';
import { CAMEO_ROOT, GEO_PRECISION_LABEL, QUAD_LABEL, type GdeltWindowCoverage } from '../shared/gdelt';
import type { ConflictEventCardData } from './selection';

const safeHttp = (u: unknown): string | null => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);
const iso = (t: string | null | undefined) => (t ? `${t.slice(0, 16).replace('T', ' ')} UTC` : '—');
const dash = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <dt className="font-mono text-[10px] uppercase tracking-[.16em] text-[var(--text-muted)]">{label}</dt>
      <dd className="text-right font-mono text-[11px] uppercase tracking-[.08em] tabular-nums text-[var(--text-primary)] [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function Chip({ tone = 'gold', children, testId }: { tone?: 'gold' | 'red' | 'muted' | 'orange'; children: ReactNode; testId?: string }) {
  const color = tone === 'red' ? 'var(--alert-red)' : tone === 'orange' ? 'var(--alert-orange)' : tone === 'muted' ? 'var(--text-secondary)' : 'var(--gold-primary)';
  return (
    <span data-testid={testId} className="mr-1 inline-block rounded border px-1.5 font-mono text-[10px] uppercase tracking-[.16em]" style={{ color, borderColor: color }}>
      {children}
    </span>
  );
}

function Link({ href, children }: { href: unknown; children: ReactNode }) {
  const url = safeHttp(href);
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="font-mono text-[11px] uppercase tracking-[.08em] text-[var(--gold-primary)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--gold-primary)]">
      {children}
    </a>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[12px] leading-snug text-[var(--text-secondary)]">{children}</p>;
}

function Body({ title, chips, children, testId }: { title: string; chips?: ReactNode; children: ReactNode; testId: string }) {
  return (
    <div data-testid={testId}>
      {chips && <div className="mb-1">{chips}</div>}
      <h3 className="mb-1 text-[13px] font-medium text-[var(--text-heading)] [overflow-wrap:anywhere]">{title}</h3>
      <dl>{children}</dl>
    </div>
  );
}

const PRECISION: Record<string, string> = { city: 'City (IP geolocation)', region: 'Region (IP geolocation)', 'country-centroid': 'Country label point' };

/**
 * Indicators that geolocate to exactly the same coordinate are drawn as ONE point with a count
 * (never displaced); the card lists every one of them. `members` is set by the network layer.
 */
function membersOf<T>(data: unknown): T[] | null {
  const m = (data as { members?: unknown }).members;
  return Array.isArray(m) && m.length > 1 ? (m as T[]) : null;
}

function MemberList<T>({ items, testId, render }: { items: readonly T[]; testId: string; render: (t: T) => { key: string; primary: string; secondary: string } }) {
  return (
    <ul data-testid={testId} aria-label={`${items.length} indicators at this position`} className="mt-2 max-h-56 overflow-y-auto border-t border-[var(--border-secondary)]">
      {items.map((t) => {
        const r = render(t);
        return (
          <li key={r.key} className="flex items-baseline justify-between gap-3 border-b border-[var(--border-secondary)] py-[3px] last:border-b-0">
            <span className="font-mono text-[11px] tracking-[.08em] tabular-nums text-[var(--text-primary)] [overflow-wrap:anywhere]">{r.primary}</span>
            <span className="text-right font-mono text-[10px] uppercase tracking-[.16em] text-[var(--text-secondary)]">{r.secondary}</span>
          </li>
        );
      })}
    </ul>
  );
}

function GroupCard<T>({ testId, title, chips, location, precision, members, render, source }: { testId: string; title: string; chips: ReactNode; location: string; precision: string; members: readonly T[]; render: (t: T) => { key: string; primary: string; secondary: string }; source: string }) {
  return (
    <Body testId={testId} title={title} chips={chips}>
      <Row label="Indicators">{members.length}</Row>
      <Row label="Location">{location || '—'}</Row>
      <Row label="Position">{precision}</Row>
      <Note>
        {members.length} {source} indicators geolocate to exactly this point, so the map draws one point with their count — none is moved. IP geolocation is approximate and is not an attacker’s location.
      </Note>
      <MemberList items={members} testId={`${testId}-members`} render={render} />
    </Body>
  );
}

// ── Threats ───────────────────────────────────────────────────────────────────────
export function NuclearCard({ selection }: CardProps) {
  const s = selection.data as unknown as NuclearSite;
  return (
    <Body testId="card-nuclear" title={s.name} chips={<Chip testId="card-reference">REFERENCE</Chip>}>
      <Row label="Status">{s.status.replace('_', ' ')}</Row>
      <Row label="Country">{dash(s.country)}</Row>
      {s.city && <Row label="City">{s.city}</Row>}
      <Row label="Operator">{dash(s.operator)}</Row>
      <Row label="Reactors">{dash(s.reactors)}</Row>
      <Row label="Capacity">{s.capacityMwe ? `${Math.round(s.capacityMwe)} MWe` : '—'}</Row>
      <Row label="Record">{s.source === 'wikidata' ? `Wikidata ${s.wikidataId}` : 'Curated list'}</Row>
      {s.flags.map((f) => (
        <div key={f.kind} className="mt-2 rounded border border-[var(--alert-orange)] p-2">
          <Chip tone="orange">{f.kind} flag</Chip>
          <span className="font-mono text-[11px] uppercase tracking-[.08em] text-[var(--text-primary)]">{f.label}</span>
          <Note>
            Method: {f.method}. Observed {iso(f.observedAt)}.
          </Note>
        </div>
      ))}
      <Link href={s.sourceUrl}>Source record</Link>
    </Body>
  );
}

export function GdacsCard({ selection }: CardProps) {
  const g = selection.data as unknown as GdacsIncident;
  return (
    <Body testId="card-gdacs" title={g.title} chips={g.alertLevel && <Chip tone={g.alertLevel === 'red' ? 'red' : g.alertLevel === 'orange' ? 'orange' : 'muted'}>{g.alertLevel} alert</Chip>}>
      <Row label="Type">{g.eventType}</Row>
      <Row label="Country">{dash(g.country)}</Row>
      <Row label="From">{iso(g.fromDate)}</Row>
      <Row label="To">{iso(g.toDate)}</Row>
      <Link href={g.url}>GDACS report</Link>
    </Body>
  );
}

export function GdeltCard({ selection }: CardProps) {
  const e = selection.data as unknown as GdeltEvent & { windowCoverage?: GdeltWindowCoverage };
  const cov = e.windowCoverage;
  return (
    <Body testId="card-gdelt" title={[e.actor1, e.actor2].filter(Boolean).join(' → ') || 'Unattributed actors'} chips={<Chip tone={e.quadClass >= 3 ? 'red' : 'muted'}>{QUAD_LABEL[e.quadClass]}</Chip>}>
      <Row label="Action">{`${CAMEO_ROOT[e.rootCode] ?? 'CAMEO'} (${e.eventCode})`}</Row>
      <Row label="Place">{dash(e.place)}</Row>
      <Row label="Geocode">{GEO_PRECISION_LABEL[e.geoPrecision] ?? e.geoPrecision}</Row>
      <Row label="Country (FIPS)">{dash(e.countryCode)}</Row>
      <Row label="Goldstein">{dash(e.goldstein)}</Row>
      <Row label="Tone">{e.avgTone === null ? '—' : e.avgTone.toFixed(1)}</Row>
      <Row label="Mentions / sources / articles">{`${e.numMentions} / ${e.numSources} / ${e.numArticles}`}</Row>
      <Row label="Batch added">{iso(e.dateAdded)}</Row>
      <Row label="Event date">{e.observedAt ? e.observedAt.slice(0, 10) : '—'}</Row>
      <Note>Machine-coded from news coverage (GDELT); the point is the geocoded place named in the article.</Note>
      {cov && (
        <Note>
          <span data-testid="card-gdelt-coverage">{`The map draws the newest ${cov.served.toLocaleString('en-US')} of ${cov.total.toLocaleString('en-US')} geocoded events in this hour’s window; the rest are not shown.`}</span>
        </Note>
      )}
      <Link href={e.sourceUrl}>Source article</Link>
    </Body>
  );
}

/**
 * An in-zone GDELT event or Live Alert (observed, not REFERENCE). Its selection is attributed to the
 * GDELT events or alert pins layer; the conflict-zone feed that delivered it is restated here when it is stale or offline.
 */
/** "Rybar · Russian military OSINT (russian bloc)": who made an in-zone alert claim, never blank. */
function channelStance(e: ConflictEventCardData): string {
  const name = e.sourceName ?? e.sourceHandle ?? 'Unattributed channel';
  const stance = e.lean ? `${e.lean}${e.bloc ? ` (${e.bloc} bloc)` : ''}` : e.bloc ? `${e.bloc} bloc` : 'stance not recorded';
  return `${name} · ${stance}`;
}

function ConflictEventBody({ e }: { e: ConflictEventCardData }) {
  const feed = useLayerStatus('conflict_zones');
  const degraded = feed.state === 'stale' || feed.state === 'offline';
  const alert = e.source === 'alerts';
  return (
    <Body testId="card-conflict-event" title={e.title} chips={<Chip tone="red">{alert ? 'Live Alert' : 'GDELT event'}</Chip>}>
      {alert && <Row label="Channel · stance">{channelStance(e)}</Row>}
      <Row label="Zone">{dash(e.zoneLabel)}</Row>
      <Row label="Precision">{e.precision}</Row>
      <Row label={alert ? 'Published' : 'Reported'}>{iso(e.observedAt)}</Row>
      {degraded && <Row label="Feed">{`${feed.state === 'offline' ? 'Source offline' : 'Stale'} · last good ${iso(feed.lastGoodAt)}`}</Row>}
      <Note>
        {alert
          ? 'Drawn at the post’s keyword-geoparsed place, never moved toward a zone anchor. The post is not verified.'
          : 'Drawn at the event’s own geocoded coordinates, never moved toward a zone anchor.'}
      </Note>
      <Link href={e.url}>{alert ? 'Source post' : 'Source article'}</Link>
    </Body>
  );
}

export function ConflictZoneCard({ selection }: CardProps) {
  const d = selection.data as unknown as (ConflictZone & { kind: 'reference' }) | (ConflictEventCardData & { kind?: undefined });
  if (d.kind !== 'reference') return <ConflictEventBody e={d as ConflictEventCardData} />;
  const z = d as ConflictZone;
  return (
    <Body testId="card-conflict-zone" title={z.label} chips={<Chip testId="card-reference">REFERENCE</Chip>}>
      <Row label="Severity">{z.severity}</Row>
      <Row label="Region">{z.region}</Row>
      <Row label="Live events (≤ 24 h)">{z.liveEventCount}</Row>
      <Note>{z.description}</Note>
      <Note>The polygon is a curated reference area, not a frontline. Event counts are GDELT material/verbal-conflict reports and geoparsed rocket/event Live Alerts (general news headlines excluded) located inside it (country-level locations excluded).</Note>
      {z.references.map((r) => (
        <div key={r}>
          <Link href={r}>{new URL(r).hostname}</Link>
        </div>
      ))}
    </Body>
  );
}

export function FrontlineCard({ selection }: CardProps) {
  const f = selection.data as { name?: string | null; asOf?: string | null };
  return (
    <Body testId="card-frontline" title={f.name || 'DeepStateMap area'} chips={<Chip>DeepStateMap</Chip>}>
      <Row label="Snapshot">{iso(f.asOf)}</Row>
      <Note>Frontline mapping © DeepStateMap.Live, non-commercial use with attribution.</Note>
      <Link href="https://deepstatemap.live/">deepstatemap.live</Link>
    </Body>
  );
}

export function CountryRiskCard({ selection }: CardProps) {
  const r = selection.data as unknown as CountryRisk;
  return (
    <Body testId="card-country-risk" title={r.name} chips={<Chip testId="card-reference">REFERENCE</Chip>}>
      <Row label="INFORM risk (0–10)">{r.score === null ? 'no score' : r.score.toFixed(1)}</Row>
      <Row label="WGI political stability">{r.components.wgi_pv === null || r.components.wgi_pv === undefined ? '—' : r.components.wgi_pv.toFixed(2)}</Row>
      <Note>Method: {r.method}</Note>
      <Note>Sources: {r.sources.join(' · ')}</Note>
    </Body>
  );
}

// ── Network ───────────────────────────────────────────────────────────────────────
export function MalwareCard({ selection }: CardProps) {
  const h = selection.data as unknown as MalwareHost;
  const members = membersOf<MalwareHost>(selection.data);
  if (members)
    return (
      <GroupCard
        testId="card-malware"
        title={`${members.length} malware hosts`}
        chips={<><Chip tone="red" testId="card-indicator">INDICATOR</Chip><Chip tone="muted">URLhaus</Chip></>}
        location={[h.city, h.country].filter(Boolean).join(', ')}
        precision={PRECISION[h.geoPrecision] ?? '—'}
        members={members}
        source="URLhaus"
        render={(m) => ({ key: m.ip, primary: `${m.ip}${m.port ? `:${m.port}` : ''}`, secondary: [m.family, m.online ? 'online' : 'offline'].filter(Boolean).join(' · ') })}
      />
    );
  return (
    <Body testId="card-malware" title={`${h.ip}${h.port ? `:${h.port}` : ''}`} chips={<><Chip tone="red" testId="card-indicator">INDICATOR</Chip><Chip tone="muted">URLhaus</Chip></>}>
      <Row label="Threat">{h.threat.replace('_', ' ')}</Row>
      <Row label="Tag / family">{dash(h.family)}</Row>
      <Row label="URLs">{h.urlCount}</Row>
      <Row label="Status">{h.online ? 'online (URLhaus check)' : 'offline'}</Row>
      <Row label="ASN">{dash(h.asn)}</Row>
      <Row label="Location">{[h.city, h.country].filter(Boolean).join(', ') || '—'}</Row>
      <Row label="Position">{PRECISION[h.geoPrecision]}</Row>
      <Row label="First seen">{iso(h.firstSeen)}</Row>
      <Note>A blocklist INDICATOR: this IP hosted malware URLs. It is not an attacker’s location, and IP geolocation is approximate.</Note>
      <Link href={h.urlhausReference}>URLhaus entry</Link>
    </Body>
  );
}

export function C2Card({ selection }: CardProps) {
  const c = selection.data as unknown as C2Server;
  const members = membersOf<C2Server>(selection.data);
  if (members)
    return (
      <GroupCard
        testId="card-c2"
        title={`${members.length} botnet C2 servers`}
        chips={<Chip tone="red" testId="card-indicator">INDICATOR</Chip>}
        location={dash(c.country)}
        precision={PRECISION[c.geoPrecision] ?? '—'}
        members={members}
        source="Feodo Tracker"
        render={(m) => ({ key: m.id, primary: `${m.ip}${m.port ? `:${m.port}` : ''}`, secondary: [m.malware, m.status].filter(Boolean).join(' · ') })}
      />
    );
  return (
    <Body testId="card-c2" title={`${c.ip}${c.port ? `:${c.port}` : ''}`} chips={<><Chip tone="red" testId="card-indicator">INDICATOR</Chip><Chip tone={c.status === 'online' ? 'orange' : 'muted'}>{c.status}</Chip></>}>
      <Row label="Malware">{dash(c.malware)}</Row>
      <Row label="AS">{[c.asn, c.asName].filter(Boolean).join(' ') || '—'}</Row>
      <Row label="Country">{dash(c.country)}</Row>
      <Row label="Hostname">{dash(c.hostname)}</Row>
      <Row label="First seen">{iso(c.firstSeen)}</Row>
      <Row label="Last online">{c.lastOnline ? (c.lastOnlineDateOnly ? `${c.lastOnline.slice(0, 10)} (date only)` : iso(c.lastOnline)) : '—'}</Row>
      <Row label="Position">{PRECISION[c.geoPrecision]}</Row>
      <Note>Feodo Tracker blocklist entry (botnet command-and-control). Status is Feodo’s own check; no attack path is implied.</Note>
      <Link href="https://feodotracker.abuse.ch/browse/">Feodo Tracker</Link>
    </Body>
  );
}

export function ThreatIndicatorCard({ selection }: CardProps) {
  const t = selection.data as unknown as ThreatIndicator;
  const members = membersOf<ThreatIndicator>(selection.data);
  if (members)
    return (
      <GroupCard
        testId="card-threatfox"
        title={`${members.length} ThreatFox indicators`}
        chips={<><Chip tone="red" testId="card-indicator">INDICATOR</Chip><Chip tone="muted">ThreatFox</Chip></>}
        location=""
        precision={t.geo ? (PRECISION[t.geo.precision] ?? '—') : 'not placed'}
        members={members}
        source="ThreatFox"
        render={(m) => ({ key: m.id, primary: m.ioc, secondary: [m.malware, m.threatType.replace('_', ' ')].filter(Boolean).join(' · ') })}
      />
    );
  return (
    <Body testId="card-threatfox" title={t.ioc} chips={<><Chip tone="red" testId="card-indicator">INDICATOR</Chip><Chip tone="muted">ThreatFox</Chip></>}>
      <Row label="IOC type">{t.iocType}</Row>
      <Row label="Threat">{t.threatType.replace('_', ' ')}</Row>
      <Row label="Malware">{dash(t.malware)}</Row>
      <Row label="Confidence">{t.confidence === null ? '—' : `${t.confidence}%`}</Row>
      <Row label="Tags">{t.tags.join(', ') || '—'}</Row>
      <Row label="First seen">{iso(t.firstSeen)}</Row>
      <Row label="Position">{t.geo ? PRECISION[t.geo.precision] : 'not placed'}</Row>
      <Note>Reported indicator of compromise. Only IP indicators are placed (approximately); domains are never resolved.</Note>
      <Link href={t.reference}>Reference</Link>
    </Body>
  );
}

export function OutageCard({ selection }: CardProps) {
  const o = selection.data as unknown as Outage;
  return (
    <Body testId="card-outage" title={`${o.country} internet outage`} chips={<Chip tone={o.ongoing ? 'orange' : 'muted'}>{o.ongoing ? 'ongoing' : 'resolved'}</Chip>}>
      <Row label="Provider">{o.provider}</Row>
      <Row label="Scope">{dash(o.scope)}</Row>
      <Row label="Cause">{dash(o.cause)}</Row>
      <Row label="Started">{iso(o.startedAt)}</Row>
      <Row label="Ended">{o.endedAt ? iso(o.endedAt) : '—'}</Row>
      {o.description && <Note>{o.description}</Note>}
      <Note>Country-level signal: the marker sits at the country’s label point, not at the affected network.</Note>
      <Link href={o.url}>Details</Link>
    </Body>
  );
}

export function AttackOriginCard({ selection }: CardProps) {
  const a = selection.data as unknown as AttackOrigin;
  return (
    <Body testId="card-attack-origin" title={a.country} chips={<Chip>Cloudflare Radar</Chip>}>
      <Row label="Share of L3 attacks">{`${a.sharePct.toFixed(1)}%`}</Row>
      <Row label="Target">{a.targetCountryCode ?? 'not reported'}</Row>
      <Note>Origin share of Layer 3 DDoS traffic seen by Cloudflare (24 h). Origins can be spoofed; no target is implied unless reported.</Note>
    </Body>
  );
}

export function CableCard({ selection }: CardProps) {
  const c = selection.data as unknown as SubmarineCable;
  return (
    <Body testId="card-cable" title={c.name} chips={<Chip testId="card-reference">REFERENCE</Chip>}>
      <Row label="Ready for service">{dash(c.rfsYear)}</Row>
      <Row label="Length">{c.lengthKm ? `${c.lengthKm} km` : '—'}</Row>
      <Note>Route geometry © TeleGeography Submarine Cable Map, CC BY-NC-SA 3.0 (bundled 2026-09-30). Routes are schematic.</Note>
      <Link href={c.url}>Cable page</Link>
    </Body>
  );
}

export function LandingPointCard({ selection }: CardProps) {
  const p = selection.data as unknown as LandingPoint;
  return (
    <Body testId="card-landing" title={p.name} chips={<Chip testId="card-reference">REFERENCE</Chip>}>
      <Row label="Country">{dash(p.country)}</Row>
      <Note>Cable landing point © TeleGeography, CC BY-NC-SA 3.0.</Note>
    </Body>
  );
}

// ── Maritime ──────────────────────────────────────────────────────────────────────
const DATASET: Record<Port['dataset'], string> = { wpi: 'NGA World Port Index', 'natural-earth': 'Natural Earth', curated: 'Curated list' };

export function PortCard({ selection }: CardProps) {
  const p = selection.data as unknown as Port;
  return (
    <Body testId="card-port" title={p.name} chips={<Chip testId="card-reference">REFERENCE</Chip>}>
      <Row label="Type">{p.type}</Row>
      <Row label="Country">{dash(p.country)}</Row>
      <Row label="Dataset">{DATASET[p.dataset]}</Row>
      {p.harborSize && <Row label="Harbour size">{p.harborSize}</Row>}
      {p.rank && <Row label="Rank">{p.rank}</Row>}
      {p.volume && <Row label="Volume (reference)">{p.volume}</Row>}
      {p.fleet && <Row label="Fleet (reference)">{p.fleet}</Row>}
      {p.live && (
        <>
          <Row label="Ships ≤ 50 km (AIS)">{p.live.shipsNearby}</Row>
          <Row label="Waiting (< 0.5 kn)">{p.live.waiting}</Row>
          <Row label="Congestion">{p.live.congestion}</Row>
          <Note>Congestion is a {p.live.method}, not an official port status.</Note>
        </>
      )}
    </Body>
  );
}

export function ChokepointCard({ selection }: CardProps) {
  const c = selection.data as unknown as Chokepoint;
  return (
    <Body testId="card-chokepoint" title={c.name} chips={<Chip testId="card-reference">REFERENCE</Chip>}>
      <Row label="Risk (curated)">{c.baseRisk}</Row>
      <Row label="Traffic (reference)">{dash(c.traffic)}</Row>
      <Row label="Ships ≤ 100 km (AIS)">{c.shipsNearby === null ? 'AIS not configured' : c.shipsNearby}</Row>
    </Body>
  );
}

export function VesselCard({ selection }: CardProps) {
  const v = selection.data as unknown as Vessel;
  return (
    <Body testId="card-vessel" title={v.name ?? `MMSI ${v.mmsi}`} chips={<Chip>AIS</Chip>}>
      <Row label="MMSI">{v.mmsi}</Row>
      <Row label="Type">{`${v.type}${v.aisType !== null ? ` (${v.aisType})` : ''}`}</Row>
      <Row label="Call sign">{dash(v.callsign)}</Row>
      <Row label="IMO">{dash(v.imo)}</Row>
      <Row label="Speed">{v.sogKt === null ? '—' : `${v.sogKt.toFixed(1)} kn`}</Row>
      <Row label="Course">{v.cogDeg === null ? '—' : `${Math.round(v.cogDeg)}°`}</Row>
      <Row label="Destination">{dash(v.destination)}</Row>
      <Row label="Track points">{v.track.length}</Row>
    </Body>
  );
}
