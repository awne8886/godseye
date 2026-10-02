/**
 * Worker message protocol: the worker fetches + parses the catalogue itself, posts a small summary
 * plus a packed catalogue whose typed arrays are listed for transfer (no rows cross the boundary),
 * and propagates frames from it. Fixtures: recorded CelesTrak OMM (no network).
 */
import { describe, expect, it } from 'vitest';
import { fx } from '../__fixtures__';
import { MISSIONS, countByCategory, ommToRecord, recordToRow } from './catalog';
import { packedRecord } from './packed';
import { createPropagator, type FetchLike, type WorkerOut } from './propagator';
import { SAT_CATEGORIES } from './catalog';

const rows = fx.active.map((o) => ommToRecord(o as never)).filter((r) => r !== null).map(recordToRow);
const meta = {
  feed: 'satellites',
  kind: 'live' as const,
  state: 'live' as const,
  fetchedAt: '2026-09-30T18:05:00Z',
  observedAt: '2026-09-30T17:00:00Z',
  lastGoodAt: '2026-09-30T18:05:00Z',
  stale: false,
  ttlSeconds: 7200,
  attribution: [],
};
const body = { fields: [], rows, missions: MISSIONS, categoryCounts: countByCategory(rows), catalogueSource: 'celestrak', meta, providers: { celestrak: { ok: true, count: rows.length, ms: 10, age_s: 0 } } };

function harness(respond: () => Awaited<ReturnType<FetchLike>>) {
  const sent: { msg: WorkerOut; transfer: Transferable[] }[] = [];
  const urls: string[] = [];
  const p = createPropagator(
    (msg, transfer) => sent.push({ msg, transfer: transfer ?? [] }),
    async (url) => {
      urls.push(url);
      return respond();
    },
  );
  return { p, sent, urls };
}

const ok = () => ({ ok: true, status: 200, json: async () => structuredClone(body) });

