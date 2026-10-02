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
import { alertKind } from '@/components/panels/intel/server/classify';
import { alertsToConflictEvents, buildConflicts, conflictsFeed, isKineticAlertText, loadZones, type toConflictEvent, zoneFor } from './conflicts';
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
    // ...and the same post with kinetic text and a rocket/event kind would count (same pin and time).
    const n = newsInZone[0]!;
    const kinetic = { ...n, title: 'Drone strike reported on the outskirts', summary: null };
    expect(alertsToConflictEvents([{ ...kinetic, kind: 'event' }], zones, undefined, NOW).map((e) => e.id)).toEqual([`alert:${n.id}`]);
    expect(alertsToConflictEvents([{ ...kinetic, kind: 'rocket' }], zones, undefined, NOW)).toHaveLength(1);
    expect(alertsToConflictEvents([{ ...kinetic, kind: 'news' }], zones, undefined, NOW)).toHaveLength(0);
  });

  // Phase 3 round 8 MINOR: the classifier's kind=event also matches 'earthquake' and 'fire', so a
  // quake or market-fire post pinned to a settlement inside a zone was counted as a conflict event.
  it('an earthquake or fire post inside a zone is not a conflict event, even though it is kind=event', () => {
    // A recorded settlement-pinned post, moved to Aleppo (Syria zone) and Baghdad (Iraq zone).
    const base = byId('tg:QudsNen/240725');
    const aleppo = { name: 'Aleppo', lat: 36.2021, lng: 37.1343, precision: 'settlement' as const, method: 'gazetteer' };
    const baghdad = { name: 'Baghdad', lat: 33.3152, lng: 44.3661, precision: 'settlement' as const, method: 'gazetteer' };
    expect(zoneFor(zones, aleppo.lng, aleppo.lat)).toBe('syria');
    expect(zoneFor(zones, baghdad.lng, baghdad.lat)).toBe('iraq');
    const post = (id: string, title: string, place: typeof aleppo, summary: string | null = null): AlertItemT => ({ ...base, id, title, summary, place, kind: alertKind(`${title}\n${summary ?? ''}`) });
    const hazards = [
      post('quake', 'Earthquake felt in Aleppo', aleppo),
      post('quake-dead', 'Earthquake in Aleppo: 3 killed as buildings shake', aleppo),
      post('fire', 'Fire at Baghdad market', baghdad),
      post('fire-dead', 'Fire at Baghdad market, 5 killed', baghdad),
      post('hunger', 'Prisoners begin hunger strike in Baghdad', baghdad),
    ];
    // The alert classifier calls every one of these an event: the filter must not rely on the kind.
    for (const h of hazards) expect(h.kind).toBe('event');
    expect(alertsToConflictEvents(hazards, zones, undefined, NOW)).toEqual([]);
    // Kinetic posts at the same pins still count, at their own coordinates.
    const kinetic = [
      post('strike', 'Airstrike hits the outskirts of Aleppo', aleppo, 'Several buildings were hit in a drone strike.'),
      post('blast', 'Blast at Baghdad market, 5 killed', baghdad),
      post('quake-raid', 'Rocket attack on Aleppo hours after the earthquake', aleppo),
    ];
    const out = alertsToConflictEvents(kinetic, zones, undefined, NOW);
    expect(out.map((e) => [e.id, e.zoneId, e.lng, e.lat])).toEqual([
      ['alert:strike', 'syria', aleppo.lng, aleppo.lat],
      ['alert:blast', 'iraq', baghdad.lng, baghdad.lat],
      ['alert:quake-raid', 'syria', aleppo.lng, aleppo.lat],
    ]);
  });

  it('isKineticAlertText: weapon language counts, casualty/blast language only without a hazard, idioms never', () => {
    for (const t of ['Israeli occupation aircraft launch a strike near Gaza City', 'Russian drones hit a bridge', 'Clashes in Khartoum', 'Gunmen opened fire on a checkpoint', 'Police raid in Mosul', 'Sirens in Sderot']) expect(isKineticAlertText(t), t).toBe(true);
    for (const t of ['Earthquake felt in Aleppo', 'Fire at Baghdad market, 5 killed', 'Gas explosion in a Baghdad restaurant', 'Sirens sound after earthquake in Haifa', 'Teachers on strike in Sanaa', 'Minister suffers heart attack', 'Carrier strike group enters the Red Sea', 'Bashir hospitalized in Khartoum']) expect(isKineticAlertText(t), t).toBe(false);
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
