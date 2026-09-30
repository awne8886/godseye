// Phase 1 review A regressions (R-A3, R-A4, R-A9, R-A10).
import { describe, expect, it } from 'vitest';
import { parseLayersParam } from '@/lib/layer-registry';
import { useUiStore } from '@/lib/store';
import { buildShareUrl, parseCamera, parseLatLngParam, parseRouteParam, parseUrlState, serializeCamera, serializeRouteParam } from '@/lib/url-state';

describe('camera round-trip', () => {
  it('wraps an unwrapped longitude instead of dropping the camera', () => {
    const back = parseCamera(serializeCamera({ lat: 35.68, lng: 199.77, zoom: 5, pitch: 0, bearing: 0 }));
    expect(back!.lng).toBeCloseTo(-160.23, 2);
    expect(parseCamera('35.68,199.77,5')!.lng).toBeCloseTo(-160.23, 2);
    expect(parseLatLngParam('10,-190')!.lng).toBeCloseTo(170, 6);
  });
  it('rejects empty components (Number("") is 0)', () => {
    expect(parseCamera(',,')).toBeNull();
    expect(parseCamera('51.5,,4')).toBeNull();
    expect(parseLatLngParam('1,')).toBeNull();
  });
});

describe('dossier/panel exclusivity across reload', () => {
  it('opening another panel clears the dossier target', () => {
    const ui = useUiStore.getState();
    ui.openDossier({ lat: 50.45, lng: 30.52 });
    ui.setOpenPanel('paths');
    const s = useUiStore.getState();
    expect(s.dossierTarget).toBeNull();
    const restored = parseUrlState(new URL(buildShareUrl('https://x.test', { panel: s.openPanel, dossier: s.dossierTarget })).searchParams);
    expect(restored.dossier ? 'dossier' : restored.panel).toBe('paths');
    ui.openDossier({ lat: 1, lng: 2 });
    ui.togglePanel('dossier');
    expect(useUiStore.getState()).toMatchObject({ openPanel: null, dossierTarget: null });
  });
  it('caps pinned panels at 6 and never pins the open panel twice', () => {
    const ui = useUiStore.getState();
    ui.setOpenPanel('camera');
    ui.setPinnedPanels(['camera', 'flight-watch', 'satellite', 'graph', 'live-news', 'markets', 'alerts', 'intel']);
    expect(useUiStore.getState().pinnedPanels).toEqual(['flight-watch', 'satellite', 'graph', 'live-news', 'markets', 'alerts']);
    ui.pinPanel('camera');
    expect(useUiStore.getState().pinnedPanels).not.toContain('camera');
    ui.setOpenPanel(null);
    ui.setPinnedPanels([]);
  });
});

describe('route param vs OurAirports idents', () => {
  it('accepts 3–8 character codes and hyphenated idents with ~', () => {
    expect(parseRouteParam('EGLL-K2W6')).toEqual({ from: 'EGLL', to: 'K2W6' });
    expect(parseRouteParam('EGLL-CYVR1')).toEqual({ from: 'EGLL', to: 'CYVR1' });
    expect(parseRouteParam('egll~us-0001')).toEqual({ from: 'EGLL', to: 'US-0001' });
    expect(serializeRouteParam({ from: 'EGLL', to: 'US-0001' })).toBe('EGLL~US-0001');
    expect(serializeRouteParam({ from: 'lhr', to: 'jfk' })).toBe('LHR-JFK');
    expect(parseRouteParam('EGLL~-')).toBeNull();
    expect(parseRouteParam('LHR-LHR')).toBeNull();
  });
});

describe('?layers= hostile or stale values', () => {
  it('ignores a value with no known ids but honours an explicit empty list', () => {
    expect(parseLayersParam('foo,bar')).toBeNull();
    expect(parseLayersParam('')).toEqual([]);
    expect(parseLayersParam('fires,foo')).toEqual(['fires']);
  });
});
