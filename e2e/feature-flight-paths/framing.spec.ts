import { expect, test, type Page } from '@playwright/test';
import { gotoMap, MAP, waitForMapIdle } from '../map-engine/helpers';

/**
 * Round 4 visual-qa m1/m2 (R3-m5 / R3-m9 remainders): a framed route keeps both endpoint dots and
 * their code labels clear of every HUD overlay — on a 390×844 phone (header, view controls, imagery
 * chips, the attribution lifted above the sheet, the sheet, the bottom nav) for LHR-JFK, SYD-SCL,
 * SIN-JFK and HEL-ANC, and on the desktop in mercator clear of the left rail.
 *
 * The app reports where it drew each endpoint dot and label (MapLibre's own projection of the
 * endpoint plus the label's pixel offset and pill size: `data-marks` on the flight-paths status
 * node, rewritten at every moveend). This spec measures the overlays itself from the DOM, and
 * checks the label pixels (`--map-airport-watch` hue) are really on screen inside each reported box.
 */
const status = (page: Page) => page.getByTestId('flight-paths-status');

type Box = [number, number, number, number];
interface MarkBox {
  label: string;
  kind: 'dot' | 'label';
  box: Box;
}

/** Overlays measured by this spec (independently of the app's own selector list). */
const OVERLAYS: Record<string, string> = {
  header: 'header.fixed',
  telemetry: '[aria-label="Telemetry"]',
  'view-controls': '[data-testid="view-controls"]',
  'layer rail': 'nav[aria-label="Map layers"]',
  'tool strip': 'nav[aria-label="Tools"]',
  'status bar': 'footer.fixed',
  'bottom nav': 'nav[aria-label="Main"]',
  sheet: '[data-testid="mobile-sheet"]',
  'imagery chip': '.godseye-imagery-chips li',
  attribution: '.maplibregl-ctrl-attrib',
  'readout row': '[data-readout-row]',
};

async function overlayBoxes(page: Page): Promise<{ name: string; box: Box }[]> {
  const boxes = await page.evaluate((sel) => {
    const out: { name: string; box: [number, number, number, number] }[] = [];
    for (const [name, s] of Object.entries(sel)) {
      for (const el of document.querySelectorAll(s)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) out.push({ name, box: [r.left, r.top, r.right, r.bottom] });
      }
    }
    // The docked PATHS panel (desktop).
    for (const h of document.querySelectorAll('h1,h2,h3')) {
      if (h.textContent?.trim() !== 'FLIGHT PATHS') continue;
      const r = (h.closest('section') ?? h).getBoundingClientRect();
      out.push({ name: 'PATHS panel', box: [r.left, r.top, r.right, r.bottom] });
    }
    return out;
  }, OVERLAYS);
  return boxes;
}

async function readMarks(page: Page): Promise<MarkBox[]> {
  const raw = await status(page).getAttribute('data-marks');
  return raw ? (JSON.parse(raw) as MarkBox[]) : [];
}

const overlaps = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/** '' when every mark is on screen and clear of every overlay, else what is wrong. */
async function problems(page: Page): Promise<string> {
  const marks = await readMarks(page);
  if (marks.length < 4) return `only ${marks.length} of 4 marks on screen`;
  const vp = page.viewportSize()!;
  const overlays = await overlayBoxes(page);
  const out: string[] = [];
  for (const m of marks) {
    if (m.box[0] < 0 || m.box[1] < 0 || m.box[2] > vp.width || m.box[3] > vp.height) out.push(`${m.label} ${m.kind} off screen ${m.box.join(',')}`);
    for (const o of overlays) if (overlaps(m.box, o.box)) out.push(`${m.label} ${m.kind} ${m.box.join(',')} under ${o.name} ${o.box.map(Math.round).join(',')}`);
  }
  return out.join('; ');
}

/**
 * Label pixels inside each reported label box (the label is drawn there, not hidden by chrome): a
 * 12 px code on its pill is anti-aliased into the dark glass, so a pixel counts when it has the
 * `--map-airport-watch` hue (direction of the RGB vector within ~10°) at ≥ 35 % of its brightness.
 */
