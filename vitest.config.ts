import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./src/test/empty.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'tools/**/*.test.ts'],
    exclude: ['node_modules/**', '.claude/worktrees/**', 'e2e/**'],
    // Live upstream tests are opt-in: RUN_LIVE_TESTS=1 pnpm test:live
    env: { NODE_ENV: 'test' },
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      include: ['src/lib/**', 'src/app/api/**', 'src/features/flight-paths/**'],
      exclude: ['**/*.test.*', '**/*.d.ts', 'src/lib/**/*.tsx'],
      thresholds: { lines: 80 },
    },
  },
});
