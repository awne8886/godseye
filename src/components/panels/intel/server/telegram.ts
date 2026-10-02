/**
 * Parser for Telegram's public channel preview (`https://t.me/s/<channel>`), server-rendered HTML
 * with no API behind it. Lessons carried over from the OSIRIS parser (measured 2026-09-17, re-checked
 * against our 2026-09-30 probes):
 *  - split posts on the `tgme_widget_message_wrap` boundary (a lazy regex cut photo posts short and
 *    back-dated them to fetch time); a post without its own `<time datetime>` is DROPPED;
 *  - the post's own text is `js-message_text`; a reply's quoted parent (`js-message_reply_text`)
 *    comes first and must not become the post's words;
 *  - album posts nest a second text div, so the text is read with a balanced-div scan.
 * Everything leaves as plain text (`toPlainText`-equivalent) and http(s) links only. Posts are
 * low-volume public previews read for display; they are never fed to model training.
 * Owner: panels-alerts-markets-dossier-graph. Isomorphic (pure).
 */
import { decodeEntities } from '@/lib/rss';

export interface TelegramMedia {
  type: 'photo' | 'video';
  thumbnailUrl: string | null;
  videoUrl: string | null;
  durationS: number | null;
}

export interface TelegramPost {
  /** `channel/123`, stable across refreshes. */
  id: string;
  channel: string;
  url: string;
  publishedAt: string;
  text: string;
  headline: string;
  summary: string;
  breaking: boolean;
  media: TelegramMedia | null;
  forwardedFrom: string | null;
  replyTo: string | null;
  views: number | null;
}