async function labelPixels(page: Page): Promise<number[]> {
  const out: number[] = [];
  for (const m of (await readMarks(page)).filter((x) => x.kind === 'label')) {
    const [l, t, r, b] = m.box;
    const png = (await page.screenshot({ clip: { x: l, y: t, width: r - l, height: b - t } })).toString('base64');
    out.push(
      await page.evaluate(
        async ({ png, token }) => {
          const probe = document.createElement('i');
          probe.style.color = `var(${token})`;
          document.body.append(probe);
          const ref = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g)!.map(Number).slice(0, 3);
          probe.remove();
          const img = new Image();
          img.src = `data:image/png;base64,${png}`;
          await img.decode();
          const c = document.createElement('canvas');
          c.width = img.width;
          c.height = img.height;
          const ctx = c.getContext('2d')!;
          ctx.drawImage(img, 0, 0);
          const px = ctx.getImageData(0, 0, c.width, c.height).data;
          const refLen = Math.hypot(ref[0]!, ref[1]!, ref[2]!);
          let n = 0;
          for (let i = 0; i < px.length; i += 4) {
            const len = Math.hypot(px[i]!, px[i + 1]!, px[i + 2]!);
            if (len < refLen * 0.35) continue;
            const cos = (px[i]! * ref[0]! + px[i + 1]! * ref[1]! + px[i + 2]! * ref[2]!) / (len * refLen);
            if (cos >= 0.985) n++;
          }
          return n;
        },
        { png, token: '--map-airport-watch' },
      ),
    );
  }
  return out;
}

/** Load a route and wait until its framing has settled with every mark clear of every overlay. */
async function expectClearFraming(page: Page, route: string, proj: 'globe' | 'mercator', params: Record<string, string> = {}) {
  await gotoMap(page, { params: { route, proj, ...params } });
  await expect(status(page)).toHaveAttribute('data-route', route);
  await waitForMapIdle(page);
  await expect(status(page)).toHaveAttribute('data-fit', 'full', { timeout: 60_000 });
  // Re-framings after late chrome (sheet height, chips) settle within the 30 s watch.
  await expect.poll(() => problems(page), { timeout: 60_000, intervals: [1_000, 2_000, 3_000] }).toBe('');
  await expect(page.locator(MAP)).toHaveAttribute('data-camera-idle', 'true', { timeout: 30_000 });
  expect(await problems(page)).toBe('');
}

// Geometry with the default layers: the chrome the visual-qa saw (BLACK MARBLE chip, 3-line
// attribution lifted above the sheet, a BASEMAP chip whenever tiles are missing).
const PHONE_ROUTES = ['LHR-JFK', 'SYD-SCL', 'SIN-JFK', 'HEL-ANC'];

for (const route of PHONE_ROUTES) {
  test(`phone 390×844 · ${route} on the globe: endpoint dots and labels clear of the header, chips, attribution, sheet and nav (visual-qa m1)`, async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'phone layout');
    test.setTimeout(240_000);
    await expectClearFraming(page, route, 'globe');
    await page.screenshot({ path: info.outputPath(`framing-${route.toLowerCase()}-globe-mobile.png`), animations: 'disabled', mask: [page.locator('time')] });
  });
}

for (const [route, proj] of [
  ['LHR-JFK', 'mercator'],
  ['LHR-JFK', 'globe'],
  ['SYD-SCL', 'globe'],
] as const) {
  test(`desktop · ${route} (${proj}): endpoint labels clear of the left rail, view controls and the docked panel (visual-qa m2)`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'desktop layout');
    test.setTimeout(240_000);
    await expectClearFraming(page, route, proj);
    // The west end sits right of the 48 px rail with room to spare (R3-m9: JFK was at x 32–62).
    const rail = (await page.locator('nav[aria-label="Map layers"]').boundingBox())!;
    for (const m of await readMarks(page)) expect(m.box[0], `${m.label} ${m.kind}`).toBeGreaterThan(rail.x + rail.width);
    await page.screenshot({ path: info.outputPath(`framing-${route.toLowerCase()}-${proj}-desktop.png`), animations: 'disabled', mask: [page.locator('time'), page.locator('footer')] });
  });
}

// The reported boxes are where the labels really are. Black Marble city lights share the label's
// amber hue (69 matching px in an empty JFK box on 2026-10-01), so this runs with no data layers
// (`?layers=`): the only amber on the map is then the route's own endpoint rings and labels.
for (const proj of ['globe', 'mercator'] as const) {
  test(`LHR-JFK (${proj}, no data layers): the endpoint labels are drawn inside the reported boxes`, async ({ page }, info) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ reducedMotion: 'reduce' }); // no pulse rings crossing the boxes
    await expectClearFraming(page, 'LHR-JFK', proj, { layers: '' });
    await expect.poll(async () => Math.min(...(await labelPixels(page))), { timeout: 120_000, intervals: [2_000, 4_000] }).toBeGreaterThan(12);
    await page.screenshot({ path: info.outputPath(`labels-lhr-jfk-${proj}-${info.project.name}.png`), animations: 'disabled', mask: [page.locator('time')] });
  });
}
