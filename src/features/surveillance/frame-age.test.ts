/** Round-4 items 1–2: still freshness is never LIVE, untimed frames are never current, failures are classified. */
import { describe, expect, it } from 'vitest';
import { FRAME_RECENT_INTERVALS, frameAge, frameHealthLabel, frameHealthNote, frameRecentS, readFrameFailure } from './shared';

const NOW = Date.parse('2026-10-01T07:49:41Z');

describe('frameAge (viewer chip for a relayed still)', () => {
  it('uses the operator frame time: HK TD Last-Modified 07:48:33 at 07:49:41 → 68 s, recent', () => {
    expect(frameAge('2026-10-01T07:48:33.000Z', 60, NOW)).toEqual({ state: 'recent', label: '1m', ageS: 68 });
  });

  it('a Toronto frame 16 h old (probed Last-Modified) is STALE with its real age, not 0 s', () => {
    const a = frameAge('2026-09-30T15:51:07.000Z', 60, Date.parse('2026-10-01T07:51:07Z'));
    expect(a.state).toBe('stale');
    expect(a.label).toBe('STALE · 16h');
    expect(a.ageS).toBe(16 * 3600);
  });

  it('no operator time → UNTIMED (unknown), never LIVE or "0s"', () => {
    for (const t of [null, undefined, '', 'garbage', '2026-10-01T09:00:00Z']) {
      const a = frameAge(t, 60, NOW);
      expect(a).toEqual({ state: 'unknown', label: 'UNTIMED', ageS: null });
    }
  });

  it('never returns a live state, even for a frame 1 s old', () => {
    const a = frameAge(new Date(NOW - 1000).toISOString(), 30, NOW);
    expect(a.state).toBe('recent');
    expect(a.label).not.toMatch(/LIVE/);
  });

  it('stale after 6 operator intervals (at least 60 s each)', () => {
    expect(frameAge(new Date(NOW - 6 * 60_000).toISOString(), 30, NOW).state).toBe('recent');
    expect(frameAge(new Date(NOW - 6 * 60_000 - 1000).toISOString(), 30, NOW).state).toBe('stale');
    expect(frameAge(new Date(NOW - 20 * 60_000).toISOString(), 300, NOW).state).toBe('recent');
  });
});

describe('readFrameFailure', () => {
  it('NSW not_an_image → offline with the server’s plain message', () => {
    expect(readFrameFailure(502, { error: 'frame_unavailable', detail: 'not_an_image', state: 'offline', message: 'The operator answered with a web page instead of an image.' })).toEqual({
      state: 'offline',
      detail: 'not_an_image',
      message: 'The operator answered with a web page instead of an image.',
    });
  });

  it('unreadable bodies are a transient FEED UNAVAILABLE', () => {
    expect(readFrameFailure(503, null)).toMatchObject({ state: 'unavailable', detail: 'http_503' });
    expect(readFrameFailure(502, { detail: '<b>x</b>', state: 'weird' })).toMatchObject({ state: 'unavailable', detail: 'http_502' });
  });
});

describe('provider frame availability wording', () => {
  it('labels each state; unchecked is never "available"', () => {
    expect(frameHealthLabel(undefined)).toEqual({ text: 'NOT CHECKED YET', tone: 'idle' });
    expect(frameHealthLabel({ state: 'unchecked', cameras: 0, camerasFailing: 0 }).text).toBe('NOT CHECKED YET');
    expect(frameHealthLabel({ state: 'unavailable', cameras: 5, camerasFailing: 5, camerasOperatorFault: 5 })).toEqual({ text: 'UNAVAILABLE · 5/5 FAILING', tone: 'error' });
    expect(frameHealthLabel({ state: 'failing', cameras: 6, camerasFailing: 5, camerasOperatorFault: 4 })).toEqual({ text: 'FAILING · 4/6 CAMERAS', tone: 'warn' });
    expect(frameHealthLabel({ state: 'available', cameras: 5, camerasFailing: 0, freshestFrameAge_s: 68 })).toEqual({ text: 'AVAILABLE', tone: 'ok' });
    expect(frameHealthLabel({ state: 'available', cameras: 5, camerasFailing: 2, camerasOperatorFault: 0, freshestFrameAge_s: 68 })).toEqual({ text: 'AVAILABLE · 2/5 WITHOUT FRAME', tone: 'ok' });
    // Round-4 review: one failed camera is not a verdict on the operator.
    expect(frameHealthLabel({ state: 'inconclusive', cameras: 1, camerasFailing: 1, camerasOperatorFault: 1 })).toEqual({ text: 'NO FRAME RELAYED · 1 TRIED', tone: 'idle' });
  });

  it('explains an HTML outage as an operator-side fault', () => {
    expect(frameHealthNote({ state: 'unavailable', errors: { not_an_image: 5 }, failed: 5 })).toMatch(/web pages instead of camera images/);
    expect(frameHealthNote({ state: 'unavailable', errors: { upstream_503: 3, timeout: 2 }, failed: 5 })).toMatch(/server errors, timeouts or connection failures/);
    expect(frameHealthNote({ state: 'inconclusive', errors: { not_an_image: 2 }, failed: 2 })).toBeNull();
    expect(frameHealthNote({ state: 'available', errors: {}, failed: 0 })).toBeNull();
  });
});

