/**
 * Round 5 R2 MAJOR-1, the reviewer's repro ported as is: TxDOT `GetCctvSnapshotByIcdId` answered
 * `200 application/json; charset=utf-8` with the body `null` (probed 13:29Z and again 17:34Z on
 * 2026-10-01 for YKM "US59 @ Youngdale Rd (S)- El Campo"). `fetchTxdotSnapshot` threw a TypeError,
 * which `withRoute` turned into a 500. It must answer a FrameResult instead.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ssrf', async (orig) => ({
  ...(await orig<object>()),
  allowListedFetch: vi.fn(async () => ({ ok: true, status: 200, headers: { 'content-type': 'application/json; charset=utf-8' }, body: Buffer.from('null'), url: 'x' })),
}));

describe('fetchTxdotSnapshot with an upstream JSON null', () => {
  it('answers a FrameResult (frame_unavailable / no_snapshot, 404), not a thrown TypeError → 500', async () => {
    const { fetchTxdotSnapshot, frameResponse } = await import('./frames');
    const { providerDef } = await import('./registry');
    const cam = {
      id: 'txdot-YKM-YKM-US59 @ Youngdale Rd (S)- El Campo',
      providerId: 'txdot',
      stillUrl: 'https://its.txdot.gov/its/DistrictIts/GetCctvSnapshotByIcdId?districtCode=YKM&icdId=YKM-US59%20%40%20Youngdale%20Rd%20(S)-%20El%20Campo',
    } as never;
    const r = await fetchTxdotSnapshot(cam, providerDef('txdot')!);
    expect(r).toMatchObject({ ok: false, status: 404, error: 'no_snapshot' });
    const res = frameResponse(r);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'frame_unavailable', detail: 'no_snapshot', state: 'offline' });
  });
});
