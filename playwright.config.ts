import { defineConfig, devices } from '@playwright/test';

/**
 * WebGL in headless Chrome needs SwiftShader explicitly (Chrome removed the automatic
 * fallback). Baselines are generated in the official Playwright Docker image in CI.
 * Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to use a preinstalled Chromium instead of the
 * revision bundled with @playwright/test (e.g. /opt/pw-browsers/chromium).
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
const port = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // No platform suffix: the §11 deck baselines (e2e/visual) are rendered by SwiftShader from fixed
  // fixtures with a pinned clock, and matched within 2 % on 3 consecutive runs (round 6).
  snapshotPathTemplate: '{testDir}/{testFileDir}/{testFileName}-snapshots/{arg}-{projectName}{ext}',
  expect: { timeout: 15_000, toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled' } },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    // Only for sandboxes whose egress proxy re-signs TLS (never set in CI).
    ignoreHTTPSErrors: process.env.E2E_IGNORE_HTTPS_ERRORS === '1',
    launchOptions: {
      executablePath,
      args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
      // Sandbox only: route browser tile/font fetches through the egress proxy (never in CI).
      ...(process.env.E2E_IGNORE_HTTPS_ERRORS === '1' && process.env.HTTPS_PROXY
        ? { proxy: { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } }
        : {}),
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: `pnpm start --port ${port}`,
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