/** HTML fragment → plain text with paragraph breaks kept (never rendered as HTML). */
export function htmlToText(html: string): string {
  const text = decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?(?:blockquote|p|div)\b[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  );
  return text
    .split('\n')
    .map((l) => l.replace(/[ \t\f\v ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function innerDiv(html: string, openAt: number): string | null {
  const start = html.indexOf('>', openAt);
  if (start < 0) return null;
  const tags = /<div\b|<\/div>/gi;
  tags.lastIndex = start + 1;
  let depth = 1;
  for (let m = tags.exec(html); m; m = tags.exec(html)) {
    depth += m[0][1] === '/' ? -1 : 1;
    if (depth === 0) return html.slice(start + 1, m.index);
  }
  return null;
}

const PICTOGRAPHS = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}️‍⃣]/gu;
const LEADING_DECORATION = /^[^\p{L}\p{N}"'“‘«(]+/u;
const BREAKING_PREFIX = /^(?:breaking(?: news)?|just in|urgent|flash|срочно|молния)(?![\p{L}])\s*[:|—–-]?\s*/iu;
const OTHER_PREFIX = /^(?:new|update|developing)\s*[:|—–-]\s*/iu;
const SIGN_OFF = [/^@\w+(?:\s*[|•·].*)?$/u, /^@\w+\s+[—–-]\s+.{0,80}$/u, /^(?:support us|subscribe|donate|join us|follow us|original msg)\b.{0,30}$/iu, /^(?:#[\p{L}\p{N}_]+\s*)+$/u];
export const HEADLINE_MAX = 140;

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:—–-]+$/, '')}…`;
}

function tidy(line: string): { text: string; breaking: boolean } {
  let s = line.normalize('NFKC').replace(PICTOGRAPHS, ' ').replace(/\s{2,}/g, ' ').replace(LEADING_DECORATION, '');
  const breaking = BREAKING_PREFIX.test(s);
  s = s.replace(BREAKING_PREFIX, '').replace(OTHER_PREFIX, '').replace(LEADING_DECORATION, '').replace(/[\s|:—–-]+$/u, '').trim();
  return { text: s, breaking };
}

function stripSignOff(text: string): string {
  const lines = text.split('\n');
  while (lines.length > 1) {
    const last = lines[lines.length - 1]!.trim();
    if (!last || SIGN_OFF.some((re) => re.test(last)) || (last.length >= 3 && !/[\p{L}\p{N}]/u.test(last))) lines.pop();
    else break;
  }
  return lines.join('\n').trim();
}

/** First meaningful line becomes the headline (≤ 140 chars); the rest is the summary. */
export function splitHeadline(text: string): { headline: string; summary: string; breaking: boolean } {
  const lines = text.split('\n');
  let i = 0;
  let breaking = false;
  let headline = '';
  for (; i < lines.length; i++) {
    const t = tidy(lines[i]!);
    breaking ||= t.breaking;
    if (t.text.length >= 3) {
      headline = t.text;
      i++;
      break;
    }
  }
  let summary = lines.slice(i).join('\n').trim();
  if (headline.length > HEADLINE_MAX) {
    const sentence = headline.match(/^(.{20,}?[.!?])\s+(?=\S)/u);
    if (sentence && sentence[1]!.length <= HEADLINE_MAX) {
      summary = `${headline.slice(sentence[0].length)}\n${summary}`.trim();
      headline = sentence[1]!;
    }
  }
  return { headline: clip(headline, HEADLINE_MAX), summary, breaking };
}

/** "4.02K" → 4020, "1.2M" → 1 200 000. */
export function parseViews(raw: string): number | null {
  const m = raw.trim().match(/^([\d.,]+)\s*([KM])?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]!.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const unit = m[2]?.toUpperCase();
  return Math.round(n * (unit === 'M' ? 1e6 : unit === 'K' ? 1e3 : 1));
}

/** "0:29" / "1:02:03" → seconds. */
export function parseDuration(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const parts = raw.trim().split(':').map(Number);
  if (!parts.length || parts.some((p) => !Number.isFinite(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** Telegram serves post media from these hosts only (CSP allows `*.telesco.pe/file/`). */
const TELEGRAM_CDN = /^https:\/\/(?:[\w-]+\.)*(?:telesco\.pe|cdn-telegram\.org)\//;
const httpsOnly = (u: string | null | undefined): string | null => (u && /^https?:\/\//i.test(u) ? u : null);

function parseMedia(post: string): TelegramMedia | null {
  const photoAt = post.indexOf('tgme_widget_message_photo_wrap');
  const videoAt = post.indexOf('tgme_widget_message_video_thumb');
  if (photoAt < 0 && videoAt < 0) return null;
  const leadIsVideo = videoAt >= 0 && (photoAt < 0 || videoAt < photoAt);
  const frag = post.slice(leadIsVideo ? videoAt : photoAt, (leadIsVideo ? videoAt : photoAt) + 800);
  const bg = frag.match(/background-image:url\('([^']+)'\)/)?.[1];
  const thumb = bg ? decodeEntities(bg) : null;
  const rawVideo = post.match(/<video\b[^>]*\bsrc="([^"]+)"/)?.[1];
  const video = rawVideo ? decodeEntities(rawVideo) : null;
  return {
    type: leadIsVideo ? 'video' : 'photo',
    thumbnailUrl: thumb && TELEGRAM_CDN.test(thumb) ? thumb : null,
    videoUrl: leadIsVideo && video && TELEGRAM_CDN.test(video) ? video : null,
    durationS: leadIsVideo ? parseDuration(post.match(/class="message_video_duration[^"]*"[^>]*>([^<]+)</)?.[1]) : null,
  };
}

function parseForward(post: string): string | null {
  const at = post.search(/class="tgme_widget_message_forwarded_from(?:\s[^"]*)?"/);
  if (at < 0) return null;
  const end = post.indexOf('</div>', at);
  const block = post.slice(at, end < 0 ? at + 400 : end);
  const name = htmlToText(block.replace(/^[^>]*>/, '')).replace(/^Forwarded from\s*/i, '').trim();
  return name ? name.slice(0, 120) : null;
}

/** Every usable post on a channel page (oldest first as Telegram renders them). */
export function parseChannelPage(html: string, channel: string): TelegramPost[] {
  const posts: TelegramPost[] = [];
  for (const post of html.split('class="tgme_widget_message_wrap').slice(1)) {
    if (/class="tgme_widget_message\b[^"]*\bservice_message\b/.test(post)) continue;
    const dataPost = post.match(/data-post="([A-Za-z0-9_]+\/\d+)"/)?.[1];
    const published = post.match(/class="tgme_widget_message_date"[^>]*>\s*<time datetime="([^"]+)"/)?.[1];
    if (!dataPost || !published || Number.isNaN(Date.parse(published))) continue;
    const textAt = post.indexOf('class="tgme_widget_message_text js-message_text"');
    if (textAt < 0) continue;
    const inner = innerDiv(post, post.lastIndexOf('<div', textAt));
    const text = inner ? stripSignOff(htmlToText(inner)) : '';
    if (text.length < 10) continue;
    const { headline, summary, breaking } = splitHeadline(text);
    if (!headline) continue;
    const views = post.match(/class="tgme_widget_message_views">([^<]+)</)?.[1];
    const reply = post.match(/class="tgme_widget_message_reply\b[^"]*"\s+href="([^"]+)"/)?.[1];
    posts.push({
      id: dataPost,
      channel,
      url: `https://t.me/${dataPost}`,
      publishedAt: new Date(published).toISOString(),
      text,
      headline,
      summary,
      breaking,
      media: parseMedia(post),
      forwardedFrom: parseForward(post),
      replyTo: httpsOnly(reply ? decodeEntities(reply) : null),
      views: views ? parseViews(views) : null,
    });
  }
  return posts;
}

/**
 * Words kept in the cross-post fingerprint (contract §5, OSIRIS: 24). Shorter prefixes merge
 * distinct templated posts that merely open alike, hiding the later report.
 */
export const FINGERPRINT_WORDS = 24;

/** Word-level fingerprint for spotting one report carried by several channels. */
export function fingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+|@\w+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 1)
    .slice(0, FINGERPRINT_WORDS)
    .join(' ');
}
