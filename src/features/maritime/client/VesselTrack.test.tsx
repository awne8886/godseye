// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Selection } from '@/lib/layer-host';
import VesselTrack from './VesselTrack';

const sel = (track: unknown): Selection => ({ kind: 'vessel', id: '235000001', layer: 'maritime', source: 'aisstream', observedAt: null, data: { track }, lngLat: null });

afterEach(cleanup);

describe('vessel TRACK tab', () => {
  it('lists the received AIS reports newest first with the speed between reports', () => {
    const t0 = Date.parse('2026-10-02T07:00:00Z') / 1000;
    render(
      <VesselTrack
        selection={sel([
          [1.0, 51.0, t0],
          [1.0, 51.1, t0 + 600],
        ])}
      />,
    );
    expect(screen.getByText(/2 POSITIONS AT SELECTION/)).toBeTruthy();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]!.textContent).toContain('07:10:00Z');
    // 0.1° of latitude in 10 min ≈ 36 kt.
    expect(rows[0]!.textContent).toMatch(/3[56]\.\d KT/);
    expect(rows[1]!.textContent).toContain('—');
  });

  it('says there is no track rather than drawing an empty one', () => {
    render(<VesselTrack selection={sel([])} />);
    expect(screen.getByText('NO AIS TRACK RECEIVED FOR THIS VESSEL YET')).toBeTruthy();
    expect(screen.queryByTestId('ground-track-plot')).toBeNull();
  });
});
