// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useLayerStatusStore } from '@/lib/layer-host';
import { SOURCES } from '@/lib/sources';
import AttributionPanel, { layerCadenceLabel, layerKindLabel } from './AttributionPanel';
import { getLayer } from '@/lib/layer-registry';
import { FreshnessLed } from '../LayerRows';

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AttributionPanel onClose={() => undefined} />
    </QueryClientProvider>,
  );
}

beforeEach(() => useLayerStatusStore.setState({ status: {} }));
afterEach(cleanup);

describe('SOURCES & LICENCES', () => {
  it('renders every registry source with its licence and a safe link, with no layer answered yet', () => {
    mount();
    for (const s of SOURCES) {
      const row = screen.getByTestId(`source-${s.id}`);
      expect(row.textContent, s.id).toContain(s.licence);
      const a = row.querySelector('a')!;
      expect(a.getAttribute('href')).toBe(s.url);
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('Computed in the browser');
    expect(text).not.toContain('switch the layer on');
    expect(text).toContain(`${SOURCES.length} SOURCES IN THE REGISTER`);
  });

  it('FreshnessLed shows ZOOM ≥ N for an idle zoom-gated layer (Sentinel below z6)', () => {
    render(<FreshnessLed layer={getLayer('sentinel')!} status={{ state: 'idle', error: 'zoom_min_6', count: null, fetchedAt: null, observedAt: null, lastGoodAt: null }} />);
    expect(screen.getByText('ZOOM ≥ 6')).toBeTruthy();
    cleanup();
    const { container } = render(<FreshnessLed layer={getLayer('sentinel')!} status={{ state: 'idle', count: null, fetchedAt: null, observedAt: null, lastGoodAt: null }} />);
    expect(container.textContent).toBe('');
  });

  it('never labels an unobserved feed LIVE and names tile layers as tiles', () => {
    expect(layerKindLabel('live')).toBe('REALTIME');
    expect(layerKindLabel('mixed')).toBe('REALTIME + REFERENCE');
    expect(layerKindLabel('reference')).toBe('REFERENCE');
    expect(layerCadenceLabel(getLayer('terrain_elevation')!)).toBe('TILES');
    expect(layerCadenceLabel(getLayer('gibs_truecolor')!)).toBe('TILES');
    mount();
    const chips = [...document.querySelectorAll('.instrument-chip')].map((e) => e.textContent);
    expect(chips).not.toContain('LIVE');
  });
});
