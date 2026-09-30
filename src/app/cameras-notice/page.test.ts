import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PROVIDERS } from '@/features/surveillance/server/registry';
import CamerasNoticePage, { metadata } from './page';

const html = renderToStaticMarkup(CamerasNoticePage());
const decoded = html.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'");

describe('/cameras-notice', () => {
  it('states purpose, no recording/archiving and no face/plate/object recognition', () => {
    for (const id of ['purpose', 'not-done', 'sources', 'link-out', 'removal', 'rights']) expect(html).toContain(`id="${id}"`);
    expect(decoded).toContain('Situational and traffic awareness');
    expect(decoded).toContain('No recording and no archiving');
    expect(decoded).toContain('No face, licence-plate or object recognition');
    expect(String(metadata.title)).toContain('Cameras notice');
  });

  it('lists every operator with its terms and offers the removal request', () => {
    for (const p of PROVIDERS) {
      expect(decoded).toContain(p.row.operator);
      expect(decoded).toContain(`href="${p.row.terms_url}"`);
    }
    expect(decoded).toContain('https://github.com/awne8886/godseye/issues/new?');
    expect(decoded).toContain('labels=camera-removal');
    expect(html).not.toMatch(/<script/);
  });
});
