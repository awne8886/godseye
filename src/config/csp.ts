import { FRAME_HOSTS, IMAGE_HOSTS, MEDIA_HOSTS, TILE_HOSTS, type HostList } from './hosts';

export interface CspInput {
  dev: boolean;
  tiles?: HostList;
  frames?: HostList;
  images?: HostList;
  media?: HostList;
}

/**
 * Builds the Content-Security-Policy header value. `worker-src 'self' blob:` covers the
 * self-hosted MapLibre module worker (and MapLibre's same-origin blob shim). No WASM ships
 * (satellite.js runs its JS SGP4 path), so `'wasm-unsafe-eval'` is not granted.
 */
export function buildCsp({
  dev,
  tiles = TILE_HOSTS,
  frames = FRAME_HOSTS,
  images = IMAGE_HOSTS,
  media = MEDIA_HOSTS,
}: CspInput): string {
  const scriptSrc = ["'self'", "'unsafe-inline'"];
  if (dev) scriptSrc.push("'unsafe-eval'"); // React Refresh in `next dev` only
  const connect = ["'self'", ...tiles, ...media];
  if (dev) connect.push('ws:', 'wss:');
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': scriptSrc,
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', ...tiles, ...images],
    'font-src': ["'self'", 'data:'],
    'connect-src': connect,
    'media-src': ["'self'", 'blob:', ...media],
    'frame-src': [...frames],
    'worker-src': ["'self'", 'blob:'],
    'child-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'manifest-src': ["'self'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${[...new Set(v)].join(' ')}`);
  if (!dev) parts.push('upgrade-insecure-requests');
  return parts.join('; ');
}

export function securityHeaders(dev: boolean): { key: string; value: string }[] {
  return [
    { key: 'Content-Security-Policy', value: buildCsp({ dev }) },
    // `preload` is a commitment for the whole registrable domain: operators opt in explicitly.
    { key: 'Strict-Transport-Security', value: `max-age=63072000; includeSubDomains${process.env.HSTS_PRELOAD === 'true' ? '; preload' : ''}` },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    // Geolocation is consent-based (one-click prompt). Web Bluetooth has no Permissions-Policy token in Chrome.
    // Fullscreen is delegated to the youtube-nocookie players (SPACE, LIVE NEWS), whose iframes request it.
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), payment=(), usb=(), geolocation=(self), fullscreen=(self "https://www.youtube-nocookie.com")' },
  ];
}
