// @vitest-environment jsdom
/**
 * design-system-hud, Phase 3 round 7 minors: the desktop sensor chip leaves the header row, one
 * terrain status (the map's imagery-chip stack), and layer rows collapse several source credits to
 * a SOURCES (N) disclosure. Layouts are measured in e2e/design-system-hud/round7.spec.ts; the tab
 * reveal maths is in tab-reveal.test.ts.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getLayer } from '@/lib/layer-registry';
import { useLayerStatusStore } from '@/lib/layer-host';
import { useUiStore } from '@/lib/store';
import { LayerRow } from './LayerRows';
import Overlays from './Overlays';

afterEach(() => {
  cleanup();
  act(() => {
    useUiStore.getState().setSensor('none');
    useUiStore.getState().setLayer('cctv', false);
    useUiStore.getState().setLayer('earthquakes', false);
  });
  useLayerStatusStore.setState({ status: {} });
});

describe('r7 m: the desktop sensor chip is off the header row', () => {
  it('sits below the header (not top-4) and one z step above the HUD scrim', () => {
    act(() => useUiStore.getState().setSensor('crt'));
    render(<Overlays />);
    const cls = screen.getByTestId('sensor-chip').className.split(/\s+/);
    expect(cls).not.toContain('top-4');
    expect(cls).toContain('top-24');
    expect(cls).toContain('z-[calc(var(--z-hud)+1)]');
    // The phone placement from r6 is unchanged.
    expect(cls).toContain('phone:top-[calc(env(safe-area-inset-top)+124px)]');
  });
});

describe('r7 m: layer rows collapse long source credits', () => {
  const credits = Array.from({ length: 12 }, (_, i) => ({ text: `Operator ${i + 1}`, url: `https://example.org/${i + 1}`, licence: 'Open Government Licence' }));

  it('shows SOURCES (N) closed by default, with every credit one click away', () => {
    useUiStore.getState().setLayer('cctv', true);
    useLayerStatusStore.getState().update('cctv', { state: 'live', count: 12, attribution: credits });
    render(
      <ul>
        <LayerRow layer={getLayer('cctv')!} />
      </ul>,
    );
    const details = screen.getByTestId('sources-cctv') as HTMLDetailsElement;
    expect(details.tagName).toBe('DETAILS');
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')!.textContent).toMatch(/^SOURCES \(12\)/);
    // Nothing is dropped: all twelve credits sit inside the disclosure, links safe.
    const items = screen.getByTestId('attribution-cctv').querySelectorAll('li');
    expect(items).toHaveLength(12);
    for (const a of screen.getByTestId('attribution-cctv').querySelectorAll('a')) expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    fireEvent.click(details.querySelector('summary')!);
    expect(details.open).toBe(true);
  });

  it('keeps a single credit inline (no disclosure for one line)', () => {
    useUiStore.getState().setLayer('earthquakes', true);
    useLayerStatusStore.getState().update('earthquakes', { state: 'live', count: 3, attribution: [{ text: 'USGS Earthquake Hazards Program', url: 'https://earthquake.usgs.gov/' }] });
    render(
      <ul>
        <LayerRow layer={getLayer('earthquakes')!} />
      </ul>,
    );
    expect(screen.queryByTestId('sources-earthquakes')).toBeNull();
    expect(screen.getByTestId('attribution-earthquakes').textContent).toBe('USGS Earthquake Hazards Program');
  });
});
