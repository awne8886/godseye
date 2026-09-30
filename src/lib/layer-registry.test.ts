import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACTIVE_LAYERS,
  LAYERS,
  LAYER_GROUPS,
  getLayer,
  parseLayersParam,
  serializeLayersParam,
  visibleLayers,
} from './layer-registry';
import { CAPABILITIES } from './capabilities';
import { EntityKind } from './schemas';

const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');

describe('layer registry', () => {
  it('has unique ids and known groups', () => {
    const ids = LAYERS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(LAYER_GROUPS.map((g) => g.id));
    for (const l of LAYERS) expect(groups.has(l.group)).toBe(true);
  });

  it('keeps every OSIRIS rail id and label (docs/reference/27 §1)', () => {
    const expected: Record<string, string> = {
      sdk_sea: 'Maritime Lines', flights: 'Commercial', private: 'Private', jets: 'Private Jets', military: 'Military',
      maritime: 'Maritime / Naval', satellites: 'All Satellites', sat_comms: 'Starlink / Comms', sat_military: 'Military / Intel',
      sat_navigation: 'GPS / Navigation', sat_earth: 'Earth Observation', sat_science: 'Stations / Telescopes',
      cctv: 'CCTV Cameras', cctv_previews: 'Live Previews', live_news: 'Live News Feeds', earthquakes: 'Earthquakes',
      fires: 'Active Fires', weather: 'Severe Weather', infrastructure: 'Nuclear Facilities', global_incidents: 'Global Incidents',
      alert_pins: 'Live Alert Pins', gdelt_events: 'GDELT Events', malware: 'Live Malware', cyber_attacks: 'Botnet C2 Servers',
      cf_outages: 'Internet Outages', cf_attacks: 'Attack Origins', day_night: 'Day / Night Cycle', terrain_3d: '3D Buildings',
      terrain_elevation: '3D Terrain',
    };
    for (const [id, label] of Object.entries(expected)) expect(getLayer(id)?.label, id).toBe(label);
    expect(getLayer('terrain_3d')?.description).toBe('City detail · zoom 14.5+');
    expect(getLayer('terrain_elevation')?.description).toBe('Mountains · zoom 10+');
  });

  it('defaults ON exactly the §1 set (cables = sdk_sea)', () => {
    expect([...DEFAULT_ACTIVE_LAYERS].sort()).toEqual(
      ['cctv', 'cctv_previews', 'day_night', 'earthquakes', 'global_incidents', 'live_news', 'maritime', 'satellites', 'sdk_sea'].sort(),
    );
  });

  it('references real parents, capabilities, entity kinds and colour tokens', () => {
    const kinds = new Set(EntityKind.options);
    for (const l of LAYERS) {
      if ('parent' in l && l.parent) expect(getLayer(l.parent), `${l.id}.parent`).toBeDefined();
      if (l.capability) expect(CAPABILITIES, `${l.id}.capability`).toHaveProperty(l.capability);
      if (l.card) expect(kinds.has(l.card), `${l.id}.card`).toBe(true);
      expect(css, `${l.id} colour token ${l.colorToken}`).toContain(`${l.colorToken}:`);
      if (l.transport === 'poll') expect(l.refreshMs, `${l.id}.refreshMs`).toBeGreaterThan(0);
    }
  });

  it('marks static reference layers as reference, never live', () => {
    for (const id of ['infrastructure', 'conflict_zones', 'sdk_sea', 'country_risk']) expect(getLayer(id)?.kind).toBe('reference');
  });

  it('round-trips ?layers= preserving registry order and dropping unknown ids', () => {
    expect(parseLayersParam('fires,bogus,earthquakes,fires')).toEqual(['earthquakes', 'fires']);
    expect(parseLayersParam(null)).toBeNull();
    expect(parseLayersParam('')).toEqual([]);
    expect(serializeLayersParam(['fires', 'earthquakes'])).toBe('earthquakes,fires');
  });

  it('hides capability-gated layers until the capability is enabled', () => {
    const ids = (caps: Parameters<typeof visibleLayers>[0]) => visibleLayers(caps).map((l) => l.id);
    expect(ids({})).not.toContain('cf_attacks');
    expect(ids({ cloudflare: { enabled: true } })).toContain('cf_attacks');
    expect(ids({})).toContain('cf_outages'); // IODA is keyless
  });
});
