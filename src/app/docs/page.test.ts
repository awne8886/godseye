import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { API_CATALOG, EXCLUDED_OSIRIS_ROUTES, type ApiEndpoint } from '@/lib/api-catalog';
import { CAPABILITIES } from '@/lib/capabilities';
import DocsPage, { metadata } from './page';
import { anchorId, keylessSummary, requiresOperatorConfig } from './format';

const CATALOG = API_CATALOG as readonly ApiEndpoint[];
const html = renderToStaticMarkup(DocsPage());
const decoded = html.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

describe('/docs', () => {
  it('renders every catalogue entry with its anchor, summary and parameters', () => {
    for (const e of CATALOG) {
      expect(html, e.path).toContain(`id="${anchorId(e)}"`);
      expect(decoded, e.path).toContain(`>${e.path}</code>`);
      expect(decoded, e.path).toContain(e.summary);
      for (const p of e.params) expect(decoded, `${e.path} ${p.name}`).toContain(`>${p.name}</code>`);
    }
    expect(html.match(/<article /g)?.length).toBe(CATALOG.length);
    const requiredCount = CATALOG.reduce((n, e) => n + e.params.filter((p) => p.required).length, 0);
    expect(decoded.split(' · required').length - 1).toBe(requiredCount);
  });

  it('lists every excluded OSIRIS route with its reason and every capability', () => {
    for (const r of EXCLUDED_OSIRIS_ROUTES) {
      expect(decoded).toContain(r.path);
      expect(decoded).toContain(r.reason);
    }
    for (const id of Object.keys(CAPABILITIES)) expect(decoded).toContain(`>${id}</code>`);
  });

  it('links examples same-origin and never links a POST or stream', () => {
    const hrefs = [...html.matchAll(/href="(\/api\/[^"]*)"/g)].map((m) => m[1]!.replace(/&amp;/g, '&'));
    expect(hrefs.length).toBeGreaterThan(20);
    expect(hrefs.some((h) => /\/stream(?:\?|$)/.test(h))).toBe(false);
    expect(hrefs.some((h) => h.startsWith('/api/ai/'))).toBe(false);
  });

  it('has one h1, a main landmark, labelled navigation and a skip link', () => {
    expect(html.match(/<h1[ >]/g)?.length).toBe(1);
    expect(html).toContain('<main id="main"');
    expect(html).toContain('aria-label="API sections"');
    expect(html).toContain('aria-label="Site"');
    expect(html).toContain('href="#main"');
    expect(html).toContain('aria-current="page"');
    expect(String(metadata.title)).toContain('API reference');
  });

  it('gives every table a caption and scoped headers', () => {
    const tables = html.match(/<table/g)?.length ?? 0;
    expect(html.match(/<caption/g)?.length).toBe(tables);
    expect(/<th(?=[\s>])(?![^>]*scope=)/.test(html)).toBe(false);
  });

  it('puts a same-origin "Send request" button on every GET endpoint and none on POST', () => {
    const tryIds = [...html.matchAll(/data-try="([^"]+)"/g)].map((m) => m[1]);
    const gets = CATALOG.filter((e) => e.method === 'GET').map(anchorId);
    expect([...tryIds].sort()).toEqual([...gets].sort());
    for (const e of CATALOG.filter((x) => x.method === 'POST')) expect(tryIds).not.toContain(anchorId(e));
    expect(html.match(/<button type="button" data-try="[^"]+"[^>]*>Send request<\/button>/g)?.length).toBe(gets.length);
    // The console builds URLs from catalogue paths only; no absolute URL is ever handed to it.
    expect(decoded).not.toMatch(/data-try="[^"]*(?:https?:|\/\/)/);
  });

  it('offers the ⌘K palette, reading progress and scroll-spy targets', () => {
    expect(html).toContain('data-palette-open');
    expect(html).toContain('aria-keyshortcuts="Meta+K Control+K /"');
    expect(html).toMatch(/role="progressbar"[^>]*aria-label="Reading progress"|aria-label="Reading progress"[^>]*role="progressbar"/);
    expect(html).toContain('data-scroll-root');
    // Every nav anchor points at a section heading that exists.
    const start = html.indexOf('aria-label="API sections"');
    const nav = html.slice(start, html.indexOf('</nav>', start));
    const targets = [...nav.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(10);
    for (const id of targets) expect(html, id).toContain(`id="${id}"`);
  });

  it('collapses endpoint details so the page stays light to lay out', () => {
    expect(html.match(/<details/g)?.length).toBeGreaterThanOrEqual(CATALOG.length);
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html).not.toContain('<colgroup');
  });

  it('counts keyless endpoints honestly and never claims every endpoint is keyless', () => {
    const gated = CATALOG.filter((e) => requiresOperatorConfig(e, CAPABILITIES));
    expect(gated.map((e) => e.path).sort()).toEqual(['/api/cloudflare-radar', '/api/frontlines', '/api/scanner', '/api/sdk/ingest', '/api/sdk/stream']);
    expect(decoded).toContain(keylessSummary(CATALOG, CAPABILITIES));
    expect(decoded).toContain(`all but ${gated.length} work without an API key`);
    expect(decoded).not.toMatch(/all usable without an API key/);
    expect(String(metadata.description)).not.toMatch(/No API key required/);
  });

  it('renders no reference-project branding (the MIT credit lives in LICENSE and the README)', () => {
    expect(html).not.toMatch(/osiris/i);
    expect(decoded).toContain('Endpoints of the reference project that');
  });
});
