/**
 * Round 5 (R2 MAJOR-1 follow-up): an operator list answering `null`, a string, a number or the wrong
 * container is refused by the loader as `parse` (SOURCE OFFLINE, last good rows kept), never thrown
 * as a TypeError and never reported as "0 cameras". The required shapes are checked against the
 * recorded fixtures so a real list is never refused.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Http from '@/lib/http';
import type { Camera } from '@/lib/types';
import { FX, json } from './__fixtures__';

const state = vi.hoisted(() => ({ data: null as unknown, text: '' as string, urls: [] as string[] }));

vi.mock('@/lib/http', async (orig) => {
  const real = await orig<typeof Http>();
  return {
    ...real,
    httpJson: vi.fn(async (url: string) => {
      state.urls.push(url);
      return { status: 200, ok: true, headers: {}, url, data: state.data };
    }),
    httpText: vi.fn(async (url: string) => {
      state.urls.push(url);
      return { status: 200, ok: true, headers: {}, url, text: state.text };
    }),
  };
});

const { LOADERS, LIST_SHAPES, expectShape, jsonKind, parseJsonText } = await import('./loaders');
const { runRegion } = await import('./catalog');
const { PROVIDERS } = await import('./registry');
const { errorReason, HttpError } = await import('@/lib/http');

afterEach(() => {
  state.data = null;
  state.text = '';
  state.urls = [];
});

const signal = () => new AbortController().signal;
/** Loaders whose list is JSON (fetched with httpJson, or JSON text parsed by the loader). */
const JSON_TEXT = new Set(['odot', 'toronto']);
const TEXT = new Set(['wsdot', 'hktd', 'nzta']);
const JSON_LOADERS = Object.keys(LOADERS).filter((id) => !TEXT.has(id) && !JSON_TEXT.has(id));

describe('list body shapes', () => {
  it('the required shapes match the recorded upstream lists', () => {
    const fx: Partial<Record<keyof typeof LIST_SHAPES, unknown>> = {
      caltrans: json(FX.caltrans),
      odot: json(FX.odot),
      txdot: json(FX.txdot),
      mdot: json(FX.mdot),
      indot: json(FX.indot),
      ottawa: json(FX.ottawa),
      quebec: json(FX.quebec),
      toronto: json(FX.toronto),
      drivebc: json(FX.drivebc),
      tfl: json(FX.tfl),
      dgt: json(FX.dgt),
      rws: json(FX.rws),
      digitraffic: json(FX.digitraffic),
      vegagerdin: json(FX.vegagerdin),
      vialietuvaLayers: json(FX.vialietuvaVkr),
      vialietuvaInfo: json(FX.vialietuvaInfo),
      lta: json(FX.lta),
      thb: json(FX.thb),
      nsw: json(FX.nsw),
    };
    for (const [id, body] of Object.entries(fx)) expect(jsonKind(body), id).toBe(LIST_SHAPES[id as keyof typeof LIST_SHAPES]);
    expect(LIST_SHAPES.trafikverket).toBe('object'); // documented `{RESPONSE: {RESULT: [...]}}` (keyed; no keyless fixture)
  });

  it('expectShape / parseJsonText refuse with HttpError parse and never echo the body', () => {
    expect(() => expectShape(null, 'object', 'https://x.test/a')).toThrow(/Unexpected body: null, expected object/);
    expect(() => expectShape({ a: 1 }, 'array', 'https://x.test/a')).toThrow(/object, expected array/);
    expect(() => expectShape('secret-ish text', 'array', 'https://x.test/a')).toThrow(/^Unexpected body: string, expected array$/);
    expect(expectShape([1], 'array', 'https://x.test/a')).toEqual([1]);
    expect(() => parseJsonText('<html>', 'https://x.test/a')).toThrow(HttpError);
    let caught: unknown = null;
    try {
      parseJsonText('{', 'https://x.test/a');
    } catch (e) {
      caught = e;
    }
    expect(errorReason(caught)).toBe('parse');
  });

  it.each(JSON_LOADERS)('%s: null / string / number / boolean / wrong container → parse, not TypeError', async (id) => {
    const want = id === 'vialietuva' ? 'array' : LIST_SHAPES[id as keyof typeof LIST_SHAPES];
    for (const data of [null, 'null', 42, true, want === 'array' ? {} : []]) {
      state.data = data;
      const err = await LOADERS[id]!(signal()).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err, `${id} ← ${JSON.stringify(data)}`).toBeInstanceOf(HttpError);
      expect(errorReason(err), `${id} ← ${JSON.stringify(data)}`).toBe('parse');
    }
  });

  it.each([...JSON_TEXT])('%s (JSON served as text): garbage / null / wrong container → parse', async (id) => {
    for (const t of ['<html>busy</html>', 'null', '[]', '"x"']) {
      state.text = t;
      const err = await LOADERS[id]!(signal()).then(
        () => null,
        (e: unknown) => e,
      );
      expect(errorReason(err), `${id} ← ${t}`).toBe('parse');
    }
  });

  it.each([...TEXT])('%s (XML/KML): an empty or non-XML body yields no rows (the region reports it empty), no throw', async (id) => {
    for (const t of ['', 'null', '<html>busy</html>', '{"a":1}']) {
      state.text = t;
      await expect(LOADERS[id]!(signal()), `${id} ← ${t}`).resolves.toEqual([]);
    }
  });

  it('a region whose operators all answer `null` reports every provider failed and keeps the last good rows', async () => {
    const asia = PROVIDERS.filter((p) => p.region === 'asia');
    const previous = [{ id: 'hktd-H429F', providerId: 'hktd' } as Camera, { id: 'lta-2701', providerId: 'lta' } as Camera];
    state.data = null;
    state.text = 'null';
    const r = await runRegion(asia, previous, signal(), LOADERS, {});
    for (const d of asia) expect(r.providers[d.row.id]!.status.ok, d.row.id).toBe(false);
    expect(r.providers.lta!.status.error).toBe('parse');
    expect(r.providers.thb!.status.error).toBe('parse');
    expect(r.providers.hktd!.status.error).toBe('empty');
    expect(r.data.map((c) => c.id)).toEqual(['hktd-H429F', 'lta-2701']);
  });
});
