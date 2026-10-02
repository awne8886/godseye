import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { done, fresh, req } from '@/features/surveillance/server/__fixtures__/helpers';
import { recordFrame } from '@/features/surveillance/server/frame-health';
import { frameHealthLabel } from '@/features/surveillance/shared';
import { CameraProvidersResponse } from '@/lib/schemas/surveillance';
import { GET } from './route';

beforeEach(fresh);
afterEach(done);

describe('GET /api/cctv/providers', () => {
  it('lists every registry row with licence, attribution and terms, plus meta + providers', async () => {
    const res = await GET(req('/api/cctv/providers'), undefined);
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(CameraProvidersResponse.safeParse(b).success).toBe(true);
    expect(b.meta).toMatchObject({ feed: 'cctv-providers', kind: 'reference', state: 'reference' });
    // No region loaded yet: only the providers this instance withholds are reported, as skipped.
    expect(Object.keys(b.providers).sort()).toEqual(['tfl', 'trafikverket']);
    expect(b.providers.tfl).toEqual({ ok: false, count: 0, ms: 0, age_s: null, skipped: 'not-configured' });
    expect(b.items.find((p: { id: string }) => p.id === 'tfl').attribution_string).toMatch(/Powered by TfL Open Data/);
    expect(b.meta.attribution.length).toBe(b.items.length);
    // MAJOR-D: OSIRIS sources not wired are listed with a reason, never silently missing or advertised.
    expect(b.notWired.map((s: { id: string }) => s.id).sort()).toEqual(['ibi511', 'windy']);
    for (const s of b.notWired as { id: string }[]) expect(b.items.some((p: { id: string }) => p.id === s.id), s.id).toBe(false);
    expect(b.items.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining(['indot', 'vialietuva', 'edmonton', 'mlit']));
  });

  it('round 5 (R2 minor 4): reports the freshest relayed frame age, so 21 h old Toronto frames read STALE, not AVAILABLE', async () => {
    const now = Date.now();
    // Toronto stills carried Last-Modified ~21.6 h before the fetch (reviewer: lastFrameAge_s 77879).
    for (const [i, age] of [77879, 77700, 78010].entries()) recordFrame('toronto', { at: now - i * 1000, cameraId: `toronto-${8001 + i}`, ok: true, error: null, observedAt: now - i * 1000 - age * 1000 });
    recordFrame('hktd', { at: now, cameraId: 'hktd-H429F', ok: true, error: null, observedAt: now - 68_000 });
    const b = await (await GET(req('/api/cctv/providers'), undefined)).json();
    expect(CameraProvidersResponse.safeParse(b).success).toBe(true);
    expect(b.frames.toronto).toMatchObject({ state: 'available', cameras: 3, freshestFrameAge_s: 77700 });
    expect(b.frames.hktd).toMatchObject({ state: 'available', freshestFrameAge_s: 68 });
    const cadence = (id: string) => b.items.find((p: { id: string }) => p.id === id).max_poll_interval as number;
    expect(frameHealthLabel(b.frames.toronto, cadence('toronto'))).toEqual({ text: 'STALE · FRAMES 21h OLD', tone: 'warn' });
    expect(frameHealthLabel(b.frames.hktd, cadence('hktd'))).toEqual({ text: 'AVAILABLE', tone: 'ok' });
    expect(b.meta.note).toMatch(/AVAILABLE only within 6 operator poll intervals/);
  });
});
