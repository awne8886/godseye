import { expect, test, type Page } from '@playwright/test';
import { gotoMap, MAP, readCamera, waitForMapIdle } from '../map-engine/helpers';

/**
 * Round 4 visual-qa m1/m2 (R3-m5 / R3-m9 remainders): a framed route keeps both endpoint dots and
 * their code labels clear of every HUD overlay — on a 390×844 phone (header, view controls, imagery
 * chips, the attribution lifted above the sheet, the sheet, the bottom nav) for LHR-JFK, SYD-SCL,
 * SIN-JFK and HEL-ANC, and on the desktop in mercator clear of the left rail. A route that cannot
 * be framed clear on a phone (PER-LHR) says which endpoint the chrome covers. The framing never
 * pulls the camera back after the viewer flies elsewhere (round 4 fix pass).
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

/** Every mark that is off screen or under an overlay (by this spec's own measurements). */
async function problemList(page: Page): Promise<{ label: string; text: string }[]> {
  const marks = await readMarks(page);
  const vp = page.viewportSize()!;
  const overlays = await overlayBoxes(page);
  const out: { label: string; text: string }[] = [];
  for (const m of marks) {
    if (m.box[0] < 0 || m.box[1] < 0 || m.box[2] > vp.width || m.box[3] > vp.height) out.push({ label: m.label, text: `${m.label} ${m.kind} off screen ${m.box.join(',')}` });
    for (const o of overlays) if (overlaps(m.box, o.box)) out.push({ label: m.label, text: `${m.label} ${m.kind} ${m.box.join(',')} under ${o.name} ${o.box.map(Math.round).join(',')}` });
  }
  return out;
}

/** '' when every mark is on screen and clear of every overlay, else what is wrong. */
async function problems(page: Page): Promise<string> {
  const marks = await readMarks(page);
  if (marks.length < 4) return `only ${marks.length} of 4 marks on screen`;
  return (await problemList(page)).map((p) => p.text).join('; ');
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

// Round 5 visual-qa MAJOR-2: on the desktop globe the framing maximised the zoom with no limb
// constraint, so a long route's far end sat on the horizon (SVO→LAX: LAX on the limb under the
// atmosphere, its pill dimmed; SYD→SCL: SYD likewise) while `data-marks` still called it clear.
// Geometry: the central angle from the camera's ground point (`data-far-side`) to each endpoint is
// ≤ 60° and ≥ 12° inside the horizon (acos(R / (R + camera altitude))). Pixels: both code labels are
// drawn at full strength inside their reported boxes (no data layers, so the only amber is the route's).
const EARTH_KM = 6371.0088;
const D2R = Math.PI / 180;
const centralDeg = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const h = Math.sin(((b.lat - a.lat) * D2R) / 2) ** 2 + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(((b.lng - a.lng) * D2R) / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(h)))) / D2R;
};

