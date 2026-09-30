import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PROVIDERS } from '@/features/surveillance/server/registry';
import CamerasNotice from './CamerasNotice';
import CamerasNoticePage, { dynamic, metadata } from './page';

const decode = (h: string) => h.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
const render = (env: Record<string, string | undefined>) => renderToStaticMarkup(createElement(CamerasNotice, { env }));
const html = renderToStaticMarkup(CamerasNoticePage());
const decoded = decode(html);

describe('/cameras-notice', () => {
  it('states purpose, no recording/archiving and no face/plate/object recognition', () => {
    for (const id of ['purpose', 'not-done', 'sources', 'link-out', 'removal', 'rights']) expect(html).toContain(`id="${id}"`);
    expect(decoded).toContain('Situational and traffic awareness');
    expect(decoded).toContain('No recording and no archiving');
    expect(decoded).toContain('No face, licence-plate or object recognition');
    expect(String(metadata.title)).toContain('Cameras notice');
    // Keyed-operator lines and the removal contact depend on this instance's environment.
    expect(dynamic).toBe('force-dynamic');
  });

  it('lists every operator with its terms; the mode column never wraps', () => {
    for (const p of PROVIDERS) {
      expect(decoded).toContain(p.row.operator);
      expect(decoded).toContain(`href="${p.row.terms_url}"`);
    }
    expect(decoded).toContain('href="https://open.toronto.ca/open-data-licence/"');
    expect(html).toMatch(/<td class="whitespace-nowrap[^"]*">Stills ≥ 60 s<\/td>/);
    expect(html).not.toMatch(/<script/);
  });

  it('without GODSEYE_CONTACT: says the instance operator handles removals and falls back to the project tracker', () => {
    const d = decode(render({}));
    expect(d).toContain('the operator of this instance handles removals');
    expect(d).toContain('has not published a contact (GODSEYE_CONTACT)');
    expect(d).toContain('https://github.com/awne8886/godseye/issues/new?');
    expect(d).toContain('labels=camera-removal');
  });

  it('with GODSEYE_CONTACT: removal requests go to the instance operator', () => {
    const mail = decode(render({ GODSEYE_CONTACT: 'ops@example.org' }));
    expect(mail).toContain('href="mailto:ops@example.org?subject=Camera%20removal%20request');
    expect(mail).toContain('(ops@example.org)');
    expect(mail).not.toContain('github.com/awne8886/godseye/issues/new');
    const url = decode(render({ GODSEYE_CONTACT: 'https://ops.example.org/contact' }));
    expect(url).toContain('href="https://ops.example.org/contact"');
  });

  it('marks keyed operators as configured or not on this instance', () => {
    expect(decode(render({}))).toContain('needs operator key (not configured here)');
    expect(decode(render({ TFL_APP_KEY: 'k', TRAFIKVERKET_KEY: 'k' }))).not.toContain('not configured here');
  });
});
