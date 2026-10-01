import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { upstreamsReceivingUserInput } from '@/lib/api-catalog';
import { FRAME_HOSTS, IMAGE_HOSTS, MEDIA_HOSTS, TILE_HOSTS } from '@/config/hosts';
import PrivacyPage from './page';

const html = renderToStaticMarkup(PrivacyPage());
const decoded = html.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
/** Only the upstream table, between its caption and the next section. */
const upstreamTable = decoded.slice(decoded.indexOf('Upstream hosts that receive user input'), decoded.indexOf('id="browser"'));

describe('/privacy', () => {
  it('lists exactly the upstreams that receive user input, one row each', () => {
    const hosts = upstreamsReceivingUserInput();
    const rows = [...upstreamTable.matchAll(/<th scope="row"[^>]*><code[^>]*>([^<]+)<\/code>/g)].map((m) => m[1]);
    expect(rows).toEqual(hosts);
    expect(decoded).toContain(`(${hosts.length} hosts)`);
  });

  it('lists every host the browser may contact directly (CSP allow-lists)', () => {
    for (const h of [...TILE_HOSTS, ...FRAME_HOSTS, ...MEDIA_HOSTS, ...IMAGE_HOSTS]) expect(decoded).toContain(h.replace('https://', ''));
  });

  it('covers consent-based location, AI key handling, storage, retention, cameras and responsible use', () => {
    for (const id of ['upstreams', 'browser', 'location', 'ai', 'storage', 'retention', 'cameras', 'responsible-use', 'contact']) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(decoded).toContain('x-ai-key');
    expect(decoded).toContain('never stored or logged');
    expect(decoded).toContain('godseye:settings');
    expect(decoded).toContain('godseye:theme');
    expect(html).toContain('href="/cameras-notice"');
    expect(decoded).toContain('proxied through this server');
    expect(decoded).toMatch(/no cookies/i);
    expect(decoded).toContain('/api/geo');
  });

  it('never claims AI where a heuristic answers, and has one h1', () => {
    expect(decoded).toContain('labelled as a heuristic, not AI');
    expect(html.match(/<h1[ >]/g)?.length).toBe(1);
    expect(html).toContain('<main id="main"');
  });

  it('limits sanctions screening and the entity graph to listed or public entities, as the README does', () => {
    const sentence = 'Sanctions-list screening and the entity graph cover listed or public entities only, never private individuals.';
    expect(decoded.replace(/\s+/g, ' ')).toContain(sentence);
  });

  it('discloses that ip-api.com is reached over plain HTTP', () => {
    expect(upstreamsReceivingUserInput()).toContain('ip-api.com');
    const text = decoded.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
    expect(text).toContain('One provider is reached over plain HTTP: ip-api.com, whose free tier has no HTTPS.');
    expect(text).toContain('/api/osint/ip travels unencrypted');
  });

  it('renders no reference-project branding', () => {
    expect(html).not.toMatch(/osiris/i);
  });
});
