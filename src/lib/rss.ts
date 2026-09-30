/**
 * Tolerant RSS 2.0 / Atom item extraction (wire feeds, GDACS, Smithsonian GVP). Upstream text is
 * untrusted: it is decoded to plain text here and must be rendered as text (never as HTML).
 * Owner: lead. Isomorphic.
 */

export interface FeedItem {
  title: string;
  link: string | null;
  guid: string | null;
  /** ISO-8601 UTC or null if absent/unparseable (never substituted with "now"). */
  publishedAt: string | null;
  description: string;
  categories: string[];
  enclosures: { url: string; type: string | null }[];
  /** Raw inner XML of the item, for feed-specific namespaced fields (gdacs:*, geo:*). */
  raw: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Strip CDATA, tags and entities to plain text; collapse whitespace. */
export function toPlainText(s: string): string {
  const noCdata = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  const decodedOnce = decodeEntities(noCdata);
  return decodeEntities(decodedOnce.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Inner text of the first `<tag …>…</tag>` (namespaced names allowed, e.g. `gdacs:alertlevel`). */
export function tagText(xml: string, tag: string): string | null {
  const t = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = xml.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, 'i'));
  return m ? toPlainText(m[1]!) : null;
}

export function tagAttr(xml: string, tag: string, attr: string): string | null {
  const t = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = xml.match(new RegExp(`<${t}\\s[^>]*?${attr}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? decodeEntities(m[2] ?? m[3] ?? '') : null;
}

function toIso(date: string | null): string | null {
  if (!date) return null;
  const t = Date.parse(date);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function parseFeed(xml: string): FeedItem[] {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const re = isAtom ? /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi : /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  const items: FeedItem[] = [];
  for (const m of xml.matchAll(re)) {
    const raw = m[1]!;
    const link = isAtom
      ? (tagAttr(raw.replace(/<link[^>]*rel=["'](?!alternate)[^"']*["'][^>]*>/gi, ''), 'link', 'href') ?? tagAttr(raw, 'link', 'href'))
      : (tagText(raw, 'link') || tagAttr(raw, 'atom:link', 'href'));
    items.push({
      title: tagText(raw, 'title') ?? '',
      link: link || null,
      guid: tagText(raw, isAtom ? 'id' : 'guid'),
      publishedAt: toIso(isAtom ? (tagText(raw, 'published') ?? tagText(raw, 'updated')) : (tagText(raw, 'pubDate') ?? tagText(raw, 'dc:date'))),
      description: tagText(raw, isAtom ? 'summary' : 'description') ?? tagText(raw, 'content') ?? '',
      categories: [...raw.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi)].map((c) => toPlainText(c[1]!)).filter(Boolean),
      enclosures: [...raw.matchAll(/<(?:enclosure|media:content)\s([^>]*)\/?>/gi)]
        .map((e) => ({ url: decodeEntities(e[1]!.match(/url\s*=\s*"([^"]*)"/i)?.[1] ?? ''), type: e[1]!.match(/type\s*=\s*"([^"]*)"/i)?.[1] ?? null }))
        .filter((e) => /^https?:\/\//.test(e.url)),
      raw,
    });
  }
  return items;
}