for (const route of ['SVO-LAX', 'SYD-SCL'] as const) {
  test(`desktop · ${route} on the globe: both endpoints well inside the visible hemisphere, labels drawn (round 5 visual-qa M2)`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'desktop layout (1600×1000)');
    test.setTimeout(240_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expectClearFraming(page, route, 'globe', { layers: '' });
    const [from, to] = route.split('-');
    const plan = (await (await page.request.get(`/api/route/plan?from=${from}&to=${to}`)).json()) as { origin: { lat: number; lng: number; iata: string }; destination: { lat: number; lng: number; iata: string } };
    const raw = await page.locator(MAP).getAttribute('data-far-side');
    expect(raw).toMatch(/^-?\d/);
    const [lng, lat, altM] = raw!.split(',').map(Number) as [number, number, number];
    const horizon = Math.acos(EARTH_KM / (EARTH_KM + altM / 1000)) / D2R;
    for (const e of [plan.origin, plan.destination]) {
      const deg = centralDeg({ lat, lng }, e);
      expect(deg, `${e.iata} ${deg.toFixed(1)}° from the camera`).toBeLessThanOrEqual(60.5);
      expect(horizon - deg, `${e.iata} ${deg.toFixed(1)}° vs horizon ${horizon.toFixed(1)}°`).toBeGreaterThanOrEqual(11.5);
    }
    await expect.poll(async () => Math.min(...(await labelPixels(page))), { timeout: 120_000, intervals: [2_000, 4_000] }).toBeGreaterThan(12);
    await page.screenshot({ path: info.outputPath(`limb-${route.toLowerCase()}-globe-desktop.png`), animations: 'disabled', mask: [page.locator('time'), page.locator('footer')] });
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

// Round 4 fix pass: a long north-south route on a phone may have no framing that keeps both ends
// clear of the chrome. Then one end is kept clear and PATHS names the covered one; an endpoint
// under chrome is never left unannounced.
test('phone 390×844 · PER-LHR on the globe: framed clear, or PATHS names every endpoint the chrome covers', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'phone layout');
  test.setTimeout(240_000);
  await gotoMap(page, { params: { route: 'PER-LHR', proj: 'globe' } });
  await expect(status(page)).toHaveAttribute('data-route', 'PER-LHR');
  await waitForMapIdle(page);
  await expect(status(page)).toHaveAttribute('data-fit', /^full(-obscured)?$/, { timeout: 60_000 });
  await expect(page.locator(MAP)).toHaveAttribute('data-camera-idle', 'true', { timeout: 30_000 });
  // Let the chrome settle (sheet height, attribution, chips) and the post-framing check publish.
  await page.waitForTimeout(3_000);
  await expect(page.locator(MAP)).toHaveAttribute('data-camera-idle', 'true', { timeout: 30_000 });
  const marks = await readMarks(page);
  expect(marks.length, 'both endpoints in front of the horizon').toBe(4);
  const covered = [...new Set((await problemList(page)).map((p) => p.label))];
  const fit = await status(page).getAttribute('data-fit');
  const note = page.getByTestId('paths-fit-obscured');
  if (covered.length === 0) {
    expect(fit).toBe('full');
    await expect(note).toHaveCount(0);
  } else {
    expect(fit, `covered: ${covered.join(', ')}`).toBe('full-obscured');
    await expect(note).toBeVisible();
    for (const code of covered) await expect(note).toContainText(code);
    expect(covered.length, 'one end is kept clear').toBeLessThan(2);
  }
  await page.screenshot({ path: info.outputPath('framing-per-lhr-globe-mobile.png'), animations: 'disabled', mask: [page.locator('time')] });
});

// Round 4 fix pass (BLOCKING): a fly the viewer asks for within the 30 s chrome watch (palette
// "Fly to EAST ASIA") ends the framing; the BASEMAP LOADING/INCOMPLETE chip that follows on the new
// area, and a window resize, must not pull the camera back to the route.
for (const proj of ['globe', 'mercator'] as const) {
  test(`desktop · LHR-JFK (${proj}): a palette fly-to right after the framing is not undone by the chrome watch`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'the command palette is a keyboard flow (desktop)');
    test.setTimeout(240_000);
    await expectClearFraming(page, 'LHR-JFK', proj);
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await page.keyboard.type('Fly to EAST ASIA');
    await palette.getByRole('option', { name: /Fly to EAST ASIA/ }).click();
    await expect(palette).toBeHidden();
    const nearEastAsia = async () => {
      const c = await readCamera(page);
      return !!c && Math.abs(c.lng - 120) < 15 && Math.abs(c.lat - 35) < 15;
    };
    await expect.poll(nearEastAsia, { timeout: 30_000 }).toBe(true);
    // Through the chips that appear over the new area, then a window resize: still over East Asia.
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(1_000);
      expect(await nearEastAsia(), `camera ${JSON.stringify(await readCamera(page))} after ${i + 1} s`).toBe(true);
    }
    await page.setViewportSize({ width: 1500, height: 1000 });
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(1_000);
      expect(await nearEastAsia(), `camera ${JSON.stringify(await readCamera(page))} after the resize`).toBe(true);
    }
  });
}

