import { describe, expect, it, vi } from 'vitest';
import { solarElevation } from '@/lib/solar';
import { createGeometryClient, type GeometryPort } from './geometry-client';
import { type GeometryRequest, type GeometryResponse, handleGeometryRequest } from './geometry-protocol';

const AT = Date.UTC(2026, 8, 30, 18, 0); // 2026-09-30T18:00Z

describe('geometry worker message contract', () => {
  it('answers a terminator request with four nested twilight bands, echoing id and time', () => {
    const r = handleGeometryRequest({ id: 7, type: 'terminator', at: AT, stepDeg: 2 });
    expect(r.type).toBe('terminator');
    if (r.type !== 'terminator') return;
    expect(r.id).toBe(7);
    expect(r.at).toBe(AT);
    expect(r.bands.features.map((f) => [f.properties.band, f.properties.elevation])).toEqual([
      ['civil', 0],
      ['nautical', -6],
      ['astronomical', -12],
      ['night', -18],
    ]);
    for (const f of r.bands.features) expect(['Polygon', 'MultiPolygon']).toContain(f.geometry.type);
  });

  it('band edges sit at their solar elevation', () => {
    const r = handleGeometryRequest({ id: 1, type: 'terminator', at: AT, stepDeg: 1 });
    if (r.type !== 'terminator') throw new Error(r.type);
    for (const f of r.bands.features) {
      const ring = (f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0]![0])!;
      // Points on the curved edge (skip the pole-closing corners at ±180/±90).
      const edge = ring.filter(([, lat]) => Math.abs(lat!) < 89).slice(5, 15);
      for (const p of edge) expect(solarElevation(p as [number, number], AT)).toBeCloseTo(f.properties.elevation, 0);
    }
  });

  it('clamps the step and returns great-circle points', () => {
    const r = handleGeometryRequest({ id: 2, type: 'greatCircle', from: [-0.4614, 51.47], to: [-73.7789, 40.6398], points: 5000 });
    expect(r.type).toBe('greatCircle');
    if (r.type === 'greatCircle') {
      expect(r.points).toHaveLength(1024);
      expect(r.points[0]![0]).toBeCloseTo(-0.4614, 6);
    }
  });

  it('turns bad input into an error response instead of throwing', () => {
    expect(handleGeometryRequest({ id: 3, type: 'terminator', at: Number.NaN })).toMatchObject({ id: 3, type: 'error' });
    expect(handleGeometryRequest({ id: 4, type: 'greatCircle', from: [0, 95], to: [0, 0] })).toMatchObject({ id: 4, type: 'error' });
    expect(handleGeometryRequest({ id: 5, type: 'nope' } as unknown as GeometryRequest)).toMatchObject({ id: 5, type: 'error' });
  });
});

describe('geometry client', () => {
  function loopbackPort(): GeometryPort & { sent: GeometryRequest[] } {
    const port = {
      sent: [] as GeometryRequest[],
      onmessage: null as GeometryPort['onmessage'],
      onerror: null as GeometryPort['onerror'],
      terminate: vi.fn(),
      postMessage(m: GeometryRequest) {
        port.sent.push(m);
        queueMicrotask(() => port.onmessage?.({ data: handleGeometryRequest(m) } as MessageEvent<GeometryResponse>));
      },
    };
    return port;
  }

  it('routes requests through the worker port by id', async () => {
    const port = loopbackPort();
    const client = createGeometryClient(() => port);
    const [bands, line] = await Promise.all([client.terminator(AT), client.greatCircle([0, 0], [10, 0], 3)]);
    expect(bands.features).toHaveLength(4);
    expect(line).toHaveLength(3);
    expect(port.sent.map((m) => m.id)).toEqual([1, 2]);
  });

  it('computes in-thread when no worker can start', async () => {
    const client = createGeometryClient(() => {
      throw new Error('no module workers');
    });
    expect((await client.terminator(AT)).features).toHaveLength(4);
  });

  it('fetches night-lights tiles through the worker, transfers the bytes and forwards aborts', async () => {
    const sent: GeometryRequest[] = [];
    const port: GeometryPort = {
      onmessage: null,
      onerror: null,
      terminate: vi.fn(),
      postMessage(m) {
        sent.push(m);
        if (m.type === 'nightTile' && m.url.includes('/1/0/0')) queueMicrotask(() => port.onmessage?.({ data: { id: m.id, type: 'nightTile', data: new Uint8Array([7]).buffer } } as MessageEvent<GeometryResponse>));
        if (m.type === 'nightTile' && m.url.includes('/1/1/1')) queueMicrotask(() => port.onmessage?.({ data: { id: m.id, type: 'error', message: 'HTTP 503' } } as MessageEvent<GeometryResponse>));
      },
    };
    const client = createGeometryClient(() => port);
    expect(client.hasWorker()).toBe(true);
    expect(new Uint8Array(await client.nightTile('godseye-night://1/0/0?t=0', new AbortController().signal))).toEqual(new Uint8Array([7]));
    await expect(client.nightTile('godseye-night://1/1/1?t=0', new AbortController().signal)).rejects.toThrow('HTTP 503');
    const ac = new AbortController();
    const pending = client.nightTile('godseye-night://1/0/1?t=0', ac.signal);
    ac.abort(new Error('panned away'));
    await expect(pending).rejects.toThrow('panned away');
    const req = sent.find((m) => m.type === 'nightTile' && m.url.includes('/1/0/1'))!;
    expect(sent.at(-1)).toMatchObject({ type: 'abort', target: req.id });
    await expect(createGeometryClient(() => null).nightTile('x', new AbortController().signal)).rejects.toThrow(/unavailable/);
    expect(handleGeometryRequest({ id: 9, type: 'nightTile', url: 'x' })).toMatchObject({ type: 'error' });
  });

  it('recomputes in-thread when the worker dies mid-request', async () => {
    const port: GeometryPort = { onmessage: null, onerror: null, terminate: vi.fn(), postMessage: () => queueMicrotask(() => port.onerror?.(new Error('crash'))) };
    const client = createGeometryClient(() => port);
    expect((await client.terminator(AT)).features).toHaveLength(4);
    expect(port.terminate).toHaveBeenCalled();
    client.dispose();
  });
});
