import path from 'node:path';
import type { NextConfig } from 'next';
import { securityHeaders } from './src/config/csp';
import { IMAGE_HOSTS } from './src/config/hosts';

const dev = process.env.NODE_ENV !== 'production';

const nextConfig: NextConfig = {
  // Docker/self-host is the primary target; Vercel builds its own artefacts.
  output: process.env.VERCEL ? undefined : 'standalone',
  reactStrictMode: true,
  // `next dev` would otherwise write its own agent rules into CLAUDE.md (lead-owned).
  agentRules: false,
  poweredByHeader: false,
  // Type errors must fail the build (OSIRIS shipped with this off).
  typescript: { ignoreBuildErrors: false },
  serverExternalPackages: ['ioredis'],
  // Recorded upstream fixtures, worktrees and coverage are test material, never part of the server image.
  outputFileTracingExcludes: { '*': ['**/__fixtures__/**', '.claude/**', 'coverage/**', 'test-results/**', 'playwright-report/**'] },
  turbopack: {
    // satellite.js 7.1's pthreads WASM build spawns itself as a Worker, which hangs Turbopack's
    // build; GODSEYE uses the single-threaded path, so the multi-thread entry resolves to nothing.
    resolveAlias: { '#wasm-multi-thread': './src/test/empty.ts' },
    rules: {
      // See tools/maplibre-url-loader.cjs: keep MapLibre's runtime worker URL a runtime URL.
      'maplibre-gl.mjs': {
        loaders: [path.join(process.cwd(), 'tools/maplibre-url-loader.cjs')],
        as: '*.js',
      },
    },
  },
  images: {
    // Exact hosts only (never '**'). AVIF optimisation stays off (Next < 16.3.3 AVIF RCE class).
    formats: ['image/webp'],
    // The optimiser re-checks redirects for private IPs but not against remotePatterns: follow none.
    maximumRedirects: 0,
    remotePatterns: IMAGE_HOSTS.map((h) => {
      const u = new URL(h);
      return { protocol: 'https' as const, hostname: u.hostname, pathname: u.pathname === '/' ? '/**' : `${u.pathname}**` };
    }),
  },
  async headers() {
    return [
      {
        // The version is in the path, so contents never change for a given URL.
        source: '/maplibre/:version/:file*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      { source: '/(.*)', headers: securityHeaders(dev) },
    ];
  },
};

export default nextConfig;
