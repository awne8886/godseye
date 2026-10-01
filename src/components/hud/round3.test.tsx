// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sourceDisplayName } from '@/components/cards/source-name';
import { HINT_MIN_ROW_PX, READOUT_ATTRIB_GAP_PX, READOUT_BASE_RIGHT_PX, readoutRightInset } from './map-readout';
import { isModalPanel } from './PanelHost';
import StyleStudioPanel from './panels/StyleStudioPanel';
import { entitiesLabel } from './status-logic';

function mockMobile(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query, addEventListener: () => {}, removeEventListener: () => {}, onchange: null, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('R3-M1: readout row stays clear of the attribution', () => {
  it('keeps the 44rem base inset while the attribution is short or absent', () => {
    expect(readoutRightInset(1600, null)).toBe(READOUT_BASE_RIGHT_PX);
    expect(readoutRightInset(1600, 1600 - 300)).toBe(READOUT_BASE_RIGHT_PX);
  });

  it('ends before an 851 px credit line (round-3 measurement: x 743–1594 at 1600 px)', () => {
    const inset = readoutRightInset(1600, 743);
    expect(inset).toBe(1600 - 743 + READOUT_ATTRIB_GAP_PX);
    // Row right edge = viewport - inset, strictly left of the attribution's left edge.
    expect(1600 - inset).toBeLessThan(743);
    // The row starts at 288 px (left-72): 455 px left, under the hint minimum, so the hint hides.
    expect(1600 - inset - 288).toBeLessThan(HINT_MIN_ROW_PX);
  });

  it('ignores non-finite measurements', () => {
    expect(readoutRightInset(1920, Number.NaN)).toBe(READOUT_BASE_RIGHT_PX);
  });
});

describe('R3-m6: header entity readout', () => {
  it('keeps the received count visible while drawing, without calling it drawn', () => {
    expect(entitiesLabel(4691, false)).toBe('4,691 ENTITIES');
    expect(entitiesLabel(4691, true)).toBe('4,691 RECEIVED + DRAWING');
    expect(entitiesLabel(0, true)).toBe('ENTITIES LOADING');
    expect(entitiesLabel(0, false)).toBe('0 ENTITIES');
  });
});

describe('n7: card source names come from the catalogue', () => {
  it('maps the raw ids seen in round 3', () => {
    expect(sourceDisplayName('usgs')).toBe('USGS Earthquake Hazards Program');
    expect(sourceDisplayName('firms')).toBe('NASA FIRMS (LANCE)');
    expect(sourceDisplayName('urlhaus')).toBe('abuse.ch URLhaus');
    expect(sourceDisplayName('caltrans')).toBe('Caltrans CWWP2');
  });

  it('resolves aliases, product suffixes and lists', () => {
    expect(sourceDisplayName('adsblol_tiles')).toBe('adsb.lol');
    expect(sourceDisplayName('celestrak')).toBe('CelesTrak');
    expect(sourceDisplayName('usgs, firms')).toBe('USGS Earthquake Hazards Program + NASA FIRMS (LANCE)');
  });

  it('falls back to the layer’s only source, then to a readable form, never an empty string', () => {
    expect(sourceDisplayName('usgs-feed-x', 'earthquakes')).toBe('USGS Earthquake Hazards Program');
    expect(sourceDisplayName('zzunknown')).toBe('ZZUNKNOWN');
    expect(sourceDisplayName('ACE')).toBe('ACE');
    expect(sourceDisplayName('')).toBe('—');
  });
});

describe('R3-m1 / R3-m2: Style Studio placement', () => {
  it('is a modal on desktop and a bottom-sheet panel on phones', () => {
    expect(isModalPanel('style-studio', false)).toBe(true);
    expect(isModalPanel('style-studio', true)).toBe(false);
    expect(isModalPanel('palette', true)).toBe(true);
    expect(isModalPanel('layers', false)).toBe(false);
  });

  it('desktop: a dialog with a region named STYLE STUDIO (the palette target)', () => {
    mockMobile(false);
    render(<StyleStudioPanel onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'STYLE STUDIO' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'STYLE STUDIO' })).toBeTruthy();
  });

  it('phone: renders inline for the sheet (no own dialog or close button), 44 px tools', () => {
    mockMobile(true);
    render(<StyleStudioPanel onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('style-studio-sheet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close Style Studio' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy theme JSON' }).className).toContain('h-11');
    expect(screen.getByRole('radiogroup', { name: 'Theme preset' })).toBeTruthy();
  });
});
