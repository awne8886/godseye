/**
 * Round 5 (R2 MAJOR-1 follow-up): no provider parser may throw on a hostile body. Every adapter is
 * fed (1) top-level `null`, arrays, strings, numbers and booleans, and (2) its own recorded fixture
 * with every field replaced, one at a time, by a value of the wrong type. It must return an array
 * of schema-valid cameras every time — never a TypeError (which would end as a 500 or a provider
 * reported as `error` instead of `parse`). Deterministic (no randomness): every path is tried.
 */
import { describe, expect, it } from 'vitest';
import { Camera } from '@/lib/schemas/surveillance';
import type { Camera as CameraRow } from '@/lib/types';
import * as A from './adapters';
import { FX, json, text } from './__fixtures__';

type Parser = (raw: unknown) => CameraRow[];

const VL_AT = Date.parse('2026-10-01T02:10:00Z');
/** Trafikverket's documented Camera shape (keyed API; no keyless fixture exists), as in adapters.test.ts. */
const TRAFIKVERKET = {
  RESPONSE: {
    RESULT: [
      {
        Camera: [
          {
            Id: 'SE_STA_CAMERA_Orion_39636115',
            Name: 'E4 Hallunda',
            Active: true,
            Geometry: { WGS84: 'POINT (17.82 59.24)' },
            PhotoUrl: 'https://api.trafikinfo.trafikverket.se/v2/Images/data/road.infrastructure.camera/TrafficFlowCamera_39636115.jpg',
            PhotoTime: '2026-09-30T22:02:05.000+02:00',
            HasFullSizePhoto: true,
            Direction: 180,
          },
        ],
      },
    ],
  },
};

const JSON_PARSERS: [string, Parser, () => unknown][] = [
  ['caltrans', (r) => A.parseCaltrans(r, 7), () => json(FX.caltrans)],
  ['odot', A.parseOdot, () => json(FX.odot)],
  ['txdot', (r) => A.parseTxdot(r, 'AUS'), () => json(FX.txdot)],
  ['mdot', A.parseMdot, () => json(FX.mdot)],
  ['indot', A.parseIndot, () => json(FX.indot)],
  ['ottawa', A.parseOttawa, () => json(FX.ottawa)],
  ['quebec', A.parseQuebec, () => json(FX.quebec)],
  ['toronto', A.parseToronto, () => json(FX.toronto)],
  ['drivebc', A.parseDriveBc, () => json(FX.drivebc)],
  ['tfl', A.parseTfl, () => json(FX.tfl)],
  ['dgt', A.parseDgt, () => json(FX.dgt)],
  ['rws', A.parseRws, () => json(FX.rws)],
  ['digitraffic', A.parseDigitraffic, () => json(FX.digitraffic)],
  ['vegagerdin', A.parseVegagerdin, () => json(FX.vegagerdin)],
  ['trafikverket', A.parseTrafikverket, () => structuredClone(TRAFIKVERKET)],
  ['lta', A.parseLta, () => json(FX.lta)],
  ['thb', A.parseThb, () => json(FX.thb)],
  ['nsw', A.parseLiveTrafficNsw, () => json(FX.nsw)],
  ['nsw-livecams', A.parseLiveTrafficNsw, () => json(FX.nswLiveCams)],
  ['vialietuva-layers', (r) => A.parseViaLietuva(r, json(FX.vialietuvaInfo), VL_AT), () => json(FX.vialietuvaVkr)],
  ['edmonton', A.parseEdmonton, () => json(FX.edmonton)],
  ['mlit', A.parseMlit, () => json(FX.mlit)],
  ['vialietuva-info', (r) => A.parseViaLietuva(json(FX.vialietuvaVkr), r, VL_AT), () => json(FX.vialietuvaInfo)],
];

const TEXT_PARSERS: [string, Parser, () => string][] = [
  ['wsdot', A.parseWsdotKml, () => text(FX.wsdot)],
  ['hktd', A.parseHongKong, () => text(FX.hktd)],
  ['nzta', A.parseNzta, () => text(FX.nzta)],
];

/** Top-level bodies an upstream (or a broken proxy in front of it) can answer with. */
const HOSTILE_BODIES: unknown[] = [null, undefined, 0, 42, -1.5, true, false, '', 'null', '<html><body>Service Unavailable</body></html>', [], [null], [0, 'x', true, [], null], {}, { data: null }, { features: 'x' }, { features: [null, 1, 'x'] }, { items: 'x' }];

/** Wrong-typed replacements for one field at a time. */
const WRONG: unknown[] = [null, 'x', 7, true, [], [null], {}];

/** Every path into a JSON value (the first 3 elements of each array: the records share a shape). */
function paths(v: unknown, at: (string | number)[] = [], out: (string | number)[][] = []): (string | number)[][] {
  if (Array.isArray(v)) {
    v.slice(0, 3).forEach((x, i) => {
      out.push([...at, i]);
      paths(x, [...at, i], out);
    });
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.push([...at, k]);
      paths(x, [...at, k], out);
    }
  }
  return out;
}

function withValue(root: unknown, path: (string | number)[], value: unknown): unknown {
  const copy = structuredClone(root) as Record<string | number, unknown>;
  let node = copy;
  for (const k of path.slice(0, -1)) node = node[k] as Record<string | number, unknown>;
  node[path.at(-1)!] = value;
  return copy;
}

function expectRows(rows: unknown, label: string): void {
  expect(Array.isArray(rows), label).toBe(true);
  for (const r of rows as unknown[]) {
    const ok = Camera.safeParse(r);
    expect(ok.success, `${label}: ${ok.success ? '' : JSON.stringify(ok.error.issues[0])}`).toBe(true);
  }
}

describe('camera adapters never throw on hostile bodies', () => {
  it.each([...JSON_PARSERS, ...TEXT_PARSERS].map(([name, parse]) => [name, parse] as const))('%s: null / array / string / number / boolean bodies → [] (no TypeError)', (name, parse) => {
    for (const body of HOSTILE_BODIES) {
      let rows: CameraRow[] = [];
      expect(() => (rows = parse(body)), `${name} ← ${JSON.stringify(body)}`).not.toThrow();
      expect(rows, `${name} ← ${JSON.stringify(body)}`).toEqual([]);
    }
  });

  it.each(JSON_PARSERS)('%s: every field of the recorded fixture replaced by a wrong-typed value → valid rows only', (name, parse, fixture) => {
    const base = fixture();
    expect(parse(base).length, `${name} fixture parses`).toBeGreaterThan(0);
    const all = paths(base);
    expect(all.length).toBeGreaterThan(3);
    for (const p of all) {
      for (const w of WRONG) {
        const label = `${name} ${p.join('.')} = ${JSON.stringify(w)}`;
        let rows: unknown;
        expect(() => (rows = parse(withValue(base, p, w))), label).not.toThrow();
        expectRows(rows, label);
      }
    }
  });

  it.each(TEXT_PARSERS)('%s: truncated or tag-mangled documents → valid rows only', (name, parse, fixture) => {
    const doc = fixture();
    for (let n = 0; n <= doc.length; n += 37) {
      const label = `${name} cut at ${n}`;
      let rows: unknown;
      expect(() => (rows = parse(doc.slice(0, n))), label).not.toThrow();
      expectRows(rows, label);
    }
    expectRows(parse(doc.replace(/<\/(\w+)>/g, '<$1>')), `${name} mangled`);
  });
});
