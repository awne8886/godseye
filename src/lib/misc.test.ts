import { describe, expect, it } from 'vitest';
import { fieldIndex, fromColumnar, toColumnar } from './columnar';
import { csvRows, parseCsv } from './csv';
import { formatAge, freshnessLabel, freshnessState, toIso } from './freshness';
import { decodeEntities, parseFeed, tagAttr, tagText, toPlainText } from './rss';
import { userAgent } from './config';

describe('freshness', () => {
  const now = Date.parse('2026-09-30T16:00:00Z');
  it('maps age vs cadence to LIVE / age / STALE / OFFLINE / REFERENCE', () => {
    const base = { kind: 'live' as const, cadenceMs: 60_000, now };
    expect(freshnessState({ ...base, at: now - 30_000 })).toBe('live');
    expect(freshnessState({ ...base, at: now - 120_000 })).toBe('recent');
    expect(freshnessLabel('recent', now - 120_000, now)).toBe('2m');
    expect(freshnessState({ ...base, at: now - 3_600_000 })).toBe('stale');
    expect(freshnessState({ ...base, at: now - 30_000, failed: true })).toBe('stale');
    expect(freshnessState({ ...base, at: now - 3_600_000, failed: true })).toBe('offline');
    expect(freshnessState({ ...base, at: null })).toBe('offline');
    expect(freshnessState({ kind: 'reference', at: now - 1e9, cadenceMs: 1, now })).toBe('reference');
    expect(freshnessLabel('live', now, now)).toBe('LIVE');
    expect(freshnessLabel('reference', null)).toBe('REFERENCE');
  });
  it('formats ages compactly', () => {
    expect(formatAge(45_000)).toBe('45s');
    expect(formatAge(3 * 3600_000)).toBe('3h');
    expect(formatAge(3 * 86_400_000)).toBe('3d');
    expect(toIso(0)).toBeNull();
    expect(toIso(Date.parse('2026-09-30T16:00:00Z'))).toBe('2026-09-30T16:00:00.000Z');
  });
});

describe('columnar', () => {
  it('round-trips and indexes fields', () => {
    const items = [{ id: 'a', lat: 1, lng: 2, name: undefined as string | undefined }];
    const c = toColumnar(items, ['id', 'lat', 'lng', 'name'] as const);
    expect(c.rows).toEqual([['a', 1, 2, null]]);
    expect(fromColumnar(c.fields, c.rows)).toEqual([{ id: 'a', lat: 1, lng: 2, name: null }]);
    expect(fieldIndex(c.fields).lng).toBe(2);
  });
});

describe('csv', () => {
  it('handles quotes, escaped quotes, CRLF, embedded newlines and BOM', () => {
    const text = '﻿a,b,c\r\n1,"x, y","he said ""hi"""\n2,"multi\nline",\n';
    expect([...csvRows(text)]).toEqual([['a', 'b', 'c'], ['1', 'x, y', 'he said "hi"'], ['2', 'multi\nline', '']]);
    expect(parseCsv(text)[1]).toEqual({ a: '2', b: 'multi\nline', c: '' });
    expect(parseCsv('')).toEqual([]);
  });
});

describe('rss', () => {
  it('parses RSS items as plain text and never invents dates', () => {
    const xml = `<rss><channel><item><title><![CDATA[Quake &amp; <b>tsunami</b>]]></title><link>https://ex.com/a</link>
      <pubDate>Tue, 30 Sep 2026 15:00:00 GMT</pubDate><description>&lt;p&gt;Hello&lt;/p&gt; world</description>
      <gdacs:alertlevel>Orange</gdacs:alertlevel><enclosure url="https://ex.com/i.jpg" type="image/jpeg"/></item>
      <item><title>No date</title><link>https://ex.com/b</link></item></channel></rss>`;
    const items = parseFeed(xml);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: 'Quake & tsunami', link: 'https://ex.com/a', publishedAt: '2026-09-30T15:00:00.000Z', description: 'Hello world' });
    expect(tagText(items[0]!.raw, 'gdacs:alertlevel')).toBe('Orange');
    expect(items[0]!.enclosures).toEqual([{ url: 'https://ex.com/i.jpg', type: 'image/jpeg' }]);
    expect(items[1]!.publishedAt).toBeNull();
  });
  it('parses Atom entries', () => {
    const xml = `<feed><entry><title>T</title><link rel="alternate" href="https://ex.com/x"/><id>tag:1</id><updated>2026-09-30T10:00:00Z</updated><summary>S</summary></entry></feed>`;
    expect(parseFeed(xml)[0]).toMatchObject({ title: 'T', link: 'https://ex.com/x', guid: 'tag:1', publishedAt: '2026-09-30T10:00:00.000Z', description: 'S' });
  });
  it('decodes entities safely', () => {
    expect(decodeEntities('&#x41;&#66;&amp;&unknown;')).toBe('AB&&unknown;');
    expect(toPlainText('<script>alert(1)</script>ok')).toBe('alert(1) ok');
    expect(tagAttr('<link href="https://a.b/c?x=1&amp;y=2"/>', 'link', 'href')).toBe('https://a.b/c?x=1&y=2');
  });
});

describe('config', () => {
  it('builds an honest User-Agent with a configurable contact', () => {
    expect(userAgent({})).toMatch(/^GODSEYE\/\S+ \(\+https:\/\/github\.com\/awne8886\/godseye; contact https:\/\/github\.com\/awne8886\/godseye\/issues\)$/);
    expect(userAgent({ GODSEYE_CONTACT: 'ops@example.org' })).toContain('contact ops@example.org');
  });
});
