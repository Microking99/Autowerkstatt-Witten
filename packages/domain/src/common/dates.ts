/**
 * Kalenderrechnung auf reinen Datumsangaben (`YYYY-MM-DD`) ohne Zeitzone.
 *
 * Datumsangaben ohne Uhrzeit (z. B. `performedOn`, `dueDate`) werden als Kalendertage
 * behandelt; gerechnet wird intern mit UTC-Tagesnummern, damit Sommer-/Winterzeit keine
 * Rolle spielt.
 */
import { DomainError } from './result';

/** Datum ohne Uhrzeit im Format `YYYY-MM-DD`. */
export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** Zerlegt ein `YYYY-MM-DD`-Datum und prüft, ob es den Tag im Kalender gibt. */
export function parseIsoDate(value: IsoDate): { year: number; month: number; day: number } {
  const m = ISO_DATE.exec(value);
  if (!m) throw new DomainError('INVALID_DATE', `Ungültiges Datum: ${value}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new DomainError('INVALID_DATE', `Ungültiges Datum: ${value}`);
  }
  return { year, month, day };
}

/** true, wenn der Wert ein gültiges `YYYY-MM-DD`-Datum ist. */
export function isIsoDate(value: string): boolean {
  try {
    parseIsoDate(value);
    return true;
  } catch {
    return false;
  }
}

/** Anzahl Tage im Monat (Monat 1–12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Tagesnummer (Tage seit 1970-01-01) eines Datums. */
export function isoDateToDayNumber(value: IsoDate): number {
  const { year, month, day } = parseIsoDate(value);
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/** Datum zu einer Tagesnummer. */
export function dayNumberToIsoDate(dayNumber: number): IsoDate {
  const d = new Date(dayNumber * MS_PER_DAY);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
}

/** Addiert Tage (auch negativ). */
export function addDays(value: IsoDate, days: number): IsoDate {
  return dayNumberToIsoDate(isoDateToDayNumber(value) + days);
}

/**
 * Addiert Monate. Gibt es den Tag im Zielmonat nicht, gilt der letzte Tag des Monats
 * (31.01. + 1 Monat = 28.02. bzw. 29.02.).
 */
export function addMonths(value: IsoDate, months: number): IsoDate {
  if (!Number.isInteger(months)) throw new DomainError('INVALID_INTERVAL', 'Monate müssen ganzzahlig sein');
  const { year, month, day } = parseIsoDate(value);
  const zeroBased = year * 12 + (month - 1) + months;
  const y = Math.floor(zeroBased / 12);
  const m = (zeroBased % 12) + 1;
  const d = Math.min(day, daysInMonth(y, m));
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
}

/** Tage von `from` bis `to` (positiv, wenn `to` später liegt). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return isoDateToDayNumber(to) - isoDateToDayNumber(from);
}

/** Vergleich zweier Datumsangaben (-1, 0, 1). */
export function compareIsoDates(a: IsoDate, b: IsoDate): number {
  const diff = isoDateToDayNumber(a) - isoDateToDayNumber(b);
  return diff < 0 ? -1 : diff > 0 ? 1 : 0;
}

/**
 * Wandelt einen Zeitpunkt (Date oder ISO-8601-Zeichenkette mit Zeitzone) in ein Date um.
 * Wirft bei ungültigen Werten.
 */
export function toDate(value: Date | string): Date {
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(d.getTime())) throw new DomainError('INVALID_DATETIME', `Ungültiger Zeitpunkt: ${String(value)}`);
  return d;
}

/** Zeitpunkt als ISO-8601 in UTC (`2026-09-26T08:00:00.000Z`). */
export function toIsoDateTime(value: Date | string): string {
  return toDate(value).toISOString();
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}
