// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { AnimatePresence, LazyMotion, domMax } from 'motion/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SOURCES } from '@/lib/sources';
import { CHIP_TONE_TOKEN, imageryChipTone } from './chip-tone';
import { occupiedFromBottom } from './hooks';
import { MobileSheetBody } from './PanelHost';
import { gateLabel } from './panels/AttributionPanel';

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty('--sheet-occupied');
});

function Host({ open }: { open: boolean }): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return (
    <QueryClientProvider client={client}>
      <LazyMotion features={domMax}>
        <AnimatePresence>{open && <MobileSheetBody key="sheet" id="help" />}</AnimatePresence>
      </LazyMotion>
    </QueryClientProvider>
  );
}

describe('phone sheet exit (m5) and attribution reserve (m2)', () => {
  it('leaves the accessibility tree the moment its exit starts', () => {
    const { rerender } = render(<Host open />);
    const sheet = screen.getByTestId('mobile-sheet');
    expect(sheet.getAttribute('aria-hidden')).toBeNull();
    expect(sheet.hasAttribute('inert')).toBe(false);
    rerender(<Host open={false} />);
    // Still mounted while the spring exit plays, but already hidden from AT and the tab order.
    const exiting = screen.getByTestId('mobile-sheet');
    expect(exiting.getAttribute('aria-hidden')).toBe('true');
    expect(exiting.hasAttribute('inert')).toBe(true);
    expect(exiting.hasAttribute('data-exiting')).toBe(true);
  });

  it('publishes the height it covers while open and clears it on exit', () => {
    // jsdom cannot resolve calc(56px + env(...)); a browser hands back the resolved px value.
    const spy = vi.spyOn(window, 'getComputedStyle').mockReturnValue({ bottom: '56px' } as CSSStyleDeclaration);
    const { rerender } = render(<Host open />);
    expect(document.documentElement.style.getPropertyValue('--sheet-occupied')).toMatch(/^\d+px$/);
    rerender(<Host open={false} />);
    expect(document.documentElement.style.getPropertyValue('--sheet-occupied')).toBe('');
    spy.mockRestore();
  });

  it('measures occupied height from layout, not the slide transform', () => {
    const el = document.createElement('div');
    el.style.position = 'fixed';
    el.style.bottom = '56px';
    el.style.transform = 'translateY(100%)';
    Object.defineProperty(el, 'offsetHeight', { value: 300 });
    document.body.append(el);
    expect(occupiedFromBottom(el)).toBe(356);
    el.remove();
  });
});

describe('imagery chip tones (m3)', () => {
  it('marks BASEMAP OFFLINE and a failed terrain line with the alert token; imagery stays neutral', () => {
    expect(imageryChipTone({ id: 'basemap', text: 'BASEMAP OFFLINE · last tile 12:04Z' })).toBe('offline');
    expect(imageryChipTone({ id: 'terrain', text: 'Terrain unavailable; the map is still usable.' })).toBe('offline');
    expect(imageryChipTone({ id: 'terrain', text: 'Terrain on' })).toBe('reference');
    expect(imageryChipTone({ id: 'night', text: 'Night lights: VIIRS Black Marble 2016' })).toBe('reference');
    expect(CHIP_TONE_TOKEN.offline).toBe('--alert-orange');
    expect(CHIP_TONE_TOKEN.reference).not.toBe(CHIP_TONE_TOKEN.offline);
  });
});

describe('source gate labels (n3)', () => {
  const opensky = SOURCES.find((s) => s.id === 'opensky')!.gate!;
  it('says whether this server enables a gated source once /api/health answered', () => {
    expect(gateLabel(opensky, undefined)).toMatch(/^GATED · /);
    expect(gateLabel(opensky, { opensky: { enabled: false, reason: 'OPENSKY_LICENSED not true' } })).toMatch(/^NOT ENABLED ON THIS SERVER · /);
    expect(gateLabel(opensky, { opensky: { enabled: true, reason: null } })).toMatch(/^ENABLED · /);
  });
});
