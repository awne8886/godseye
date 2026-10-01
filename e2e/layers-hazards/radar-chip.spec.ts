import { expect, test, type Page } from '@playwright/test';
import { openMap } from './helpers';

/**
 * visual-qa round 4 M2: the weather-radar frame time (the radar's only observed time) must be
 * legible. It sits in MapLibre's bottom-right control stack with the imagery chips and the
 * attribution, so at 390×844 (mobile project) and 1600×1000 (desktop project) its box intersects
 * none of: attribution, imagery chips, bottom nav, status bar, layer rail, tool rail, view
 * controls, readout/hint row, telemetry or any other [data-map-inset] chrome, and keeps ≥ 8 px from
 * each (the HUD grid). Runs against the live /api/weather-radar; SOURCE OFFLINE skips (asserted).
 */

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

async function liveFrames(page: Page): Promise<string[] | null> {
  const res = await page.request.get('/api/weather-radar');
  const body = await res.json();
  if (res.status() === 503) {
    expect(body.error).toBe('source_offline');
    expect(body.providers.rainviewer.ok).toBe(false);
    return null;
  }
  expect(res.ok()).toBe(true);
  expect(body.providers.rainviewer.ok).toBe(true);
  return (body.frames as { time: string }[]).map((f) => f.time);
}

/** Visible boxes of the chip and of every piece of chrome it must stay clear of. */
async function chromeBoxes(page: Page): Promise<{ chip: Box | null; viewport: { w: number; h: number }; others: Record<string, Box> }> {
  return page.evaluate(() => {
    const vis = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
    };
    const box = (el: Element | null): Box | null => {
      if (!el || !vis(el)) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const q = (s: string) => document.querySelector(s);
    const chipEl = q('[data-testid="radar-frame-chip"]');
    const others: Record<string, Box | null> = {
      attribution: box(q('.maplibregl-ctrl-attrib')),
      mobileNav: box(q('nav[aria-label="Main"]')),
      statusBar: box(q('footer')),
      layerRail: box(q('nav[aria-label="Map layers"]')),
      toolRail: box(q('nav[aria-label="Tools"]')),
      viewControls: box(q('[data-testid="view-controls"]')),
      readoutRow: box(q('[data-testid="readout-row"]')),
      telemetry: box(q('[aria-label="Telemetry"]')),
    };
    // The hint span is truncated: measure its text run.
    const hint = q('[data-testid="view-hint"]');
    if (hint && vis(hint)) {
      const range = document.createRange();
      range.selectNodeContents(hint);
      const t = range.getBoundingClientRect();
      const b = hint.getBoundingClientRect();
      others.hint = { x: b.x, y: b.y, w: Math.min(t.width, b.width), h: b.height };
    }
    document.querySelectorAll('[data-testid^="imagery-chip-"]').forEach((el) => {
      others[el.getAttribute('data-testid')!] = box(el);
    });
    document.querySelectorAll('[data-map-inset]').forEach((el) => {
      if (chipEl && el.contains(chipEl)) return;
      others[`inset:${el.getAttribute('data-map-inset')}`] = box(el);
    });
    const kept: Record<string, Box> = {};
    for (const [k, v] of Object.entries(others)) if (v) kept[k] = v;
    return { chip: box(chipEl), viewport: { w: window.innerWidth, h: window.innerHeight }, others: kept };
  });
}

/** Gap between two boxes along the axis that separates them (negative = they intersect). */
function gap(a: Box, b: Box): number {
  const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  return Math.max(dx, dy);
}

test('the radar frame time stays clear of attribution, nav, rails, chips and hints', async ({ page }) => {
  test.setTimeout(180_000);
  const frames = await liveFrames(page);
  test.skip(frames === null, 'RainViewer offline right now: /api/weather-radar answered SOURCE OFFLINE (asserted)');
  expect(frames!.length).toBeGreaterThan(0);
  // Same view as the visual-qa capture; day_night adds the BLACK MARBLE chip to the same stack.
  await openMap(page, 'layers=weather_radar,day_night&c=10,-80,2');
  const chip = page.getByTestId('radar-frame-chip');
  await expect(chip).toBeVisible({ timeout: 30_000 });

  // The chip names an observed RainViewer frame (minute precision, UTC).
  const label = (await chip.textContent()) ?? '';
  const m = label.match(/^RADAR · RAINVIEWER · (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) UTC$/);
  expect(m, label).not.toBeNull();
  expect(frames!.map((t) => `${t.slice(0, 10)} ${t.slice(11, 16)}`)).toContain(`${m![1]} ${m![2]}`);
  // It joined MapLibre's bottom-right stack (placed by the HUD safe areas), not a free overlay.
  expect(await chip.evaluate((el) => el.closest('.maplibregl-ctrl-bottom-right') !== null)).toBe(true);

  // Let late chrome (imagery chips, attribution credits, hint) settle before measuring.
  await page.waitForTimeout(2000);
  const { chip: c, viewport, others } = await chromeBoxes(page);
  expect(c).not.toBeNull();
  expect(c!.x).toBeGreaterThanOrEqual(0);
  expect(c!.y).toBeGreaterThanOrEqual(0);
  expect(c!.x + c!.w).toBeLessThanOrEqual(viewport.w);
  expect(c!.y + c!.h).toBeLessThanOrEqual(viewport.h);
  expect(Object.keys(others)).toContain('attribution');
  const tooClose = Object.entries(others)
    .filter(([, b]) => gap(c!, b) < 8)
    .map(([k, b]) => `${k} gap ${gap(c!, b).toFixed(1)} px (chip ${JSON.stringify(c)} vs ${JSON.stringify(b)})`);
  // Evidence for review (test output dir, also attached to the report).
  const shot = test.info().outputPath('radar-chip.png');
  await page.screenshot({ path: shot, animations: 'disabled' });
  await test.info().attach('radar-chip', { path: shot, contentType: 'image/png' });
  expect(tooClose).toEqual([]);
});
