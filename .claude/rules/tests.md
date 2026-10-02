---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "e2e/**"
---
# Testing rules
- Vitest 5 (node env; add `// @vitest-environment jsdom` for DOM tests). Coverage ≥ 80 % lines in
  `src/lib`, `src/app/api`, `src/features/flight-paths`.
- Unit tests never hit the network: use recorded fixtures under `src/**/__fixtures__/` captured from a
  real probe (note the capture date in the file), a local `http.createServer`, or `vi.mock('@/lib/http')`.
- Live upstream checks go in `*.live.test.ts` guarded by `it.runIf(process.env.RUN_LIVE_TESTS === '1')`.
- Every route test validates the response against its zod schema and asserts `providers` + `meta`.
- Playwright: WebGL needs `--enable-unsafe-swiftshader`; mask clocks/tickers; `animations: 'disabled'`.
  In this sandbox run with `E2E_IGNORE_HTTPS_ERRORS=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`.
