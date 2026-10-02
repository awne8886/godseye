/**
 * One failure verdict for a panel query, so its chip, banner and body never disagree. react-query
 * keeps the last data when a refetch fails; a panel that derives its chip from `data` alone showed a
 * green "120 RESULTS" beside a red SOURCE OFFLINE banner, and showed nothing at all when the refetch
 * failed with a network error instead of a 503 (r8). Every intel panel reads `error` through here
 * first: an error always wins the chip, and data kept from an earlier fetch is labelled as such with
 * the time the server fetched it.
 * Owner: panels-alerts-markets-dossier-graph. Pure (tested).
 */
import type { ChipTone } from '@/components/hud/PanelChrome';
import { FeedOfflineError } from './client';

export interface QueryFailure {
  /** The panel still shows data from an earlier successful fetch. */
  retained: boolean;
  /** HTTP status when the route answered; null when it did not answer at all (network error). */
  status: number | null;
  /**
   * Retained: when the server fetched the copy still on screen. Otherwise: the feed's last good
   * snapshot as reported by the failing response. Null when neither is known.
   */
  lastGoodAt: string | null;
}

/** "HH:MM UTC" on the same UTC day as `now`, else "YYYY-MM-DD HH:MM UTC". */
export function utcLabel(iso: string, now = Date.now()): string {
  const sameDay = iso.slice(0, 10) === new Date(now).toISOString().slice(0, 10);
  return `${sameDay ? iso.slice(11, 16) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`} UTC`;
}

/**
 * Null while the query is healthy (or still pending without an error). `fetchedAtOf` returns the
 * server's own fetch time of a response (e.g. `meta.fetchedAt`), used for a retained copy.
 */
export function queryFailure<T>(q: { data: T | undefined; error: unknown }, fetchedAtOf?: (d: T) => string | null | undefined): QueryFailure | null {
  if (!q.error) return null;
  const e = q.error instanceof FeedOfflineError ? q.error : null;
  const retained = q.data !== undefined;
  const lastGoodAt = (retained && fetchedAtOf ? fetchedAtOf(q.data as T) : null) ?? e?.meta?.lastGoodAt ?? null;
  return { retained, status: e?.status ?? null, lastGoodAt };
}

const rejected = (s: number | null) => s !== null && s >= 400 && s < 500 && s !== 429;

/** The headline word for a failure: RATE LIMITED (429), REQUEST REJECTED (other 4xx), else SOURCE OFFLINE. */
export function failureWord(f: QueryFailure): string {
  if (f.status === 429) return 'RATE LIMITED';
  return rejected(f.status) ? 'REQUEST REJECTED' : 'SOURCE OFFLINE';
}

/**
 * The sentence for a failure. `upstream` says what a 503 from a feed route means for this panel
 * ("no channel or wire answered"); other failures are described by what actually happened.
 */
export function failureText(f: QueryFailure, upstream: string, now = Date.now()): string {
  const why =
    f.status === null
      ? 'this server did not answer'
      : f.status === 503
        ? upstream
        : f.status === 429
          ? 'this server is rate-limiting requests; it will retry'
          : `the route answered HTTP ${f.status}`;
  const at = f.lastGoodAt ? utcLabel(f.lastGoodAt, now) : null;
  const tail = f.retained ? `; showing the last copy received${at ? `, fetched ${at}` : ''}` : at ? `; last good ${at}` : '';
  return `${failureWord(f)} — ${why}${tail}.`;
}

/** Header chip for a failure: always the failure, never the count of a retained copy. */
export function failureChip(f: QueryFailure, upstream: string, now = Date.now()): { text: string; tone: ChipTone; title: string } {
  const at = f.lastGoodAt ? utcLabel(f.lastGoodAt, now).replace(' UTC', 'Z') : null;
  const word = failureWord(f);
  return { text: at && word === 'SOURCE OFFLINE' ? `${word} · ${at}` : word, tone: f.status === 429 ? 'warn' : 'error', title: failureText(f, upstream, now) };
}
