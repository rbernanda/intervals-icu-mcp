import { z } from 'zod';
import { AppError } from './errors';

/** UTC arithmetic on date-only values avoids daylight-saving jumps in calendar-day counts. */
export const DAY_MS = 86_400_000;

export const MAX_RANGE_DAYS = 90;

/** Rejects calendar rollovers such as February 30, which JavaScript Date would normalize. */
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Must be a valid calendar date (YYYY-MM-DD).');

export interface DateRange {
  start_date: string;
  end_date: string;
}

export const rangeShape = { start_date: dateSchema, end_date: dateSchema };

/** Validates ordered, inclusive athlete-local dates before any upstream request is made. */
export function checkRange(range: DateRange): DateRange {
  dateSchema.parse(range.start_date);
  dateSchema.parse(range.end_date);
  const days = daysBetween(range.start_date, range.end_date) + 1;
  if (days < 1 || days > MAX_RANGE_DAYS)
    throw new AppError(
      'invalid_input',
      'Date ranges must be ordered and cover at most 90 inclusive days.',
    );
  return range;
}

/** Counts date boundaries, not elapsed athlete-local hours; callers add one for inclusive ranges. */
export function daysBetween(start: string, end: string): number {
  return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS;
}

export function shiftDate(value: string, days: number): string {
  return new Date(Date.parse(`${value}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Resolves an instant to the athlete calendar day without assuming the Worker uses that timezone. */
export function todayInTimezone(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function mondayOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return shiftDate(date, -(day === 0 ? 6 : day - 1));
}

/** Compares validated local ISO dates or their timestamp prefixes without inventing a UTC offset. */
export function inRange(date: string | null | undefined, range: DateRange): boolean {
  const day = date?.slice(0, 10);
  return !!day && day >= range.start_date && day <= range.end_date;
}
