/**
 * Airport-local wall-clock times WITH their UTC offset (`LocalTime`, e.g. 2026-09-30T21:05:00+01:00).
 * Offsets come from the IANA zone via Intl, so DST is applied for the instant in question.
 * Isomorphic. Owner: feature-flight-paths.
 */

const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, '0');

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat | null {
  let f = FORMATTERS.get(tz);
  if (f) return f;
  try {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return null; // unknown zone name
  }
  FORMATTERS.set(tz, f);
  return f;
}

/** UTC offset of `tz` at instant `at`, in minutes (east positive); null for an unknown zone. */
export function tzOffsetMinutes(tz: string, at: number): number | null {
  const f = formatter(tz);
  if (!f) return null;
  const parts = Object.fromEntries(f.formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
  const whole = Math.floor(at / 1000) * 1000;
  return Math.round((asUtc - whole) / 60_000);
}

/** ISO local time with offset, seconds precision; null for a missing or unknown zone. */
export function localTimeIso(tz: string | null | undefined, at: number): string | null {
  if (!tz) return null;
  const off = tzOffsetMinutes(tz, at);
  if (off === null) return null;
  const local = new Date(Math.floor(at / 1000) * 1000 + off * 60_000);
  const sign = off < 0 ? '-' : '+';
  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
  );
}

/** Destination offset minus origin offset in hours (e.g. LHR→JFK in summer: −5). */
export function offsetDeltaHours(fromTz: string | null, toTz: string | null, at: number): number | null {
  if (!fromTz || !toTz) return null;
  const a = tzOffsetMinutes(fromTz, at);
  const b = tzOffsetMinutes(toTz, at);
  return a === null || b === null ? null : (b - a) / 60;
}

/** `HH:MM` and `±HH:MM` from a LocalTime string, for compact display without re-parsing zones. */
export function splitLocal(iso: string): { hhmm: string; offset: string; date: string } {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?([+-]\d{2}:\d{2}|Z)$/.exec(iso);
  if (!m) return { hhmm: iso, offset: '', date: '' };
  return { date: m[1]!, hhmm: m[2]!, offset: m[3] === 'Z' ? '+00:00' : m[3]! };
}
