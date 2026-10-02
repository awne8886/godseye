import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalogEntry } from '@/lib/api-catalog';
import { CCTV_REGIONS } from '@/features/surveillance/shared';
import {
  CAPABILITY_GATED,
  ROUTES,
  buildIdsIn,
  cctvRegions,
  chunkAssets,
  readLocalBuild,
  staleBuildProblem,
  statusProblem,
  verifyServedBuild,
  // @ts-expect-error plain ESM tool without types
} from './payload-sizes.mjs';

/** `/` as served by `next start` for build eIraUHkN6YrwAufQlhrdU (recorded 2026-10-02). */
const BUILD_ID = 'eIraUHkN6YrwAufQlhrdU';
const HTML = readFileSync(join(__dirname, 'fixtures', `home-${BUILD_ID}.html`), 'utf8');
const RECORDED_CHUNKS = [
  '3iusq7vs3r5c4.css', '05cr92-yr1l9c.js', '14m2ely06sm_e.js', '26-3f-vvat83b.js', '3p-zyavfh2xow.js',
  'turbopack-3pfx41ydsexp9.js', '2v3exkbn35rzq.js', '1wqc7efqcvoak.js', '05dcjrn8h1t0v.js', '152a4vancxwag.js',
  '2kpk3cu475pr9.js', '0cp0tewbbahm0.js', '1_8-2bgccn2l6.js', '0cz1d0mv5g_q7.js',
];

describe('payload-sizes.mjs refuses to measure a server that is not running this build', () => {
  const current = { localChunks: new Set(RECORDED_CHUNKS), localBuildId: BUILD_ID };

  it('reads the chunk assets and the flight-payload build id from a real page', () => {
    expect(chunkAssets(HTML).sort()).toEqual([...RECORDED_CHUNKS].sort());
    expect(buildIdsIn(HTML)).toEqual([BUILD_ID]);
    expect(buildIdsIn('<script src="/_next/static/OLDBUILD01/_buildManifest.js">')).toEqual(['OLDBUILD01']);
  });

  it('accepts the page of the current build', () => {
    expect(staleBuildProblem({ status: 200, html: HTML, ...current })).toBeNull();
  });

  it('rejects an old server whose chunks are not in the local build (the round-7 false green)', () => {
    const rebuilt = { localChunks: new Set(['0newchunkaaaa.js', 'turbopack-0newruntime.js']), localBuildId: 'NEWBUILDxxxxxxxxxxxxx' };
    expect(staleBuildProblem({ status: 200, html: HTML, ...rebuilt })).toMatch(/server is not serving this build: 14\/14 chunk/);
  });

  it('rejects a page naming another build id even when the chunk hashes happen to match', () => {
    expect(staleBuildProblem({ status: 200, html: HTML, ...current, localBuildId: 'NEWBUILDxxxxxxxxxxxxx' })).toMatch(`names build id ${BUILD_ID}`);
  });

  it('rejects a page it cannot attribute (error status, no chunks, no build id)', () => {
    expect(staleBuildProblem({ status: 500, html: HTML, ...current })).toMatch(/GET \/ answered 500/);
    expect(staleBuildProblem({ status: 0, html: '', ...current })).toMatch(/no response/);
    expect(staleBuildProblem({ status: 200, html: '<html></html>', ...current })).toMatch(/no \/_next\/static\/chunks/);
    const noId = HTML.replaceAll(BUILD_ID, '');
    expect(staleBuildProblem({ status: 200, html: noId, ...current })).toMatch(/names no build id/);
  });

  describe('against a running server and a dist directory', () => {
    let dist: string;
    let server: Server;
    let base: string;
    let assetStatus = 200;
    beforeAll(async () => {
      dist = mkdtempSync(join(tmpdir(), 'payload-dist-'));
      mkdirSync(join(dist, 'static', 'chunks'), { recursive: true });
      for (const c of RECORDED_CHUNKS) writeFileSync(join(dist, 'static', 'chunks', c), '');
      writeFileSync(join(dist, 'BUILD_ID'), `${BUILD_ID}\n`);
      server = createServer((req, res) => {
        if (req.url === '/') res.writeHead(200, { 'content-type': 'text/html' }).end(HTML);
        else res.writeHead(req.url?.startsWith('/_next/static/chunks/') ? assetStatus : 404).end();
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      const addr = server.address();
      base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    });
    afterAll(() => {
      server.close();
      rmSync(dist, { recursive: true, force: true });
    });

    it('verifies the build when page, chunks and BUILD_ID agree', async () => {
      expect(readLocalBuild(dist).localBuildId).toBe(BUILD_ID);
      assetStatus = 200;
      expect(await verifyServedBuild(base, dist)).toBeNull();
    });

    it('fails when the server cannot serve the chunks its page references (500 text/plain in round 7)', async () => {
      assetStatus = 500;
      expect(await verifyServedBuild(base, dist)).toMatch(/answered 500/);
      assetStatus = 200;
    });

    it('fails when the local build was replaced, and when there is no local build at all', async () => {
      writeFileSync(join(dist, 'BUILD_ID'), 'NEWBUILDxxxxxxxxxxxxx');
      expect(await verifyServedBuild(base, dist)).toMatch(/not serving this build/);
      writeFileSync(join(dist, 'BUILD_ID'), BUILD_ID);
      expect(await verifyServedBuild(base, join(dist, 'missing'))).toMatch(/no production build/);
    });

    it('fails when nothing listens at --base', async () => {
      expect(await verifyServedBuild('http://127.0.0.1:9', dist)).toMatch(/no response/);
    });
  });
});

const routes = ROUTES as string[];
const gated = CAPABILITY_GATED as Set<string>;
const base = (p: string) => p.split('?')[0]!;

describe('tools/perf/payload-sizes.mjs', () => {
  it('measures every camera region the app knows, japan included', () => {
    expect(cctvRegions()).toEqual([...CCTV_REGIONS]);
    expect(routes).toContain('cctv?region=japan');
    for (const r of CCTV_REGIONS) expect(routes).toContain(`cctv?region=${r}`);
    expect(() => cctvRegions('export const OTHER = [];')).toThrow(/CCTV_REGIONS/);
  });

  it('probes only routes that exist in the catalogue (no bare /api/airports), with every required param', () => {
    expect(routes).not.toContain('airports');
    expect(routes).toEqual(expect.arrayContaining(['airports/search?q=lon', 'route/plan?from=EGLL&to=KJFK']));
    for (const r of routes) {
      const entry = catalogEntry(`/api/${base(r)}`);
      expect(entry, r).toBeDefined();
      const given = new URLSearchParams(r.split('?')[1] ?? '');
      for (const p of entry!.params.filter((x) => x.required && x.in === 'query')) expect(given.has(p.name), `${r} needs ?${p.name}`).toBe(true);
    }
  });

  it('treats 403 as a documented gate only on routes the catalogue gates by capability', () => {
    const expected = routes.map(base).filter((r) => catalogEntry(`/api/${r}`)?.capability !== undefined);
    expect([...gated].sort()).toEqual([...new Set(expected)].sort());
  });

  it('fails a route that was not measured (404, 500, no response), never reporting it within budget', () => {
    expect(statusProblem('flights', 200)).toBeNull();
    expect(statusProblem('flights', 503)).toBeNull();
    expect(statusProblem('frontlines', 403)).toBeNull();
    expect(statusProblem('flights', 403)).toMatch(/unexpected status 403/);
    expect(statusProblem('airports', 404)).toMatch(/unexpected status 404/);
    expect(statusProblem('news', 500)).toMatch(/500/);
    expect(statusProblem('news', 0)).toMatch(/no response/);
  });
});
