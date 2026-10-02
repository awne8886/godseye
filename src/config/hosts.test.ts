import { describe, expect, it } from 'vitest';
import { buildCsp } from './csp';
import { FRAME_HOSTS, IMAGE_HOSTS, MEDIA_HOSTS, TILE_HOSTS } from './hosts';

const ALL = [...TILE_HOSTS, ...FRAME_HOSTS, ...IMAGE_HOSTS, ...MEDIA_HOSTS];

describe('browser host allow-lists', () => {
  it('are https origins or directory prefixes, never catch-alls', () => {
    for (const h of ALL) {
      const u = new URL(h);
      expect(u.protocol, h).toBe('https:');
      expect(u.search + u.hash, h).toBe('');
      expect(u.hostname, h).not.toMatch(/^\*+$|^\*\.[a-z]+$/); // no '*' or '*.com'
      if (u.pathname !== '/') expect(h.endsWith('/'), `${h} path must end with '/'`).toBe(true);
    }
  });

  it('scopes shared cloud hosts to one bucket or path', () => {
    for (const h of ALL) {
      const u = new URL(h);
      if (/(^|\.)amazonaws\.com$/.test(u.hostname) || u.hostname === 'server.arcgisonline.com') expect(u.pathname.length, h).toBeGreaterThan(1);
    }
  });

  it('puts every list into the matching CSP directive', () => {
    const csp = Object.fromEntries(
      buildCsp({ dev: false })
        .split('; ')
        .map((d) => {
          const [k, ...v] = d.split(' ');
          return [k, v];
        }),
    ) as Record<string, string[]>;
    for (const h of TILE_HOSTS) {
      expect(csp['connect-src']).toContain(h);
      expect(csp['img-src']).toContain(h);
    }
    for (const h of IMAGE_HOSTS) expect(csp['img-src']).toContain(h);
    for (const h of MEDIA_HOSTS) expect(csp['media-src']).toContain(h);
    for (const h of FRAME_HOSTS) expect(csp['frame-src']).toContain(h);
    expect(csp['frame-ancestors']).toEqual(["'none'"]);
    expect(csp['script-src']).not.toContain("'unsafe-eval'");
    // No WASM ships (satellite.js runs its JS SGP4 path): the policy must not grant WASM compilation.
    expect(csp['script-src']).not.toContain("'wasm-unsafe-eval'");
    expect(buildCsp({ dev: true })).toContain("'unsafe-eval'");
  });
});
