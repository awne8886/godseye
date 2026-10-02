import { describe, expect, it } from 'vitest';
import { buildShareUrl, parseCamera, parseLatLngParam, parsePinnedParam, parseRouteParam, parseUrlState, serializeCamera } from './url-state';

describe('url state', () => {
  it('parses and clamps camera params', () => {
    expect(parseCamera('51.5,-0.12,5')).toEqual({ lat: 51.5, lng: -0.12, zoom: 5, pitch: 0, bearing: 0 });
    expect(parseCamera('10,20,30,99,190')).toEqual({ lat: 10, lng: 20, zoom: 22, pitch: 85, bearing: -170 });
    expect(parseCamera('91,0,2')).toBeNull();
    expect(parseCamera('a,b,c')).toBeNull();
    expect(serializeCamera({ lat: 51.50721, lng: -0.12758, zoom: 5.123, pitch: 0, bearing: 0 })).toBe('51.5072,-0.1276,5.12');
  });

  it('parses route params in every accepted form', () => {
    expect(parseRouteParam('LHR-JFK')).toEqual({ from: 'LHR', to: 'JFK' });
    expect(parseRouteParam('egll→kjfk')).toEqual({ from: 'EGLL', to: 'KJFK' });
    expect(parseRouteParam('LHR JFK')).toEqual({ from: 'LHR', to: 'JFK' });
    expect(parseRouteParam('LHR-LHR')).toBeNull();
    expect(parseRouteParam('<script>')).toBeNull();
  });

  it('round-trips a share URL', () => {
    const url = buildShareUrl('https://godseye.example', {
      camera: { lat: 51.5, lng: -0.12, zoom: 4, pitch: 20, bearing: 0 },
      layers: ['fires', 'earthquakes'],
      panel: 'paths',
      route: { from: 'LHR', to: 'JFK' },
      projection: 'mercator',
    });
    const s = parseUrlState(new URL(url).searchParams);
    expect(s.camera?.pitch).toBe(20);
    expect(s.layers).toEqual(['earthquakes', 'fires']);
    expect(s.panel).toBe('paths');
    expect(s.route).toEqual({ from: 'LHR', to: 'JFK' });
    expect(s.projection).toBe('mercator');
    expect(parseUrlState(new URLSearchParams('panel=evil&theme=<x>')).panel).toBeNull();
  });

  it('accepts legacy OSIRIS ?lat=&lon=&zoom= links but prefers ?c=', () => {
    expect(parseUrlState(new URLSearchParams('lat=48.85&lon=2.35&zoom=6')).camera).toEqual({ lat: 48.85, lng: 2.35, zoom: 6, pitch: 0, bearing: 0 });
    expect(parseUrlState(new URLSearchParams('lat=48.85&lon=2.35')).camera?.zoom).toBe(4);
    expect(parseUrlState(new URLSearchParams('c=1,2,3&lat=48.85&lon=2.35')).camera?.lat).toBe(1);
    expect(parseUrlState(new URLSearchParams('lat=abc&lon=2')).camera).toBeNull();
  });

  it('parses dossier targets and pinned panels, dropping junk', () => {
    expect(parseLatLngParam('50.45,30.52')).toEqual({ lat: 50.45, lng: 30.52 });
    expect(parseLatLngParam('95,0')).toBeNull();
    expect(parseLatLngParam('1,2,3')).toBeNull();
    expect(parsePinnedParam('flight-watch,camera,flight-watch,evil')).toEqual(['flight-watch', 'camera']);
    expect(parsePinnedParam('evil')).toBeNull();
    const url = buildShareUrl('https://godseye.example', { dossier: { lat: 50.450012, lng: 30.523 }, pinned: ['camera'], flight: 'BA117' });
    const s = parseUrlState(new URL(url).searchParams);
    expect(s.dossier).toEqual({ lat: 50.45, lng: 30.523 });
    expect(s.pinned).toEqual(['camera']);
    expect(s.flight).toBe('BA117');
  });
});
