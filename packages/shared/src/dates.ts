/**
 * Calendar-date and IST helpers (SPEC §5 "Dates and time"). Stay dates are calendar dates in IST
 * (`YYYY-MM-DD`); check-out is exclusive in range maths. Instants are UTC `Date`s.
 */
import { WEEKDAYS, type Weekday } from './enums';

export type IsoDate = string;

export const IST_OFFSET_MINUTES = 330;
const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60_000;
const DAY_MS = 86_400_000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function toUtcMidnight(date: IsoDate): number {
  if (!isIsoDate(date)) throw new RangeError(`Invalid date: ${date}`);
  return Date.parse(`${date}T00:00:00Z`);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(toUtcMidnight(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function diffDays(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcMidnight(to) - toUtcMidnight(from)) / DAY_MS);
}

/** Nights of a stay: every date in [checkIn, checkOut). */
export function eachNight(checkIn: IsoDate, checkOut: IsoDate): IsoDate[] {
  const n = diffDays(checkIn, checkOut);
  return Array.from({ length: Math.max(0, n) }, (_, i) => addDays(checkIn, i));
}

export function weekdayOf(date: IsoDate): Weekday {
  return WEEKDAYS[new Date(toUtcMidnight(date)).getUTCDay()];
}

/** The IST calendar date of an instant. */
export function istDateOf(instant: Date): IsoDate {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The instant of a wall-clock time (`HH:MM`) on an IST calendar date. */
export function istInstant(date: IsoDate, time = '00:00'): Date {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) throw new RangeError(`Invalid time: ${time}`);
  return new Date(toUtcMidnight(date) + (Number(m[1]) * 60 + Number(m[2])) * 60_000 - IST_OFFSET_MS);
}

/** Converts a Postgres DATE (returned as UTC midnight) to `YYYY-MM-DD`. */
export function dateToIso(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export function isoToDate(date: IsoDate): Date {
  return new Date(toUtcMidnight(date));
}

/** Do the half-open ranges [aStart, aEnd) and [bStart, bEnd) overlap? */
export function rangesOverlap(aStart: IsoDate, aEnd: IsoDate, bStart: IsoDate, bEnd: IsoDate): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
