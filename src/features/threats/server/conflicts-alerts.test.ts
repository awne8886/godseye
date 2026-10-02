/**
 * Live Alert pins counted in conflict zones (TODO L121). Fixture: 18 real AlertItems produced by
 * runNews() against the live Telegram previews and wire RSS on 2026-10-02 (trimmed, fields as
 * served). The zone polygons are the bundled REFERENCE file.
 */
import { describe, expect, it } from 'vitest';
import { AlertItem, ConflictEvent } from '@/lib/schemas';
import type { AlertItem as AlertItemT } from '@/lib/types';
import { fixture, FX } from './__fixtures__';
import { NEWS_ATTRIBUTION } from '@/components/panels/intel/feeds';
import { alertsToConflictEvents, buildConflicts, conflictsFeed, loadZones, type toConflictEvent, zoneFor } from './conflicts';
import { parseExport } from './gdelt';
import { unzipFirst } from './zip';

const recorded = JSON.parse(fixture(FX.news).toString('utf8')) as { _meta: { capturedAt: string }; items: AlertItemT[] };
const items = recorded.items;
const NOW = Date.parse(recorded._meta.capturedAt);
const zones = loadZones();
const byId = (id: string) => items.find((i) => i.id === id)!;

describe('alertsToConflictEvents', () => {
  it('the recorded items are valid AlertItems', () => {
    for (const it of items) expect(AlertItem.safeParse(it).success).toBe(true);
  });

  it('keeps in-zone settlement/region pins at their own coordinates and drops the rest', () => {
    const out = alertsToConflictEvents(items, zones, undefined, NOW);
    for (const e of out) expect(ConflictEvent.safeParse(e).success).toBe(true);
    const ids = new Map(out.map((e) => [e.id, e]));
    // In zones: Kyiv/Odesa (Ukraine), Gaza City/Gaza Strip (Gaza), Khartoum (Sudan).
    expect(ids.get('alert:tg:KyivIndependent_official/55853')?.zoneId).toBe('ukraine');
    expect(ids.get('alert:tg:rybar_in_english/34727')?.zoneId).toBe('ukraine');
    expect(ids.get('alert:tg:QudsNen/240725')?.zoneId).toBe('gaza');
    expect(ids.get('alert:rss:aljazeera:L-moGsMf2_LwGTxK')?.zoneId).toBe('gaza');
    // Aden (45.02 E, 12.79 N) is on the coast just outside the bundled Yemen outline: not counted, not moved.
    expect(ids.has('alert:tg:presstv/209139')).toBe(false);
    // Khartoum is inside the Sudan zone, but the Africanews item is kind=news (a hospitalisation
    // headline), not a conflict event: dropped (r6 MAJOR, alerts counted whatever their kind).
    expect(byId('rss:africanews:QBejmXJnYGgMy5_U').kind).toBe('news');
    expect(zoneFor(zones, byId('rss:africanews:QBejmXJnYGgMy5_U').place!.lng, byId('rss:africanews:QBejmXJnYGgMy5_U').place!.lat)).toBe('sudan');
    expect(ids.has('alert:rss:africanews:QBejmXJnYGgMy5_U')).toBe(false);
    // Outside every zone: St Petersburg, Paris, Hong Kong, Tehran.
    for (const id of ['rss:tass:a7ccgzHAYw8SWEO9', 'rss:france24:nt7lXUeC52jF12qF', 'rss:scmp:XIZ7_b_0SIOvbc29', 'tg:presstv/209140']) expect(ids.has(`alert:${id}`)).toBe(false);
    // Country-level pins are centroids, even when the centroid lies inside a zone (Ukraine, Lebanon, Yemen).
    const countryPins = items.filter((i) => i.place?.precision === 'country');
    expect(countryPins.length).toBe(3);
    for (const c of countryPins) expect(ids.has(`alert:${c.id}`)).toBe(false);
    // No place → never drawn.
    for (const n of items.filter((i) => i.place === null)) expect(ids.has(`alert:${n.id}`)).toBe(false);
    // Own coordinates, own time, own link, precision kept, source 'alerts'.
    for (const e of out) {
      const src = byId(e.id.slice('alert:'.length));
      expect([e.lng, e.lat]).toEqual([src.place!.lng, src.place!.lat]);
      expect(e.observedAt).toBe(new Date(Date.parse(src.publishedAt)).toISOString());
      expect(e.url).toBe(src.link);
      expect(e.precision).toBe(src.place!.precision);
      expect(e.source).toBe('alerts');
      expect(['settlement', 'region']).toContain(e.precision);
    }
  });

  it('counts only rocket/event alerts: a kind=news headline inside a zone is never a conflict event', () => {
    const out = alertsToConflictEvents(items, zones, undefined, NOW);
    for (const e of out) expect(['rocket', 'event']).toContain(byId(e.id.slice('alert:'.length)).kind);
    // Every in-zone, settlement/region, kind=news item in the recording is dropped...
    const newsInZone = items.filter((i) => i.kind === 'news' && i.place && i.place.precision !== 'country' && zoneFor(zones, i.place.lng, i.place.lat));
    expect(newsInZone.length).toBeGreaterThan(0);
    for (const n of newsInZone) expect(out.some((e) => e.id === `alert:${n.id}`)).toBe(false);
    // ...and the same post reclassified as an event would count (only the kind differs).
    const n = newsInZone[0]!;
    expect(alertsToConflictEvents([{ ...n, kind: 'event' }], zones, undefined, NOW).map((e) => e.id)).toEqual([`alert:${n.id}`]);
    expect(alertsToConflictEvents([{ ...n, kind: 'rocket' }], zones, undefined, NOW)).toHaveLength(1);
  });

  it('keeps who made the claim: source handle, channel name, stance and bloc from the AlertItem', () => {
    const out = alertsToConflictEvents(items, zones, undefined, NOW);
    expect(out.length).toBeGreaterThan(0);
    for (const e of out) {
      const src = byId(e.id.slice('alert:'.length));
      expect(e).toMatchObject({ sourceHandle: src.source, sourceName: src.sourceName, lean: src.lean, bloc: src.bloc, alertKind: src.kind });
    }
    expect(out.find((e) => e.id === 'alert:tg:rybar_in_english/34727')).toMatchObject({ sourceHandle: 't.me/rybar_in_english', sourceName: 'Rybar', lean: 'Russian military OSINT', bloc: 'russian' });
  });

  it('caps a future publish time at now, drops items older than 24 h and bounds the title', () => {
    const kyiv = byId('tg:KyivIndependent_official/55853');
    const future = { ...kyiv, id: 'future', publishedAt: new Date(NOW + 10 * 60_000).toISOString(), title: 'x'.repeat(400) };
    const old = { ...kyiv, id: 'old', publishedAt: new Date(NOW - 25 * 3600_000).toISOString() };
    const bad = { ...kyiv, id: 'bad', publishedAt: 'not a date' };
    const out = alertsToConflictEvents([future, old, bad], zones, undefined, NOW);
    expect(out.map((e) => e.id)).toEqual(['alert:future']);
    expect(out[0]!.observedAt).toBe(new Date(NOW).toISOString());
    expect(out[0]!.title).toHaveLength(240);
  });
});

