import { describe, expect, it } from 'vitest';
import { PROVIDERS } from '@/features/surveillance/server/registry';
import { CAPABILITIES } from './capabilities';
import { LAYERS } from './layer-registry';
import { LAYER_SOURCE_IDS, SOURCE_GROUPS, SOURCES, sourcesByGroup, sourcesForLayer } from './sources';

describe('LAYER_SOURCE_IDS', () => {
  it('maps every registry layer to at least one known registry source', () => {
    for (const l of LAYERS) {
      const ids = LAYER_SOURCE_IDS[l.id];
      expect(ids?.length, l.id).toBeGreaterThan(0);
      expect(sourcesForLayer(l.id).length, l.id).toBe(ids!.length);
    }
  });
});

describe('SOURCES registry', () => {
  it('every entry has a name, use, licence and an http(s) terms URL', () => {
    for (const s of SOURCES) {
      expect(s.name.trim(), s.id).not.toBe('');
      expect(s.usedFor.trim(), s.id).not.toBe('');
      expect(s.licence.trim(), s.id).not.toBe('');
      expect(s.url, s.id).toMatch(/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/|$)/);
    }
  });

  it('ids are unique and every group is declared', () => {
    expect(new Set(SOURCES.map((s) => s.id)).size).toBe(SOURCES.length);
    const groups = new Set(SOURCE_GROUPS.map((g) => g.id));
    for (const s of SOURCES) expect(groups.has(s.group), s.id).toBe(true);
    expect(sourcesByGroup().reduce((n, g) => n + g.entries.length, 0)).toBe(SOURCES.length);
  });

  it('gates name real capabilities', () => {
    for (const s of SOURCES) if (s.gate?.capability) expect(Object.keys(CAPABILITIES), s.id).toContain(s.gate.capability);
  });

  it('lists every camera operator in the provider registry', () => {
    const cams = SOURCES.filter((s) => s.id.startsWith('cam:')).map((s) => s.id.slice(4));
    expect(cams.sort()).toEqual(PROVIDERS.map((p) => p.row.id).sort());
    for (const p of PROVIDERS) {
      const s = SOURCES.find((x) => x.id === `cam:${p.row.id}`)!;
      if (p.capability) expect(s.gate?.capability, p.row.id).toBe(p.capability);
    }
  });

  it('covers the licence-summary, flight-path, geocoding, knowledge, tile and AI sources the panel must show', () => {
    const ids = new Set(SOURCES.map((s) => s.id));
    for (const id of [
      'osm', 'openfreemap', 'openmaptiles', 'esri-imagery', 'nasa-gibs', 'aws-terrain', 'adsblol', 'opensky', 'adsbfi', 'vrs', 'ourairports',
      'openflights', 'aviationweather', 'fpdb', 'celestrak', 'satnogs', 'open-meteo', 'usgs', 'gpsjam', 'gdelt', 'deepstate', 'abusech',
      'ip-api', 'internetdb', 'opensanctions', 'cloudflare-radar', 'telegeography', 'natural-earth', 'wikidata', 'rainviewer', 'telegram',
      'cam:tfl', 'photon', 'nominatim', 'valhalla', 'osrm', 'wikipedia', 'anthropic', 'gemini', 'ollama',
    ])
      expect(ids.has(id), id).toBe(true);
  });
});