describe('round 5 (R2 minor 4): AVAILABLE only for fresh operator frames', () => {
  const available = { state: 'available' as const, cameras: 5, camerasFailing: 0, camerasOperatorFault: 0 };

  it('Toronto, frames 21.6 h old when relayed (lastFrameAge_s 77879, reviewer) → STALE with the age, warn tone', () => {
    expect(frameHealthLabel({ ...available, lastFrameAge_s: 77879, freshestFrameAge_s: 77879, untimed: 0 }, 60)).toEqual({ text: 'STALE · FRAMES 21h OLD', tone: 'warn' });
    expect(frameHealthLabel({ ...available, camerasFailing: 1, freshestFrameAge_s: 77879 }, 60)).toEqual({ text: 'STALE · FRAMES 21h OLD · 1/5 WITHOUT FRAME', tone: 'warn' });
  });

  it('within 6 operator intervals (≥ 60 s each) → AVAILABLE; one second past → STALE', () => {
    expect(FRAME_RECENT_INTERVALS).toBe(6);
    expect(frameRecentS(30)).toBe(360);
    expect(frameRecentS(300)).toBe(1800);
    expect(frameHealthLabel({ ...available, freshestFrameAge_s: 360 }, 60).text).toBe('AVAILABLE');
    expect(frameHealthLabel({ ...available, freshestFrameAge_s: 361 }, 60)).toEqual({ text: 'STALE · FRAMES 6m OLD', tone: 'warn' });
    expect(frameHealthLabel({ ...available, freshestFrameAge_s: 1500 }, 300).text).toBe('AVAILABLE');
    expect(frameHealthLabel({ ...available, freshestFrameAge_s: 1801 }, 300).text).toBe('STALE · FRAMES 30m OLD');
  });

  it('the card and the viewer agree on the threshold (frameAge uses the same rule)', () => {
    const now = Date.parse('2026-10-01T12:00:00Z');
    for (const [ageS, cadence] of [[359, 60], [361, 60], [1799, 300], [1801, 300], [100, 10]] as const) {
      const viewer = frameAge(new Date(now - ageS * 1000).toISOString(), cadence, now).state;
      const card = frameHealthLabel({ ...available, freshestFrameAge_s: ageS }, cadence).tone;
      expect(card === 'ok', `${ageS}s @ ${cadence}s`).toBe(viewer === 'recent');
    }
  });

  it('frames without an operator time are RELAYED · UNTIMED, never green', () => {
    expect(frameHealthLabel({ ...available, lastFrameAge_s: null, freshestFrameAge_s: null, untimed: 3 }, 60)).toEqual({ text: 'RELAYED · UNTIMED', tone: 'idle' });
    expect(frameHealthLabel(available, 60)).toEqual({ text: 'RELAYED · UNTIMED', tone: 'idle' });
  });

  it('falls back to lastFrameAge_s from a server without freshestFrameAge_s', () => {
    expect(frameHealthLabel({ ...available, lastFrameAge_s: 77879 }, 60).tone).toBe('warn');
    expect(frameHealthLabel({ ...available, lastFrameAge_s: 40 }, 60).text).toBe('AVAILABLE');
  });

  it('failing / unavailable / inconclusive wording is unchanged by age', () => {
    expect(frameHealthLabel({ state: 'failing', cameras: 6, camerasFailing: 5, camerasOperatorFault: 4, freshestFrameAge_s: 10 }, 60).text).toBe('FAILING · 4/6 CAMERAS');
    expect(frameHealthLabel({ state: 'unavailable', cameras: 5, camerasFailing: 5, camerasOperatorFault: 5, freshestFrameAge_s: null }, 60).tone).toBe('error');
  });
});
