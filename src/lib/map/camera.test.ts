import { afterEach, describe, expect, it } from 'vitest';
import type { FlyToRequest } from '@/lib/store';
import { type CameraStoreState, dossierDeepLinkCamera, nextCameraRequest, requestIntroFlyTo, resetCameraRequests } from './camera';

/** Minimal store with the real requestFlyTo semantics (latest request wins, ts increments). */
function fakeStore(init: Partial<CameraStoreState> = {}) {
  let seq = 0;
  const state: CameraStoreState = {
    flyTo: null,
    cameraFromUrl: false,
    dossierTarget: null,
    plannedRoute: null,
    flightIdent: null,
    ...init,
    requestFlyTo: (r) => {
      state.flyTo = { ...r, ts: ++seq };
    },
  };
  return { get: () => state, state };
}

const LA = { lat: 34.05, lng: -118.24, zoom: 3.4 };
const LHR_JFK = { lat: 51, lng: -40, zoom: 3 };

afterEach(() => resetCameraRequests());

describe('camera request precedence', () => {
  it('a request made before style.load is kept pending and applied on style.load', () => {
    const s = fakeStore();
    s.state.requestFlyTo(LHR_JFK);
    const req = s.state.flyTo;
    expect(nextCameraRequest(req, false, 0)).toBeNull();
    expect(nextCameraRequest(req, true, 0)).toEqual(req);
    // served once only
    expect(nextCameraRequest(req, true, req!.ts)).toBeNull();
  });

  it('a deep-link request issued after the intro wins (the intro never overrides it)', () => {
    const s = fakeStore();
    expect(requestIntroFlyTo(s.get, LA)).toBe(true);
    const intro = s.state.flyTo!;
    expect(nextCameraRequest(intro, true, 0)).toEqual(intro); // intro starts flying
    s.state.requestFlyTo(LHR_JFK); // RouteLayer frames the route later
    const route = s.state.flyTo!;
    expect(nextCameraRequest(route, true, intro.ts)).toEqual(route);
  });

  it('an intro requested after an explicit request is not issued (the pending request is not dropped)', () => {
    const s = fakeStore();
    s.state.requestFlyTo(LHR_JFK);
    const route = s.state.flyTo;
    expect(requestIntroFlyTo(s.get, LA)).toBe(false);
    expect(s.state.flyTo).toBe(route);
    expect(nextCameraRequest(s.state.flyTo, true, 0)).toEqual(route);
  });

  it('an intro that is still pending when an explicit request was seen is skipped', () => {
    const s = fakeStore();
    requestIntroFlyTo(s.get, LA);
    const intro: FlyToRequest = s.state.flyTo!;
    nextCameraRequest({ ...LHR_JFK, ts: 999 }, false, 0); // host observed an explicit request
    expect(nextCameraRequest(intro, true, 0)).toBeNull();
  });

  it('no intro when a deep link will frame the camera', () => {
    for (const init of [{ cameraFromUrl: true }, { plannedRoute: { from: 'LHR', to: 'JFK' } }, { flightIdent: 'BAW117' }, { dossierTarget: { lat: 50.45, lng: 30.52 } }]) {
      resetCameraRequests();
      const s = fakeStore(init);
      expect(requestIntroFlyTo(s.get, LA)).toBe(false);
      expect(s.state.flyTo).toBeNull();
    }
  });

  it('frames a ?dossier= deep link unless ?c= restored the camera', () => {
    expect(dossierDeepLinkCamera({ cameraFromUrl: false, dossierTarget: { lat: 50.45, lng: 30.52 } })).toMatchObject({ lat: 50.45, lng: 30.52, zoom: 5 });
    expect(dossierDeepLinkCamera({ cameraFromUrl: true, dossierTarget: { lat: 50.45, lng: 30.52 } })).toBeNull();
    expect(dossierDeepLinkCamera({ cameraFromUrl: false, dossierTarget: null })).toBeNull();
    expect(dossierDeepLinkCamera({ cameraFromUrl: false, dossierTarget: { lat: Number.NaN, lng: 1 } })).toBeNull();
  });
});
