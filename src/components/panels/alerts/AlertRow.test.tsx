// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AlertItem } from '@/lib/types';
import { AlertRow } from './AlertsPanel';

afterEach(cleanup);

const item: AlertItem = {
  id: 'tg:Chan/1',
  title: 'Explosions reported <img src=x onerror=alert(1)> in Kharkiv',
  summary: '<b>not bold</b>',
  link: 'https://t.me/Chan/1',
  publishedAt: '2026-09-30T19:00:00.000Z',
  source: 't.me/Chan',
  sourceName: 'Chan',
  sourceKind: 'telegram',
  lean: 'Global incident OSINT',
  bloc: 'independent',
  breaking: true,
  kind: 'event',
  media: null,
  alsoReportedBy: [],
  views: 4020,
  forwardedFrom: 'Source & Co',
  replyTo: 'javascript:alert(1)' as unknown as string,
  place: { name: 'Kharkiv', lat: 49.99, lng: 36.23, precision: 'settlement', method: 'gazetteer' },
  risk: { score: 3, method: 'keyword-count', keywords: ['explosion'] },
};

describe('AlertRow', () => {
  it('renders upstream strings as text and only http(s) links with noopener', () => {
    const { container } = render(
      <ul>
        <AlertRow it={item} now={Date.parse('2026-09-30T19:05:00Z')} />
      </ul>,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByText(/Explosions reported <img/)).toBeTruthy();
    const links = [...container.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://t.me/Chan/1']);
    expect(links.every((a) => a.rel.includes('noopener') && a.rel.includes('noreferrer'))).toBe(true);
    expect(container.textContent).toContain('4,020');
    expect(container.textContent).toContain('Source & Co');
    expect(container.textContent).toContain('Breaking (per channel)');
  });
});
