// @vitest-environment jsdom
/**
 * r11 MAJOR B (§9 item 2, terminator replay): the day/night bands follow the 24 h timeline cursor
 * (rounded to the refresh period, so a drag does not run the worker per pixel) and return to now
 * when the timeline goes live.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TERMINATOR_REFRESH_MS } from '@/lib/map/geometry-protocol';
import { useUiStore } from '@/lib/store';

const terminator = vi.fn((_at: number, _step?: number) => Promise.resolve({ type: 'FeatureCollection' as const, features: [] }));
vi.mock('@/lib/map/geometry-client', () => ({ geometryClient: () => ({ terminator }) }));
vi.mock('react-map-gl/maplibre', () => ({ Source: ({ children }: { children?: unknown }) => children ?? null, Layer: () => null }));

const { default: TerminatorLayer, terminatorTime } = await import('./TerminatorLayer');

const NOW = Date.parse('2026-10-02T12:00:30Z');
const H = 3_600_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
  terminator.mockClear();
  useUiStore.setState({ timeCursor: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useUiStore.setState({ timeCursor: null });
});

describe('terminator replay', () => {
  it('rounds the cursor to the refresh period; live is now', () => {
    expect(terminatorTime(null, NOW)).toBe(NOW);
    expect(terminatorTime(NOW - 9 * H + 20_000, NOW)).toBe(Date.parse('2026-10-02T03:01:00Z'));
    expect(terminatorTime(NOW - 9 * H + 20_000, NOW) % TERMINATOR_REFRESH_MS).toBe(0);
  });

  it('the bands follow the cursor and return to now on live', async () => {
    render(<TerminatorLayer visible />);
    expect(terminator).toHaveBeenLastCalledWith(NOW, 2);

    await act(async () => useUiStore.setState({ timeCursor: Date.parse('2026-10-02T03:00:10Z') }));
    expect(terminator).toHaveBeenLastCalledWith(Date.parse('2026-10-02T03:00:00Z'), 2);

    // Moves inside one rounded minute do not run the worker again.
    const calls = terminator.mock.calls.length;
    await act(async () => useUiStore.setState({ timeCursor: Date.parse('2026-10-02T03:00:20Z') }));
    expect(terminator.mock.calls.length).toBe(calls);

    await act(async () => useUiStore.setState({ timeCursor: null }));
    expect(terminator).toHaveBeenLastCalledWith(NOW, 2);
  });

  it('hidden: the worker is not asked', () => {
    useUiStore.setState({ timeCursor: NOW - H });
    render(<TerminatorLayer visible={false} />);
    expect(terminator).not.toHaveBeenCalled();
  });
});
