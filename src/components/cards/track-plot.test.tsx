// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GroundTrackPlot, ProfilePlot, profileRuns, unwrapRuns } from './track-plot';

afterEach(cleanup);

describe('track plots', () => {
  it('keeps a track over the antimeridian continuous instead of drawing across the world', () => {
    expect(unwrapRuns([[[179, 0], [-179, 1], [-178, 2]]])).toEqual([[[179, 0], [181, 1], [182, 2]]]);
    expect(unwrapRuns([[[-179, 0], [179, 1]]])).toEqual([[[-179, 0], [-181, 1]]]);
  });

  it('leaves a gap at a missing value, never bridging it', () => {
    const runs = profileRuns([
      { t: 1, v: 100 },
      { t: 2, v: null },
      { t: 3, v: 300 },
      { t: 4, v: 400 },
    ]);
    expect(runs.map((r) => r.map((p) => p.t))).toEqual([[1], [3, 4]]);
  });

  it('draws one polyline per run and labels the profile range and times', () => {
    render(
      <ProfilePlot
        label="ALT"
        format={(v) => `${v} FT`}
        points={[
          { t: Date.parse('2026-10-02T07:00:00Z'), v: 0 },
          { t: Date.parse('2026-10-02T07:10:00Z'), v: 10_000 },
          { t: Date.parse('2026-10-02T07:20:00Z'), v: 30_000 },
        ]}
      />,
    );
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('ALT: 0 FT to 30000 FT, 07:00:00Z to 07:20:00Z');
    expect(document.querySelectorAll('polyline')).toHaveLength(1);
  });

  it('renders nothing for an empty track and marks the head when given', () => {
    const { container } = render(<GroundTrackPlot runs={[]} label="none" />);
    expect(container.innerHTML).toBe('');
    render(
      <GroundTrackPlot
        runs={[
          [
            [10, 50],
            [11, 51],
          ],
        ]}
        head={[11, 51]}
        label="track"
      />,
    );
    expect(screen.getByTestId('track-head')).toBeTruthy();
  });
});
