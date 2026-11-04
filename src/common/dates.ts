import { z } from 'zod';
import '../docs/openapi';

/**
 * Transaction-date convention (spec §6):
 * a transaction date is a calendar date chosen by the user ("2026-11-03"), stored as that day's
 * 00:00:00.000Z. It is never shifted by time zone, so a transaction always belongs to the same day,
 * month and report regardless of where it is viewed or whether the user later changes time zone.
 * The user's time zone is only used to work out what "today" is. createdAt/updatedAt are real
 * UTC timestamps.
 */

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseCalendarDate(value: string): Date | null {
  const match = CALENDAR_DATE.exec(value);
  if (!match) return null;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  // Rejects impossible dates such as 2026-02-30, which Date.UTC would roll over.
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}

export function formatCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today's calendar date in the given IANA time zone, e.g. "2026-11-03". */
export function todayIn(timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Same day-of-month `months` later, in UTC. Callers only use days 1–28, so no month overflow. */
function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

/** Start of the financial month containing `date`, for months that begin on `startDay` (1–28). */
export function financialMonthStart(date: Date, startDay: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  return date.getUTCDate() >= startDay ? new Date(Date.UTC(y, m, startDay)) : new Date(Date.UTC(y, m - 1, startDay));
}

/** The financial month containing `today`, as inclusive calendar dates. */
export function currentFinancialMonth(today: string, startDay: number): { from: string; to: string } {
  const start = financialMonthStart(parseCalendarDate(today)!, startDay);
  return { from: formatCalendarDate(start), to: formatCalendarDate(addDays(addMonths(start, 1), -1)) };
}

export interface DateBucket {
  /** Inclusive start (UTC midnight). */
  start: Date;
  /** Exclusive end (UTC midnight of the day after the bucket's last day). */
  end: Date;
}

/**
 * Splits [from, to] (inclusive calendar dates) at financial-month boundaries. The first and last
 * buckets are clipped to the range, so totals over the buckets always equal totals over the range.
 */
export function financialMonthBuckets(from: string, to: string, startDay: number): DateBucket[] {
  const rangeStart = parseCalendarDate(from)!;
  const rangeEnd = addDays(parseCalendarDate(to)!, 1);
  const buckets: DateBucket[] = [];
  let cursor = financialMonthStart(rangeStart, startDay);
  while (cursor < rangeEnd) {
    const next = addMonths(cursor, 1);
    buckets.push({ start: cursor < rangeStart ? rangeStart : cursor, end: next > rangeEnd ? rangeEnd : next });
    cursor = next;
  }
  return buckets;
}

export const calendarDateSchema = z
  .string()
  .refine((value) => parseCalendarDate(value) !== null, 'Use a valid date in YYYY-MM-DD format')
  .openapi({ example: '2026-11-03', format: 'date' });
