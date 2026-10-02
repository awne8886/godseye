import { expect, test, type Page } from '@playwright/test';
import { API_CATALOG, EXCLUDED_OSIRIS_ROUTES, upstreamsReceivingUserInput } from '../../src/lib/api-catalog';

/** Collects console errors and uncaught exceptions for the page's lifetime. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** The static pages scroll inside their own container (the map shell locks html/body). */
async function hasNoHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('body > div');
    const w = document.documentElement.clientWidth;
    return document.documentElement.scrollWidth <= w && (!scroller || scroller.scrollWidth <= scroller.clientWidth);
  });
}

async function expectKeyboardSkipLink(page: Page) {
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  const outline = await skip.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main')).toBeFocused();
  // The next Tab continues inside the main content, not back at the top of the page.
  await page.keyboard.press('Tab');
  const inMain = await page.evaluate(() => Boolean(document.activeElement?.closest('main')));
  expect(inMain).toBe(true);
}

test.describe('/docs', () => {
  test('renders the whole catalogue with landmarks and no console errors', async ({ page }) => {
    const errors = watchErrors(page);
    const res = await page.goto('/docs');
    expect(res?.status()).toBe(200);
    await expect(page).toHaveTitle(/API reference/);
    await expect(page.getByRole('heading', { level: 1, name: 'API reference' })).toBeVisible();
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('contentinfo')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Site' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'API sections' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'API reference' })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('main article')).toHaveCount(API_CATALOG.length);
    for (const r of EXCLUDED_OSIRIS_ROUTES) await expect(page.getByRole('rowheader', { name: r.path, exact: true })).toBeAttached();
    expect(await hasNoHorizontalOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('is keyboard navigable: skip link, section links, focus ring', async ({ page }) => {
    await page.goto('/docs');
    await expectKeyboardSkipLink(page);
    const toCapabilities = page.getByRole('navigation', { name: 'API sections' }).getByRole('link', { name: 'Capabilities' });
    await toCapabilities.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#capabilities$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Capabilities' })).toBeInViewport();
  });

  test('example links answer from this origin', async ({ page, request }) => {
    await page.goto('/docs');
    const href = await page.locator('main a[href="/api/health"]').first().getAttribute('href');
    expect(href).toBe('/api/health');
    const health = await request.get(href!);
    expect(health.ok()).toBe(true);
  });
});

test.describe('/docs interactive', () => {
  test('"Send request" calls this origin only and shows status, headers and body', async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const offOrigin: string[] = [];
    page.on('request', (r) => {
      if (r.resourceType() === 'fetch' && new URL(r.url()).origin !== origin) offOrigin.push(r.url());
    });
    await page.goto('/docs');
    await expect(page.locator('html[data-docs-interactive]')).toBeAttached();
    const card = page.locator('article#get-api-health');
    await card.getByRole('button', { name: 'Send request' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('GET /api/health', { exact: true })).toBeVisible();
    const answered = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/health');
    await dialog.getByRole('button', { name: 'Send request' }).click();
    const res = await answered;
    expect(new URL(res.url()).origin).toBe(origin);
    await expect(dialog.getByText(new RegExp(`^${res.status()} `))).toBeVisible();
    await expect(dialog.getByText(/Response headers \(\d+\)/)).toBeVisible();
    await expect(dialog.getByLabel('Response body')).toContainText('capabilities');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(offOrigin).toEqual([]);
  });

  test('the try-it form is pre-filled from the catalogue example and refuses missing required values', async ({ page }) => {
    await page.goto('/docs');
    await expect(page.locator('html[data-docs-interactive]')).toBeAttached();
    await page.locator('article#get-api-aircraft').getByRole('button', { name: 'Send request' }).click();
    const dialog = page.getByRole('dialog');
    const icao = dialog.getByLabel(/icao24/);
    await expect(icao).toHaveValue('4ca2b3');
    await expect(dialog.getByText('GET /api/aircraft?icao24=4ca2b3')).toBeVisible();
    await icao.fill('');
    await expect(dialog.getByText('icao24 is required.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Send request' })).toBeDisabled();
  });

  test('⌘K / Ctrl-K palette finds an endpoint and jumps to it', async ({ page }) => {
    await page.goto('/docs');
    await expect(page.locator('html[data-docs-interactive]')).toBeAttached();
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Search endpoints' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill('region dossier');
    await expect(palette.getByRole('option').first()).toContainText('/api/region-dossier');
    await page.keyboard.press('Enter');
    await expect(palette).toBeHidden();
    await expect(page).toHaveURL(/#get-api-region-dossier$/);
    await expect(page.locator('article#get-api-region-dossier')).toBeFocused();
    await expect(page.locator('article#get-api-region-dossier details')).toHaveAttribute('open', '');
  });

  test('reading progress and scroll-spy follow the scroll position', async ({ page }) => {
    await page.goto('/docs');
    await expect(page.locator('html[data-docs-interactive]')).toBeAttached();
    const bar = page.getByRole('progressbar', { name: 'Reading progress' });
    await expect(bar).toHaveAttribute('aria-valuenow', '0');
    const nav = page.getByRole('navigation', { name: 'API sections' });
    await nav.getByRole('link', { name: 'Capabilities' }).click();
    await expect(nav.getByRole('link', { name: 'Capabilities' })).toHaveAttribute('aria-current', 'location');
    await expect.poll(async () => Number(await bar.getAttribute('aria-valuenow'))).toBeGreaterThan(50);
  });
});

test.describe('/privacy', () => {
  test('lists every upstream that receives user input, with landmarks and no console errors', async ({ page }) => {
    const errors = watchErrors(page);
    const res = await page.goto('/privacy');
    expect(res?.status()).toBe(200);
    await expect(page).toHaveTitle(/Privacy/);
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible();
    await expect(page.getByRole('main')).toHaveCount(1);
    const table = page.getByRole('table', { name: /Upstream hosts that receive user input/ });
    const hosts = upstreamsReceivingUserInput();
    await expect(table.getByRole('rowheader')).toHaveCount(hosts.length);
    await expect(table.getByRole('rowheader').first()).toHaveText(hosts[0]!);
    await expect(page.getByRole('link', { name: 'camera notice', exact: true })).toHaveAttribute('href', '/cameras-notice');
    for (const name of ['Your location', 'AI analyst and your keys', 'Cookies, analytics and browser storage', 'What the server keeps', 'Responsible use']) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeAttached();
    }
    // The aircraft card's photo is a plain <img> from airport-data.com: the built page must say so.
    await expect(page.getByText(/Aircraft photos on the aircraft card load directly from airport-data\.com in your browser, with no referrer sent/)).toBeAttached();
    expect(await hasNoHorizontalOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('is keyboard navigable', async ({ page }) => {
    await page.goto('/privacy');
    await expectKeyboardSkipLink(page);
  });
});
