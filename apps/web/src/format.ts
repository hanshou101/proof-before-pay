import type { Cents } from './model';

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "$2,400.00" — or an em dash when nothing is known yet. */
export function money(cents: Cents | null | undefined): string {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return '—';
  return USD.format(cents / 100);
}

const USD_WHOLE = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** "$2,500" — a policy limit, where the cents are never the point (and a third of the width). */
export function wholeMoney(cents: Cents | null | undefined): string {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return '—';
  return USD_WHOLE.format(cents / 100);
}

/** "Nov 4" in UTC (the demo clock, SPEC §6.4 testClock). */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

/** "Nov 20, 2025" in UTC — the year is only spelled out when it is not the run's. */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

function utcDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function utcYear(iso: string): number {
  return new Date(iso).getUTCFullYear();
}

/**
 * A date inside one run's story: "Nov 20" when it happened in the run's year, "Nov 20, 2025"
 * when it did not. 07-UI §4.4 D1-11: a step from another year must not read as "two weeks from
 * now" just because only the month and day are printed.
 */
export function dayLabel(iso: string | null | undefined, sameYearAs?: string | null): string {
  if (!iso) return '—';
  if (!sameYearAs) return shortDate(iso);
  return utcYear(iso) === utcYear(sameYearAs) ? shortDate(iso) : longDate(iso);
}

/** "17:30" in UTC. */
export function clock(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(new Date(iso));
}

/** "17:30:12" in UTC — the second-level clock the proof timeline uses (07-UI §4.4, D1-11). */
export function hms(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(new Date(iso));
}

/** "Nov 6 · 17:30" in UTC. */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return `${shortDate(iso)} · ${clock(iso)}`;
}

/**
 * D1-11: the steps of one run are seconds apart, so a timeline inside a single day shows
 * `HH:MM:SS`; a step that lands on another day (a receipt polled the next morning, a payee
 * verified in a previous year) keeps its date — and its year, when that differs from the run's,
 * so "Nov 20" cannot be read as later in the week.
 */
export function stepTime(iso: string | null | undefined, sameDayAs: string | null | undefined): string {
  if (!iso) return '—';
  if (!sameDayAs) return hms(iso);
  if (utcDay(iso) === utcDay(sameDayAs)) return hms(iso);
  return `${dayLabel(iso, sameDayAs)} · ${hms(iso)}`;
}

/** "AR" from "Ana Ribeiro". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** "video_call" → "video call". */
export function humanizeMethod(method: string): string {
  return method.replace(/_/g, ' ');
}

/** First 12 characters of a hash, for evidence lines. */
export function shortHash(hash: string | null | undefined): string {
  if (!hash) return '—';
  return `${hash.slice(0, 4)}…${hash.slice(-4)}`;
}

/**
 * `pbp-59daca51ec7a85cebb8db2fd463f` → `pbp-59daca51…463f`.
 *
 * The proof timeline keeps six steps on one line each inside a 424px panel (07-UI §4.1). A real
 * batch id or transaction id is far wider than the design fixture's, so the timeline shows the
 * head and tail — the full value is in the bundle's PayPal section, one click away, and in the
 * raw events. This is an abbreviation, not a clip: the reader is told something was left out.
 */
export function abbreviate(value: string | null | undefined, head = 10, tail = 4): string {
  if (!value) return '—';
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
