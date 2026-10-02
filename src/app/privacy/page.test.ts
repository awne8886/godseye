import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
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

  it('names every image the browser loads straight from a third party, here and in README / ARCHITECTURE', () => {
    // Every plain <img> in shipped code is either a same-origin camera still (/api/cctv/proxy) or a
    // direct third-party load that /privacy must disclose. A new <img> fails this until it is classified.
    const root = path.resolve(import.meta.dirname, '../../..');
    const imgFiles: string[] = [];
    for (const rel of readdirSync(path.join(root, 'src'), { recursive: true, encoding: 'utf8' })) {
      if (!/\.tsx$/.test(rel) || /\.test\.tsx$/.test(rel)) continue;
      if (/<img\b/.test(readFileSync(path.join(root, 'src', rel), 'utf8'))) imgFiles.push(rel.split(path.sep).join('/'));
    }
    // File → the code that makes its <img> source same-origin (a blob of a proxied frame, or stillPath()).
    const sameOriginStills: Record<string, string> = {
      'features/surveillance/client/CameraViewer.tsx': 'URL.createObjectURL(',
      'features/surveillance/client/CctvPreviews.tsx': 'useTileFrame(video ? null : stillPath(cam)',
    };
    const direct = ['features/aviation/client/AircraftCard.tsx'];
    expect(imgFiles.sort()).toEqual([...Object.keys(sameOriginStills), ...direct].sort());
    for (const [rel, evidence] of Object.entries(sameOriginStills)) expect(readFileSync(path.join(root, 'src', rel), 'utf8'), rel).toContain(evidence);

    // The aircraft photo is a plain <img> sent without a referrer; the page must say so, not "optimiser".
    const card = readFileSync(path.join(root, 'src/features/aviation/client/AircraftCard.tsx'), 'utf8');
    expect(/<img\b[^>]*src=\{id\.photoThumbUrl\}[^>]*referrerPolicy="no-referrer"/.test(card)).toBe(true);
    expect(IMAGE_HOSTS.some((h) => new URL(h.replace('*.', 'x.')).hostname.endsWith('airport-data.com'))).toBe(true);
    const text = decoded.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
    expect(text).toContain('Aircraft photos on the aircraft card load directly from airport-data.com in your browser, with no referrer sent');
    expect(text).not.toMatch(/Normally fetched by this server.s image optimiser/);

    const flat = (rel: string) => readFileSync(path.join(root, rel), 'utf8').replace(/\s+/g, ' ');
    expect(flat('README.md')).toContain('aircraft photos (from airport-data.com, sent without a referrer) load directly in the browser');
    expect(flat('docs/ARCHITECTURE.md')).toContain('aircraft photos (a plain `<img>` from airport-data.com with no referrer;');
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

  it('lists every localStorage key the client writes, and docs/ARCHITECTURE.md names the same keys', () => {
    // Storage keys are `godseye:*` literals on a line that persists something (a *_KEY constant, a
    // zustand persist `name`, or a localStorage call); `godseye:*` event names (*_EVENT) are not storage.
    const root = path.resolve(import.meta.dirname, '../../..');
    const keys = new Set<string>();
    for (const rel of readdirSync(path.join(root, 'src'), { recursive: true, encoding: 'utf8' })) {
      if (!/\.tsx?$/.test(rel) || /\.test\.tsx?$/.test(rel)) continue;
      for (const line of readFileSync(path.join(root, 'src', rel), 'utf8').split('\n')) {
        if (/^\s*(\/\/|\*|\/\*)/.test(line) || /_EVENT\b/.test(line) || !/_KEY\s*=|name:\s*'godseye:|localStorage/.test(line)) continue;
        for (const m of line.matchAll(/'(godseye:[a-z0-9-]+)'/g)) keys.add(m[1]!);
      }
    }
    expect([...keys].sort()).toEqual(['godseye:panel-width', 'godseye:settings', 'godseye:style-studio', 'godseye:theme']);
    const storage = decoded.slice(decoded.indexOf('id="storage"'), decoded.indexOf('id="retention"'));
    const architecture = readFileSync(path.join(root, 'docs/ARCHITECTURE.md'), 'utf8');
    const persisted = /Preferences persist in `localStorage`[^.]*\./.exec(architecture)?.[0] ?? '';
    for (const k of keys) {
      expect(storage, k).toContain(k);
      expect(persisted, k).toContain(`\`${k}\``);
    }
  });
});
