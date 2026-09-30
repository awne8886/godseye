/**
 * Live news channels: a curated list of broadcasters' OFFICIAL YouTube channels (ids verified
 * 2026-09-30 by fetching each `/channel/<id>/live` page). Embeds use youtube-nocookie
 * `embed/live_stream?channel=` only where the broadcaster allows embedding (OSIRIS's verified
 * `embed_allowed` split); the rest open on YouTube. Whether a channel is live right now comes
 * from a server-side check of its `/live` page (hourly): `true` when the page is a live watch page
 * (`"isLive":true`), `false` when YouTube serves the channel page instead, `null` when the page
 * could not be read or parsed (consent wall, bot check) — never guessed.
 * RT is excluded (no official YouTube presence; Rumble only).
 * Owner: layers-surveillance. Server-only.
 */
import 'server-only';
import { defineFeed, runProvider, type ProviderRun } from '@/lib/feeds';
import { httpText } from '@/lib/http';
import { providerBucket } from '@/lib/ratelimit';
import type { NewsChannel } from '@/lib/types';

type Seed = Omit<NewsChannel, 'embedUrl' | 'externalUrl' | 'live' | 'observedAt' | 'source'> & { youtubeChannelId: string };

/** Broadcaster HQ coordinates, approximate (where the dot sits on the map; not a stream location). */
export const CHANNELS: readonly Seed[] = [
  { id: 'aljazeera', name: 'Al Jazeera English', city: 'Doha', country: 'QA', lat: 25.3155, lng: 51.4939, youtubeChannelId: 'UCNye-wNBqNL5ZzHSJj3l8Bg', embedAllowed: true, category: 'mainstream', language: 'en' },
  { id: 'dwnews', name: 'DW News', city: 'Berlin', country: 'DE', lat: 52.5033, lng: 13.3274, youtubeChannelId: 'UCknLrEdhRCp1aegoMqRaCZg', embedAllowed: true, category: 'mainstream', language: 'en' },
  { id: 'france24en', name: 'FRANCE 24 English', city: 'Issy-les-Moulineaux', country: 'FR', lat: 48.8246, lng: 2.2635, youtubeChannelId: 'UCQfwfsi5VrQ8yKZ-UWmAEFg', embedAllowed: true, category: 'mainstream', language: 'en' },
  { id: 'skynews', name: 'Sky News', city: 'London', country: 'GB', lat: 51.4893, lng: -0.3494, youtubeChannelId: 'UCoMdktPbSTixAyNGwb-UYkQ', embedAllowed: true, category: 'mainstream', language: 'en' },
  { id: 'nhkworld', name: 'NHK WORLD-JAPAN', city: 'Tokyo', country: 'JP', lat: 35.6654, lng: 139.6962, youtubeChannelId: 'UCSPEjw8F2nQDtmUKPFNF7_A', embedAllowed: true, category: 'mainstream', language: 'en' },
  { id: 'cna', name: 'CNA', city: 'Singapore', country: 'SG', lat: 1.2949, lng: 103.7872, youtubeChannelId: 'UC83jt4dlz1Gjl58fzQrrKZg', embedAllowed: true, category: 'mainstream', language: 'en' },
  { id: 'wion', name: 'WION', city: 'Noida', country: 'IN', lat: 28.5355, lng: 77.391, youtubeChannelId: 'UC_gUM8rL-Lrg6O3adPW9K1g', embedAllowed: true, category: 'mainstream', language: 'en' },
  { id: 'bloomberg', name: 'Bloomberg Television', city: 'New York', country: 'US', lat: 40.7616, lng: -73.9678, youtubeChannelId: 'UCIALMKvObZNtJ6AmdCLP7Lg', embedAllowed: false, category: 'finance', language: 'en' },
  { id: 'nbcnews', name: 'NBC News NOW', city: 'New York', country: 'US', lat: 40.7587, lng: -73.9793, youtubeChannelId: 'UCeY0bbntWzzVIaj2z3QigXg', embedAllowed: false, category: 'mainstream', language: 'en' },
  { id: 'cbsnews', name: 'CBS News', city: 'New York', country: 'US', lat: 40.7695, lng: -73.9923, youtubeChannelId: 'UC8p1vwvWtl6T73JiExfWs1g', embedAllowed: false, category: 'mainstream', language: 'en' },
  { id: 'abcnews', name: 'ABC News Live', city: 'New York', country: 'US', lat: 40.7704, lng: -73.9893, youtubeChannelId: 'UCBi2mrWuNuyYy4gbM6fU18Q', embedAllowed: false, category: 'mainstream', language: 'en' },
  { id: 'cbc', name: 'CBC News', city: 'Toronto', country: 'CA', lat: 43.6443, lng: -79.3875, youtubeChannelId: 'UCKy1dAqELon0zgzZPOz9SVw', embedAllowed: false, category: 'mainstream', language: 'en' },
  { id: 'cgtn', name: 'CGTN', city: 'Beijing', country: 'CN', lat: 39.9139, lng: 116.4595, youtubeChannelId: 'UCgrNz-aDmcr2uuto8_DL2jg', embedAllowed: false, category: 'state', language: 'en' },
  { id: 'cspan', name: 'C-SPAN', city: 'Washington, D.C.', country: 'US', lat: 38.8943, lng: -77.0116, youtubeChannelId: 'UCb--64Gl51jIEVE-GLDAVTg', embedAllowed: false, category: 'government', language: 'en' },
];

