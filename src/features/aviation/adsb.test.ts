import { describe, expect, it } from 'vitest';
import point from './__fixtures__/adsblol-point.json';
import mil from './__fixtures__/adsblol-mil.json';
import ladd from './__fixtures__/adsblol-ladd.json';
import pia from './__fixtures__/adsblol-pia.json';
import { cleanCallsign, mergeRecords, normalizeAdsbResponse, normalizeAdsbRow, posSourceOf, type AdsbResponse, type FlightRecord } from './adsb';

// Fixtures: live adsb.lol probes captured 2026-09-30T18:07Z (see `_captured` in each file).
const NOW = 1_790_791_610_751;

describe('adsb.lol row normalisation', () => {
  it('trims and upper-cases the space-padded callsign', () => {
    expect(cleanCallsign('RYR19WT ')).toBe('RYR19WT');
    expect(cleanCallsign(' baw117  ')).toBe('BAW117');
    expect(cleanCallsign('        ')).toBeNull();
    expect(cleanCallsign('@@@@@@@@')).toBeNull();
    expect(cleanCallsign(undefined)).toBeNull();
  });

  it('normalises a recorded point row', () => {
    const r = normalizeAdsbRow((point as AdsbResponse).ac![0]!, (point as AdsbResponse).now!, 'adsblol_tiles');
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.record).toMatchObject({ id: '4cafc4', callsign: 'RYR19WT', registration: 'EI-GXI', typeCode: 'B738', bucket: 'commercial', onGround: false, altFt: 19525, squawk: '1045', emergency: null, category: 'A3', posSource: 'adsb' });
    expect(r.record.seenAt).toBe(Math.round((point as AdsbResponse).now! / 1000));
    expect(r.record.lat).toBe(52.83451);
  });

  it('maps alt_baro "ground" to onGround with a null altitude', () => {
    const r = normalizeAdsbRow({ hex: 'ABCDEF', alt_baro: 'ground', lat: 1, lon: 2, gs: 12, seen_pos: 3 }, NOW, 'x');
    expect(r.kind === 'ok' && r.record).toMatchObject({ id: 'abcdef', onGround: true, altFt: null, gsKt: 12, seenAt: Math.round((NOW - 3000) / 1000) });
  });

  it('flags only 7500/7600/7700 as emergencies; emergency "none" is not one', () => {
    for (const [sq, em] of [['7700', '7700'], ['7600', '7600'], ['7500', '7500'], ['7000', null], ['1234', null], ['8888', null]] as const) {
      const r = normalizeAdsbRow({ hex: 'abcdef', squawk: sq, emergency: 'none', lat: 1, lon: 1 }, NOW, 'x');
      expect(r.kind === 'ok' && r.record.emergency, sq).toBe(em);
      if (sq === '8888') expect(r.kind === 'ok' && r.record.squawk).toBeNull(); // not octal
    }
  });

  it('keeps dbFlags and classifies military from them', () => {
    const r = normalizeAdsbRow({ hex: '480c42', flight: 'MMF85   ', t: 'A332', dbFlags: 1, alt_baro: 'ground', lat: 21.3, lon: -157.9 }, NOW, 'adsblol_mil');
    expect(r.kind === 'ok' && r.record).toMatchObject({ bucket: 'military', dbFlags: 1, callsign: 'MMF85' });
  });

  it('skips towers and malformed hex, and counts rows without a position', () => {
    expect(normalizeAdsbRow({ hex: 'abcdef', t: 'TWR', lat: 1, lon: 1 }, NOW, 'x').kind).toBe('skip');
    expect(normalizeAdsbRow({ hex: 'xyz', lat: 1, lon: 1 }, NOW, 'x').kind).toBe('skip');
    expect(normalizeAdsbRow({ hex: 'abcdef' }, NOW, 'x')).toEqual({ kind: 'no-position', id: 'abcdef' });
    expect(normalizeAdsbRow({ hex: '~abcdef', lat: 1, lon: 1 }, NOW, 'x').kind).toBe('ok'); // TIS-B non-ICAO
  });

  it('reads the position source from readsb `type`', () => {
    expect(posSourceOf({ type: 'adsb_icao' })).toBe('adsb');
    expect(posSourceOf({ type: 'mlat' })).toBe('mlat');
    expect(posSourceOf({ type: 'tisb_trackfile' })).toBe('tisb');
    expect(posSourceOf({ type: 'adsr_icao' })).toBe('adsr');
    expect(posSourceOf({ type: 'mode_s' })).toBe('other');
    expect(posSourceOf({})).toBeNull();
  });

  it('counts /v2/mil and /v2/ladd rows without lat/lon as noPosition', () => {
    const m = normalizeAdsbResponse(mil as AdsbResponse, 'adsblol_mil', 0);
    const l = normalizeAdsbResponse(ladd as AdsbResponse, 'adsblol_ladd', 0);
    expect(m.records).toHaveLength(25);
    expect(m.noPosition).toHaveLength(8);
    expect(l.noPosition).toHaveLength(5);
    expect(m.records.every((r) => r.dbFlags! & 1)).toBe(true);
    expect(m.records.every((r) => r.bucket === 'military')).toBe(true);
  });
});

describe('merge / dedupe of point + mil + ladd + pia', () => {
  const rec = (p: Partial<FlightRecord>): FlightRecord => ({
    id: 'abcdef', callsign: 'TEST1', registration: null, typeCode: 'B738', bucket: 'commercial', isHelicopter: false, onGround: false,
    lat: 1, lng: 1, altFt: 30000, altGeomFt: null, gsKt: 400, trackDeg: 90, vrFpm: 0, squawk: null, emergency: null, category: 'A3',
    nacP: 9, dbFlags: 0, seenAt: 100, source: 'adsblol_tiles', posSource: 'adsb', ...p,
  });

  it('keeps the newest position per hex', () => {
    const m = mergeRecords([[rec({ seenAt: 100, lat: 1 })], [rec({ seenAt: 105, lat: 2, source: 'adsblol_ladd' })]]);
    expect(m.size).toBe(1);
    expect(m.get('abcdef')).toMatchObject({ lat: 2, source: 'adsblol_ladd' });
  });

  it('prefers the earlier list on a tie', () => {
    const m = mergeRecords([[rec({ source: 'adsblol_mil' })], [rec({ source: 'adsblol_tiles' })]]);
    expect(m.get('abcdef')!.source).toBe('adsblol_mil');
  });

  it('ORs dbFlags so /v2/mil membership survives a newer tile position, and re-classifies', () => {
    const m = mergeRecords([[rec({ dbFlags: 1, seenAt: 100, bucket: 'military', source: 'adsblol_mil' })], [rec({ dbFlags: 0, seenAt: 110 })]]);
    expect(m.get('abcdef')).toMatchObject({ dbFlags: 1, bucket: 'military', seenAt: 110, source: 'adsblol_tiles' });
  });

  it('merges the recorded fixtures without duplicates', () => {
    const lists = [mil, ladd, pia, point].map((f, i) => normalizeAdsbResponse(f as AdsbResponse, ['m', 'l', 'p', 't'][i]!, 0).records);
    const total = lists.reduce((n, l) => n + l.length, 0);
    const merged = mergeRecords(lists);
    const ids = new Set(lists.flat().map((r) => r.id));
    expect(merged.size).toBe(ids.size);
    expect(merged.size).toBeLessThanOrEqual(total);
  });
});
