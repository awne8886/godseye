import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // eslint-plugin-react 7.37 calls context.getFilename() (removed in ESLint 10) only when
    // auto-detecting the React version, so pin it.
    settings: { react: { version: '19.3' } },
    rules: {
      // Honesty rule (§0.3): no randomised data in shipped code. Tests may use it.
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'GODSEYE never fabricates or jitters data. Use a deterministic value.' },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'e2e/**', 'tools/**'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    // Retry jitter in the HTTP client is timing, not data.
    files: ['src/lib/http.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'next-env.d.ts',
    'public/maplibre/**',
    '.claude/worktrees/**',
    'playwright-report/**',
    'test-results/**',
    '.lighthouseci/**',
  ]),
]);
