import { defineConfig } from '@playwright/test';

/**
 * Visual-QA capture config (not part of `pnpm e2e`). Runs docs/screenshots/capture.spec.ts against an
 * already-running production build — it never starts or stops a server.
 *
 *   CAPTURE_BASE_URL=http://127.0.0.1:3000 PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium \
 *   E2E_IGNORE_HTTPS_ERRORS=1 pnpm exec playwright test -c docs/screenshots/playwright.config.ts
 *
 * Filter one area with `-g "<area>/"`, one viewport with `--project desktop|mobile`.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
const sandbox = process.env.E2E_IGNORE_HTTPS_ERRORS === '1';

export default defineConfig({
  testDir: '.',
  testMatch: /(capture|checks)\.spec\.ts$/,
  timeout: 180_000,
  fullyParallel: true,
  workers: Number(process.env.CAPTURE_WORKERS ?? 2),
  retries: 0,
  reporter: 'list',
  outputDir: process.env.CAPTURE_OUTPUT_DIR ?? '/tmp/godseye-capture-results',
  use: {
    baseURL: process.env.CAPTURE_BASE_URL ?? 'http://127.0.0.1:3000',
    ignoreHTTPSErrors: sandbox,
    reducedMotion: 'reduce',
    launchOptions: {
      executablePath,
      args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
      ...(sandbox && process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } } : {}),
    },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
  ],
});
