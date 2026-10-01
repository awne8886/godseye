// @vitest-environment jsdom
/**
 * visual-qa round 4 m5: the conflict-zone card header read "ukraine", the internal slug, because
 * the card frame prints `selection.id` under the kind. Curated records whose ids we mint from a
 * name (zones, chokepoints, curated ports) now carry their display name there; an in-zone event
 * names its zone by display name too. Data: the bundled reference files and a real GDELT batch
 * (fixture 2026-09-30); rendered through the real card frame.
 */
import { cleanup, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EntityCardFrame from '@/components/cards/EntityCardFrame';
import { buildChokepoints, buildPorts } from '@/features/maritime/server/maritime';
import { useLayerStatusStore, type Selection } from '@/lib/layer-host';
import { gdeltCoverage } from '../shared/gdelt';
import { ChokepointCard, ConflictZoneCard, GdeltCard, PortCard } from './cards';
import { fixture, FX } from '../server/__fixtures__';
import { buildConflicts, loadZones } from '../server/conflicts';
import { parseExport } from '../server/gdelt';
import { readRef } from '../server/refdata';
import { unzipFirst } from '../server/zip';
import { chokepointSelection, conflictEventSelection, portSelection, zoneSelection } from './selection';

afterEach(cleanup);

const batch = parseExport(unzipFirst(fixture(FX.gdeltZip)).data.toString('utf8')).events;
// The batch's own publish time, so its rows sit inside the rolling 24 h window.
const built = buildConflicts(loadZones(), new Map(), batch, Date.parse('2026-09-30T20:10:00Z'));
const zones = built.zones;
const byId = new Map(zones.map((z) => [z.id, z]));

function card(selection: Selection, Body: typeof ConflictZoneCard) {
  const { container } = render(
    <EntityCardFrame selection={selection} feed={undefined} onClose={() => {}}>
      <Body selection={selection} />
    </EntityCardFrame>,
  );
  const header = container.querySelector('header')!;
  // The line under the kind title (the frame's id line).
  return { container, subtitle: header.querySelector('h2 + p')!.textContent };
}

describe('card headers name curated records, never their minted ids (visual-qa r4 m5)', () => {
  it('every conflict-zone card is headed by the zone display name', () => {
    expect(zones).toHaveLength(15);
    for (const z of zones) {
      const { container, subtitle } = card(zoneSelection(z), ConflictZoneCard);
      expect(subtitle).toBe(z.label);
      expect(subtitle).not.toBe(z.id);
      // Nowhere on the card, header or body.
      expect(within(container).queryByText(z.id)).toBeNull();
      cleanup();
    }
    expect(card(zoneSelection(byId.get('ukraine')!), ConflictZoneCard).subtitle).toBe('UKRAINE WAR');
  });

  it('an in-zone GDELT event keeps its event id and names its zone by display name', () => {
    expect(built.events.length).toBeGreaterThan(0);
    const e = built.events[0]!;
    const zone = byId.get(e.zoneId!)!;
    const sel = conflictEventSelection(e, zone);
    expect(sel.id).toBe(e.id);
    const { container } = card(sel, ConflictZoneCard);
    const row = within(container).getByText('Zone').parentElement!;
    expect(row.querySelector('dd')!.textContent).toBe(zone.label);
    expect(within(container).queryByText(zone.id)).toBeNull();
  });

  // R3 round-5 MINOR-1: the in-zone event selection used the REFERENCE zone layer, so an event GDELT
  // published at 13:20Z was badged REFERENCE with "REFERENCE DATA" as its observed time.
  it('an in-zone GDELT event card is observed data, never REFERENCE', () => {
    const e = built.events[0]!;
    const sel = conflictEventSelection(e, byId.get(e.zoneId!));
    expect(sel.layer).toBe('gdelt_events');
    expect(sel.observedAt).toBe(e.observedAt);
    const now = Date.parse(e.observedAt) + 5 * 60_000;
    vi.setSystemTime(now);
    try {
      const feed = { state: 'live' as const, count: 1, fetchedAt: new Date(now).toISOString(), observedAt: e.observedAt, lastGoodAt: new Date(now).toISOString() };
      const { container } = render(
        <EntityCardFrame selection={sel} feed={feed} onClose={() => {}}>
          <ConflictZoneCard selection={sel} />
        </EntityCardFrame>,
      );
      expect(container.textContent).not.toMatch(/REFERENCE/);
      const observed = within(container).getByText('OBSERVED').nextElementSibling!.textContent!;
      expect(observed).toContain(e.observedAt.slice(0, 10));
      expect(observed).not.toContain('REFERENCE DATA');
      cleanup();
      // Without the GDELT events layer on, the badge still never claims LIVE or REFERENCE.
      const bare = render(
        <EntityCardFrame selection={sel} feed={undefined} onClose={() => {}}>
          <ConflictZoneCard selection={sel} />
        </EntityCardFrame>,
      );
      expect(bare.container.querySelector('header')!.textContent).not.toMatch(/LIVE|REFERENCE/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an in-zone event card restates a stale conflict-zone feed (the feed that delivered it)', () => {
    const e = built.events[0]!;
    const sel = conflictEventSelection(e, byId.get(e.zoneId!));
    useLayerStatusStore.setState({ status: { conflict_zones: { state: 'stale', count: 15, fetchedAt: null, observedAt: null, lastGoodAt: '2026-09-30T20:10:00.000Z' } } });
    try {
      const { container } = render(<ConflictZoneCard selection={sel} />);
      const row = within(container).getByText('Feed').parentElement!;
      expect(row.querySelector('dd')!.textContent).toBe('Stale · last good 2026-09-30 20:10 UTC');
      cleanup();
      useLayerStatusStore.setState({ status: { conflict_zones: { state: 'live', count: 15, fetchedAt: null, observedAt: null, lastGoodAt: null } } });
      expect(within(render(<ConflictZoneCard selection={sel} />).container).queryByText('Feed')).toBeNull();
    } finally {
      useLayerStatusStore.setState({ status: {} });
    }
  });

  it('chokepoints and curated ports are headed by their names; WPI / Natural Earth ports keep the upstream index', () => {
    const chokes = buildChokepoints(readRef('chokepoints.json'));
    expect(chokes).toHaveLength(10);
    for (const c of chokes) {
      expect(c.id.startsWith('choke-')).toBe(true);
      expect(card(chokepointSelection(c), ChokepointCard).subtitle).toBe(c.name);
      cleanup();
    }
    const ports = buildPorts(readRef('ports.json'));
    const curated = ports.find((p) => p.dataset === 'curated')!;
    const wpi = ports.find((p) => p.dataset === 'wpi')!;
    const ne = ports.find((p) => p.dataset === 'natural-earth')!;
    expect(card(portSelection(curated), PortCard).subtitle).toBe(curated.name);
    cleanup();
    expect(card(portSelection(wpi), PortCard).subtitle).toBe(wpi.id);
    expect(wpi.id).toMatch(/^wpi-\d+$/);
    expect(portSelection(ne).id).toMatch(/^ne-\d+$/);
  });

  it('display-name ids stay unique, so each record still gets its own card', () => {
    expect(new Set(zones.map((z) => zoneSelection(z).id)).size).toBe(zones.length);
    const chokes = buildChokepoints(readRef('chokepoints.json'));
    expect(new Set(chokes.map((c) => chokepointSelection(c).id)).size).toBe(chokes.length);
    const curated = buildPorts(readRef('ports.json')).filter((p) => p.dataset === 'curated');
    expect(new Set(curated.map((p) => portSelection(p).id)).size).toBe(curated.length);
  });
});

// R3 round-5 MINOR-3: /api/gdelt-events served the first N of the window without saying so.
describe('GDELT window coverage is stated, never silent', () => {
  const e = batch[0]!;
  it('gdeltCoverage: null when the whole window was served, served/total otherwise', () => {
    expect(gdeltCoverage({ items: batch, total: batch.length, truncated: false })).toBeNull();
    expect(gdeltCoverage({ items: batch })).toBeNull();
    expect(gdeltCoverage({ items: batch.slice(0, 1000), total: 4247, truncated: true })).toEqual({ served: 1000, total: 4247 });
    // A capped window whose kept events were all served still says what was left out.
    expect(gdeltCoverage({ items: batch, total: batch.length + 300, truncated: true })).toEqual({ served: batch.length, total: batch.length + 300 });
  });

  it('the GDELT card says how much of the window the map draws when it is not all of it', () => {
    const sel = (data: Record<string, unknown>): Selection => ({ kind: 'gdelt_event', id: e.id, layer: 'gdelt_events', source: 'gdelt', observedAt: e.dateAdded, data, lngLat: [e.lng, e.lat] });
    const full = render(<GdeltCard selection={sel({ ...e })} />);
    expect(within(full.container).queryByTestId('card-gdelt-coverage')).toBeNull();
    cleanup();
    const part = render(<GdeltCard selection={sel({ ...e, windowCoverage: { served: 5000, total: 5412 } })} />);
    expect(within(part.container).getByTestId('card-gdelt-coverage').textContent).toBe('The map draws the newest 5,000 of 5,412 geocoded events in this hour’s window; the rest are not shown.');
  });
});
