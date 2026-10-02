import { describe, expect, it } from 'vitest';
import { filterEvents } from '../intel/IntelFeedPanel';
import { severityOf, toFeatures, toFeedEvent } from '../alerts/AlertPinsLayer';
import { seedPosition, step, type LayoutNode } from './layout';
import type { AlertItem, FeedEvent } from '@/lib/types';

describe('graph layout', () => {
  it('is deterministic (no randomness) and settles', () => {
    const run = () => {
      const nodes: LayoutNode[] = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, ...seedPosition(i), vx: 0, vy: 0 }));
      const links = [
        { source: 'a', target: 'b' },
        { source: 'a', target: 'c' },
        { source: 'a', target: 'd' },
      ];
      let e = Infinity;
      for (let i = 0; i < 400 && e > 0.05; i++) e = step(nodes, links);
      return { nodes, e };
    };
    const one = run();
    const two = run();
    expect(one.nodes).toEqual(two.nodes);
    expect(one.e).toBeLessThan(1);
    expect(seedPosition(0)).toEqual({ x: 0, y: 0 });
  });
});

const alert = (over: Partial<AlertItem>): AlertItem => ({
  id: 'tg:A/1',
  title: 'Missile strike on Odesa port',
  summary: null,
  link: 'https://t.me/A/1',
  publishedAt: '2026-09-30T19:00:00.000Z',
  source: 't.me/A',
  sourceName: 'A',
  sourceKind: 'telegram',
  lean: 'Test lean',
  bloc: 'independent',
  breaking: false,
  kind: 'rocket',
  media: null,
  alsoReportedBy: [],
  views: null,
  forwardedFrom: null,
  replyTo: null,
  place: { name: 'Odesa', lat: 46.48, lng: 30.72, precision: 'settlement', method: 'gazetteer' },
  risk: { score: 5, method: 'keyword-count', keywords: ['missile', 'strike'] },
  ...over,
});

describe('alert pins and the Intel Feed', () => {
  it('maps alerts to feed events and GeoJSON at their own coordinates', () => {
    const e = toFeedEvent(alert({}));
    expect(e).toMatchObject({ id: 'tg:A/1', layer: 'alert_pins', entityKind: 'alert', severity: 'medium', lat: 46.48, lng: 30.72, observedAt: '2026-09-30T19:00:00.000Z' });
    expect(severityOf(alert({ risk: { score: 9, method: 'keyword-count', keywords: [] } }))).toBe('high');
    const fc = toFeatures([alert({}), alert({ id: 'x', place: null })]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.geometry).toEqual({ type: 'Point', coordinates: [30.72, 46.48] });
  });

  it('filters events by layer and minimum severity', () => {
    const ev = (id: string, layer: string, severity: FeedEvent['severity']): FeedEvent => ({ id, layer, entityKind: 'alert', entityId: id, title: id, severity, observedAt: '2026-09-30T19:00:00Z', source: 's' });
    const events = [ev('1', 'alert_pins', 'info'), ev('2', 'earthquakes', 'high'), ev('3', 'alert_pins', 'critical')];
    expect(filterEvents(events, 'all', 'high').map((e) => e.id)).toEqual(['2', '3']);
    expect(filterEvents(events, 'alert_pins', 'info').map((e) => e.id)).toEqual(['1', '3']);
  });
});
