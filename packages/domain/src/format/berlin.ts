/**
 * Umrechnung in die Ortszeit Europe/Berlin ohne `Intl`.
 *
 * Warum ohne Intl: React Native (Hermes) bringt je nach Version und Build nicht zuverlässig
 * vollständige Zeitzonendaten mit. Die Regel für Deutschland ist seit 1996 die EU-Regel und
 * lässt sich exakt berechnen:
 * - Mitteleuropäische Sommerzeit (MESZ, UTC+2) vom letzten Sonntag im März, 01:00 UTC,
 *   bis zum letzten Sonntag im Oktober, 01:00 UTC.
 * - Sonst Mitteleuropäische Zeit (MEZ, UTC+1).
 *
 * Gültig für Zeitpunkte ab 1996. Sollte die EU die Zeitumstellung abschaffen, muss diese
 * Datei angepasst werden. Die Tests vergleichen die Umrechnung mit `Intl` (Node mit ICU)
 * über viele Jahre, einschließlich der Umstellungszeitpunkte.
 */
import { toDate, type IsoDate } from '../common/dates';

/** Ortszeit Berlin, zerlegt. `weekday`: 1 = Montag … 7 = Sonntag (ISO 8601). */
export interface BerlinLocalTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
  /** Abstand zu UTC in Minuten (60 oder 120). */
  offsetMinutes: number;
  /** Datum `YYYY-MM-DD` in Berliner Ortszeit. */
  isoDate: IsoDate;
  /** Uhrzeit `HH:MM` in Berliner Ortszeit. */
  time: string;
}

/** Zeitpunkt des letzten Sonntags eines Monats um `hourUtc` Uhr UTC (Monat 0-basiert). */
function lastSundayUtc(year: number, monthIndex: number, hourUtc: number): number {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0));
  const day = lastDay.getUTCDate() - lastDay.getUTCDay();
  return Date.UTC(year, monthIndex, day, hourUtc);
}

/** Abstand Europe/Berlin zu UTC in Minuten für einen Zeitpunkt (60 im Winter, 120 im Sommer). */
export function berlinOffsetMinutes(value: Date | string): number {
  const date = toDate(value);
  const year = date.getUTCFullYear();
  const t = date.getTime();
  return t >= lastSundayUtc(year, 2, 1) && t < lastSundayUtc(year, 9, 1) ? 120 : 60;
}

/** Zerlegt einen Zeitpunkt in Berliner Ortszeit. */
export function toBerlinLocal(value: Date | string): BerlinLocalTime {
  const date = toDate(value);
  const offsetMinutes = berlinOffsetMinutes(date);
  const local = new Date(date.getTime() + offsetMinutes * 60_000);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth() + 1;
  const day = local.getUTCDate();
  const hour = local.getUTCHours();
  const minute = local.getUTCMinutes();
  const second = local.getUTCSeconds();
  const jsDay = local.getUTCDay();
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    weekday: jsDay === 0 ? 7 : jsDay,
    offsetMinutes,
    isoDate: `${String(year).padStart(4, '0')}-${two(month)}-${two(day)}`,
    time: `${two(hour)}:${two(minute)}`,
  };
}

/**
 * Kalenderdatum eines Zeitpunkts in Berlin (`YYYY-MM-DD`). Für `today`-Parameter der
 * Geschäftslogik: `berlinDateOf(new Date())` in der aufrufenden Schicht.
 */
export function berlinDateOf(value: Date | string): IsoDate {
  return toBerlinLocal(value).isoDate;
}

function two(n: number): string {
  return String(n).padStart(2, '0');
}
