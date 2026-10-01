// @vitest-environment jsdom
/**
 * visual-qa round 4 m5: the conflict-zone card header read "ukraine", the internal slug, because
 * the card frame prints `selection.id` under the kind. Curated records whose ids we mint from a
 * name (zones, chokepoints, curated ports) now carry their display name there; an in-zone event
 * names its zone by display name too. Data: the bundled reference files and a real GDELT batch
 * (fixture 2026-09-30); rendered through the real card frame.
 */
import { cleanup, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import EntityCardFrame from '@/components/cards/EntityCardFrame';
import { buildChokepoints, buildPorts } from '@/features/maritime/server/maritime';
import type { Selection } from '@/lib/layer-host';
import { ChokepointCard, ConflictZoneCard, PortCard } from './cards';
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
