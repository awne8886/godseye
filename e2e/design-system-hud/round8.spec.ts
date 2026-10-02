import { expect, test, type Page } from '@playwright/test';

/**
 * design-system-hud, Phase 3 round 8 MAJOR. On a landscape phone (844×390) an open sheet pushed the
 * map's bottom-right stack (imagery chips + attribution) into the header row: the attribution ran
 * under the view bar (§7: always visible) and the BASEMAP chip over the STATUS telemetry. With a
 * sheet open the stack now keeps to the column right of the view bar and below the telemetry.
 * Each test sets its own viewport and runs once (desktop project).
 */
test.describe.configure({ timeout: 180_000 });

async function boot(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('status', { name: /loading/i })).toBeHidden({ timeout: 45_000 });
}

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The element painted at the centre of the attribution's first and last glyphs. */
async function creditGlyphsOnTop(page: Page) {
  return page.evaluate(() => {
    const inner = document.querySelector('.maplibregl-ctrl-attrib-inner');
    if (!inner) return null;
    const texts: Text[] = [];
    const walker = document.createTreeWalker(inner, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent?.trim()) texts.push(n as Text);
    const probe = (t: Text, i: number) => {
      const r = document.createRange();
      r.setStart(t, i);
      r.setEnd(t, i + 1);
      const b = r.getBoundingClientRect();
      const x = b.left + b.width / 2;
      const y = b.top + b.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, onTop: !!hit?.closest('.maplibregl-ctrl-attrib'), hit: hit ? `${hit.tagName}.${String(hit.className).slice(0, 60)}` : null };
    };
    const first = texts[0]!;
    const last = texts[texts.length - 1]!;
    return {
      text: inner.textContent ?? '',
      first: probe(first, first.textContent!.search(/\S/)),
      last: probe(last, last.textContent!.trimEnd().length - 1),
    };
  });
}

/** Chips in the map's bottom-right stack, as far as they are painted (clipped by their control). */
async function visibleChipBoxes(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.maplibregl-ctrl-bottom-right [data-map-inset="imagery-chip"], .maplibregl-ctrl-bottom-right .godseye-radar-chip')]
      .map((el) => {
        const r = el.getBoundingClientRect();
        const c = (el.closest('.maplibregl-ctrl') ?? el).getBoundingClientRect();
        const x = Math.max(r.left, c.left);
        const y = Math.max(r.top, c.top);
        return { id: el.dataset.testid ?? el.className, x, y, width: Math.min(r.right, c.right) - x, height: Math.min(r.bottom, c.bottom) - y };
      })
      .filter((b) => b.width > 0 && b.height > 0),
  );
}

test.describe('landscape phone 844x390 with a sheet open', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  for (const [name, path] of [
    ['default layers', '/?panel=layers'],
    ['night lights + true colour + terrain', '/?layers=day_night,gibs_truecolor,terrain_3d,terrain_elevation&panel=layers'],
  ] as const) {
    test(`r8 M: the credits stay on top and no chip reaches the telemetry (${name})`, async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop', 'sets its own viewport; once');
      await boot(page, path);
      await expect(page.getByTestId('mobile-sheet')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-sheet-occupied', '');
      const attrib = page.locator('.maplibregl-ctrl-attrib');
      await expect(attrib).toBeVisible({ timeout: 60_000 });
      await expect(attrib).toContainText('OpenStreetMap', { timeout: 60_000 });
      // The sheet's spring and the chips settle.
      await page.waitForTimeout(1500);

      const glyphs = (await creditGlyphsOnTop(page))!;
      expect(glyphs, 'attribution rendered').not.toBeNull();
      expect(glyphs.first.onTop, `first glyph covered by ${glyphs.first.hit}`).toBe(true);
      expect(glyphs.last.onTop, `last glyph covered by ${glyphs.last.hit}`).toBe(true);

      const telemetry = (await page.locator('[data-map-inset="telemetry"]').boundingBox())!;
      const viewBar = (await page.getByTestId('view-controls').boundingBox())!;
      const header = (await page.locator('header[data-map-inset="header"]').boundingBox())!;
      const sheet = (await page.getByTestId('mobile-sheet').boundingBox())!;
      const credits = (await attrib.boundingBox())!;
      for (const [label, b] of [['telemetry', telemetry], ['view bar', viewBar], ['header', header]] as const) expect(overlaps(credits, b), `credits vs ${label}`).toBe(false);
      expect(credits.y + credits.height, 'credits above the sheet').toBeLessThanOrEqual(sheet.y);

      const chips = await visibleChipBoxes(page);
      expect(chips.length, 'at least one chip is painted').toBeGreaterThan(0);
      for (const c of chips) {
        expect(overlaps(c, telemetry), `${c.id} vs telemetry`).toBe(false);
        expect(overlaps(c, viewBar), `${c.id} vs view bar`).toBe(false);
        expect(c.y, `${c.id} on screen`).toBeGreaterThanOrEqual(0);
        expect(c.y + c.height, `${c.id} above the sheet`).toBeLessThanOrEqual(sheet.y);
      }
      await info.attach(`landscape-${name}.png`, { body: await page.screenshot(), contentType: 'image/png' });
    });
  }

  test('r8 M: with the sheet closed the stack returns to the full-width bottom corner', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'sets its own viewport; once');
    await boot(page, '/?panel=layers');
    const attrib = page.locator('.maplibregl-ctrl-attrib');
    await expect(attrib).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('mobile-sheet').getByRole('button', { name: /close/i }).first().click();
    await expect(page.getByTestId('mobile-sheet')).toBeHidden();
    await expect(page.locator('html')).not.toHaveAttribute('data-sheet-occupied', /.*/);
    const stack = (await page.locator('.maplibregl-ctrl-bottom-right').boundingBox())!;
    expect(stack.x).toBe(0);
    const glyphs = (await creditGlyphsOnTop(page))!;
    expect(glyphs.first.onTop, `first glyph covered by ${glyphs.first.hit}`).toBe(true);
  });
});

test.describe('portrait phone 390x844 with a sheet open (unchanged)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('r8 M: the stack stays full width above the sheet', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'sets its own viewport; once');
    await boot(page, '/?panel=layers');
    await expect(page.locator('.maplibregl-ctrl-attrib')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1000);
    const stack = (await page.locator('.maplibregl-ctrl-bottom-right').boundingBox())!;
    expect(stack.x).toBe(0);
    const glyphs = (await creditGlyphsOnTop(page))!;
    expect(glyphs.first.onTop, `first glyph covered by ${glyphs.first.hit}`).toBe(true);
    expect(glyphs.last.onTop, `last glyph covered by ${glyphs.last.hit}`).toBe(true);
  });
});