export const embedUrlFor = (channelId: string): string => `https://www.youtube-nocookie.com/embed/live_stream?channel=${encodeURIComponent(channelId)}`;
export const liveUrlFor = (channelId: string): string => `https://www.youtube.com/channel/${encodeURIComponent(channelId)}/live`;

/** Parse a `/channel/<id>/live` page: live watch page → true, channel page → false, else null. */
export function parseLivePage(html: string): boolean | null {
  if (/"isLive":true/.test(html)) return true;
  if (/<meta property="og:url" content="https:\/\/www\.youtube\.com\/channel\/[\w-]+">/.test(html)) return false;
  return null;
}

export function toChannel(s: Seed, live: boolean | null): NewsChannel {
  return {
    ...s,
    source: 'youtube',
    observedAt: null,
    embedUrl: s.embedAllowed ? embedUrlFor(s.youtubeChannelId) : null,
    externalUrl: liveUrlFor(s.youtubeChannelId),
    live,
  };
}

const ytBucket = () => providerBucket('youtube-live-check', 1, 2);

export async function checkLive(channelId: string, signal?: AbortSignal): Promise<boolean | null> {
  const r = await httpText(liveUrlFor(channelId), { signal, timeoutMs: 12_000, retries: 0, maxBytes: 3 * 1024 * 1024, limiter: ytBucket(), headers: { 'accept-language': 'en' } });
  return r.text === undefined ? null : parseLivePage(r.text);
}

export const liveNewsFeed = defineFeed<NewsChannel[]>({
  key: 'live-news',
  ttlMs: 60 * 60_000,
  kind: 'mixed',
  attribution: [{ text: 'Live channels: official broadcaster YouTube channels (embedded via youtube-nocookie where the broadcaster allows it)', url: 'https://www.youtube.com/t/terms' }],
  note: 'Channel list is curated; `live` is checked server-side hourly from each channel /live page (null = could not be determined).',
  deadlineMs: 60_000,
  // The list itself is static and always served; the check result is per channel.
  isEmpty: () => false,
  run: async (ctx) => {
    let checks: (boolean | null)[] = CHANNELS.map(() => null);
    // count = channels whose live state could be determined; 0 → the check failed (flags stay null).
    const run: { run: ProviderRun } = await runProvider(
      async () => {
        checks = await Promise.all(CHANNELS.map((c) => checkLive(c.youtubeChannelId, ctx.signal).catch(() => null)));
        return checks.filter((v) => v !== null).length;
      },
      (n) => n,
    );
    return { data: CHANNELS.map((s, i) => toChannel(s, checks[i] ?? null)), providers: { 'youtube-live-check': run.run } };
  },
  count: (d) => d.length,
});