/**
 * Round 7: on the globe the lifted planned arc used to climb vertically at each end (deck
 * ArcLayer's √(t(1−t)) paraboloid), which projected ~45 px past LHR so the gold route seemed to run
 * on toward Belgium. Count `--map-route-planned` pixels in a band leaving each endpoint (outside
 * every endpoint dot/label box): toward the other end there is route (control), beyond the
 * endpoint there is none. No data layers and reduced motion, so nothing else is drawn in gold.
 */
async function routeBandPixels(page: Page, from: Box, to: Box, marks: Box[]): Promise<{ toward: number; beyond: number }> {
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(
    async ({ png, from, to, marks, token }) => {
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
      const scale = img.width / window.innerWidth;
      const refLen = Math.hypot(ref[0]!, ref[1]!, ref[2]!);
      const cx = (b: number[]) => (b[0]! + b[2]!) / 2;
      const cy = (b: number[]) => (b[1]! + b[3]!) / 2;
      const ax = cx(from);
      const ay = cy(from);
      let dx = cx(to) - ax;
      let dy = cy(to) - ay;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const inMark = (x: number, y: number) => marks.some((b) => x >= b[0]! - 3 && x <= b[2]! + 3 && y >= b[1]! - 3 && y <= b[3]! + 3);
      const gold = (x: number, y: number) => {
        const i = (Math.round(y * scale) * c.width + Math.round(x * scale)) * 4;
        const l = Math.hypot(px[i]!, px[i + 1]!, px[i + 2]!);
        if (!(l >= refLen * 0.2)) return false;
        return (px[i]! * ref[0]! + px[i + 1]! * ref[1]! + px[i + 2]! * ref[2]!) / (l * refLen) >= 0.993;
      };
      // A band ±8 px wide on each side of the endpoint along the screen direction to the other end:
      // 120 px toward it (the route, the control), 60 px beyond it (the round-7 overshoot was ~45 px).
      const count = (sign: number) => {
        let n = 0;
        for (let s = 4; s <= (sign > 0 ? 124 : 64); s++)
          for (let w = -8; w <= 8; w++) {
            const x = ax + sign * dx * s - dy * w;
            const y = ay + sign * dy * s + dx * w;
            if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight || inMark(x, y)) continue;
            if (gold(x, y)) n++;
          }
        return n;
      };
      return { toward: count(1), beyond: count(-1) };
    },
    { png, from, to, marks, token: '--map-route-planned' },
  );
}

test('desktop · LHR-JFK on the globe (no data layers): the planned arc ends at its endpoints, never beyond them (round 7)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one viewport is enough for the profile');
  test.setTimeout(240_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expectClearFraming(page, 'LHR-JFK', 'globe', { layers: '' });
  await page.waitForTimeout(1_500);
  const marks = await readMarks(page);
  const dot = (code: string) => marks.find((m) => m.label === code && m.kind === 'dot')!.box;
  const all = marks.map((m) => m.box);
  const lhr = await routeBandPixels(page, dot('LHR'), dot('JFK'), all);
  const jfk = await routeBandPixels(page, dot('JFK'), dot('LHR'), all);
  console.log(`route band pixels: LHR ${JSON.stringify(lhr)} JFK ${JSON.stringify(jfk)}`);
  await page.screenshot({ path: info.outputPath('route-ends-globe.png'), animations: 'disabled', mask: [page.locator('time')] });
  // Matched aircraft rings near an endpoint are amber (--map-flight-watch), a hue this filter rejects;
  // their anti-aliased edges can still leave a stray pixel or two.
  for (const [code, b] of [['LHR', lhr], ['JFK', jfk]] as const) {
    expect(b.toward, `the route leaves ${code}`).toBeGreaterThan(8);
    expect(b.beyond, `route pixels beyond ${code} (toward ${b.toward})`).toBeLessThanOrEqual(Math.max(3, Math.floor(b.toward / 8)));
  }
});