describe('tle-propagate worker protocol', () => {
  it('fetches and parses in the worker, posts a summary + packed typed arrays for transfer (no rows)', async () => {
    const { p, sent, urls } = harness(ok);
    await p.handle({ type: 'load', url: 'http://127.0.0.1/api/satellites' });
    expect(urls).toEqual(['http://127.0.0.1/api/satellites']);
    expect(sent).toHaveLength(1);
    const { msg, transfer } = sent[0]!;
    if (msg.type !== 'catalogue' || !msg.packed) throw new Error('expected a packed catalogue');
    expect('rows' in msg).toBe(false);
    expect('rows' in msg.summary).toBe(false);
    expect(msg.summary.total).toBe(rows.length);
    expect(msg.summary.meta.fetchedAt).toBe(meta.fetchedAt);
    const pk = msg.packed;
    expect(pk.count).toBe(rows.length);
    // Every typed array is in the transfer list (zero-copy); only the one text string is cloned.
    for (const a of [pk.noradIds, pk.categories, pk.missionIndex, pk.elements, pk.textOffsets]) expect(transfer).toContain(a.buffer);
    // The packed rows round-trip to the card fields exactly.
    const i = pk.noradIds.indexOf(25544);
    expect(i).toBeGreaterThanOrEqual(0);
    const rec = packedRecord(pk, i)!;
    const src = ommToRecord(fx.active.find((o) => o.NORAD_CAT_ID === 25544) as never)!;
    expect(rec).toEqual({
      noradId: 25544,
      name: src.name,
      objectId: src.objectId,
      epoch: src.epoch,
      meanMotion: src.meanMotion,
      eccentricity: src.eccentricity,
      inclination: src.inclination,
      category: src.category,
      missionIndex: src.missionIndex,
    });
    expect(SAT_CATEGORIES[pk.categories[i]!]).toBe(src.category);
  });

  it('propagates frames from the worker-held catalogue and transfers the frame buffers', async () => {
    const { p, sent } = harness(ok);
    await p.handle({ type: 'load', url: '/api/satellites' });
    p.handle({ type: 'view', camera: null, visible: [0, 1, 2, 3, 4, 5], palette: SAT_CATEGORIES.map(() => [255, 255, 255, 255]), selectedId: 25544 });
    p.handle({ type: 'tick', at: Date.parse('2026-09-30T18:05:00Z') });
    const { msg, transfer } = sent.at(-1)!;
    if (msg.type !== 'frame') throw new Error('expected a frame');
    expect(msg.count).toBeGreaterThan(0);
    expect(msg.selected?.noradId).toBe(25544);
    expect(transfer).toEqual([msg.positions.buffer, msg.colors.buffer, msg.sizes.buffer, msg.index.buffer, msg.categoryOffsets.buffer]);
  });

  it('a camera move re-filters the newest propagation at once (same `at`, no tick needed)', async () => {
    const { p, sent } = harness(ok);
    await p.handle({ type: 'load', url: '/api/satellites' });
    const palette = SAT_CATEGORIES.map(() => [255, 255, 255, 255] as [number, number, number, number]);
    // Before the first tick there is nothing to re-filter: no frame.
    p.handle({ type: 'camera', camera: { lng: 0, lat: 0, altitude: 7_000_000 } });
    expect(sent.filter((s) => s.msg.type === 'frame')).toHaveLength(0);
    p.handle({ type: 'view', camera: null, visible: [0, 1, 2, 3, 4, 5], palette, selectedId: null });
    const at = Date.parse('2026-09-30T18:05:00Z');
    p.handle({ type: 'tick', at });
    const flat = sent.at(-1)!.msg;
    if (flat.type !== 'frame') throw new Error('expected a frame');
    expect(flat.camera).toBeNull();
    // The globe turns: the worker posts a re-filtered frame for the same propagation.
    const camera = { lng: -98, lat: 39, altitude: 5_700_000 };
    p.handle({ type: 'camera', camera });
    const { msg, transfer } = sent.at(-1)!;
    if (msg.type !== 'frame') throw new Error('expected a re-filtered frame');
    expect(msg.at).toBe(at);
    expect(msg.camera).toEqual(camera);
    expect(msg.count).toBeLessThan(flat.count);
    expect(msg.count + msg.hidden + msg.failed).toBe(flat.count + flat.hidden + flat.failed);
    expect(transfer).toEqual([msg.positions.buffer, msg.colors.buffer, msg.sizes.buffer, msg.index.buffer, msg.categoryOffsets.buffer]);
    // The next tick keeps the camera.
    p.handle({ type: 'tick', at: at + 1000 });
    const next = sent.at(-1)!.msg;
    expect(next.type === 'frame' && next.camera).toEqual(camera);
  });

  it('does not rebuild or re-send the arrays when the catalogue version is unchanged', async () => {
    const { p, sent } = harness(ok);
    await p.handle({ type: 'load', url: '/api/satellites' });
    await p.handle({ type: 'load', url: '/api/satellites' });
    const second = sent[1]!;
    expect(second.msg.type).toBe('catalogue');
    expect(second.msg.type === 'catalogue' && second.msg.packed).toBeNull();
    expect(second.transfer).toEqual([]);
  });

  it('reports SOURCE OFFLINE (503 + last-good meta) and keeps propagating the last catalogue', async () => {
    let offline = false;
    const { p, sent } = harness(() =>
      offline ? { ok: false, status: 503, json: async () => ({ meta: { ...meta, state: 'offline', lastGoodAt: meta.lastGoodAt }, providers: { celestrak: { ok: false, count: 0, ms: 5, age_s: 9000 } } }) } : ok(),
    );
    await p.handle({ type: 'load', url: '/api/satellites' });
    offline = true;
    await p.handle({ type: 'load', url: '/api/satellites' });
    const err = sent.at(-1)!.msg;
    expect(err).toMatchObject({ type: 'catalogue-error', status: 503, meta: { lastGoodAt: meta.lastGoodAt } });
    p.handle({ type: 'tick', at: Date.parse('2026-09-30T18:06:00Z') });
    expect(sent.at(-1)!.msg.type).toBe('frame');
  });

  it('a network failure before any catalogue yields an error and no frames', async () => {
    const sent: WorkerOut[] = [];
    const p = createPropagator(
      (m) => sent.push(m),
      async () => {
        throw new TypeError('network');
      },
    );
    await p.handle({ type: 'load', url: '/api/satellites' });
    p.handle({ type: 'tick', at: 0 });
    expect(sent).toEqual([{ type: 'catalogue-error', status: 0, meta: null, providers: null }]);
  });
});
