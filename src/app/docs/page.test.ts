import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { API_CATALOG, EXCLUDED_OSIRIS_ROUTES, type ApiEndpoint } from '@/lib/api-catalog';
import { CAPABILITIES } from '@/lib/capabilities';
import DocsPage, { metadata } from './page';
import { anchorId } from './format';

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
    expect(hrefs.some((h) => h.includes('/stream'))).toBe(false);
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
});