describe('buildConflicts with alerts', () => {
  it('counts GDELT rows and alert pins together per zone, and ages alerts out after 24 h', () => {
    // The GDELT batch was recorded a day earlier: re-stamp it an hour before the news capture so both
    // sit inside the same rolling window (coordinates and classes unchanged).
    const gdelt = parseExport(unzipFirst(fixture(FX.gdeltZip)).data.toString('utf8')).events.map((e) => ({ ...e, dateAdded: new Date(NOW - 3600_000).toISOString() }));
    const gdeltOnly = buildConflicts(zones, new Map(), gdelt, NOW);
    const buffer = new Map<string, ReturnType<typeof toConflictEvent>>();
    const both = buildConflicts(zones, buffer, gdelt, NOW, items);
    const alertEvents = both.events.filter((e) => e.source === 'alerts');
    expect(alertEvents.length).toBe(alertsToConflictEvents(items, zones, undefined, NOW).length);
    for (const z of both.zones) {
      const fromAlerts = alertEvents.filter((e) => e.zoneId === z.id).length;
      expect(z.liveEventCount).toBe(gdeltOnly.zones.find((g) => g.id === z.id)!.liveEventCount + fromAlerts);
    }
    expect(gdeltOnly.events.length).toBeGreaterThan(0);
    // Kyiv Independent + Rybar. The TASS item is classed kind=news by the alert classifier, so it no longer counts.
    expect(alertEvents.filter((e) => e.zoneId === 'ukraine').map((e) => e.id).sort()).toEqual(['alert:tg:KyivIndependent_official/55853', 'alert:tg:rybar_in_english/34727']);
    expect(both.events.some((e) => e.id === 'alert:rss:tass:o7SYHDuDP-glqW3f')).toBe(false);
    // Re-reading the same news snapshot does not double count (keyed alert:<id>).
    const again = buildConflicts(zones, buffer, [], NOW, items);
    expect(again.events.filter((e) => e.source === 'alerts').length).toBe(alertEvents.length);
    const later = buildConflicts(zones, buffer, [], NOW + 25 * 3600_000);
    expect(later.events).toHaveLength(0);
  });
});

describe('conflictsFeed attribution', () => {
  it('credits the Telegram channels and wire publishers that Live Alert pins come from', () => {
    const texts = conflictsFeed.def.attribution.map((a) => a.text);
    for (const a of NEWS_ATTRIBUTION) expect(texts).toContain(a.text);
    expect(texts.some((t) => t.includes('GDELT'))).toBe(true);
    expect(texts.some((t) => t.includes('Natural Earth'))).toBe(true);
  });
});
