/**
 * Deutsche Formatierung für Oberfläche, Exporte und Meldungen, ohne `Intl`
 * (siehe `berlin.ts` für die Zeitzone Europe/Berlin).
 *
 * Trennzeichen zwischen Zahl und Einheit ist ein normales Leerzeichen ("123,45 €").
 */
import { isIsoDate, parseIsoDate, type IsoDate } from '../common/dates';
import { DomainError } from '../common/result';
import { toBerlinLocal } from './berlin';

/** Ganzzahl mit Tausenderpunkten: 1234567 → "1.234.567". */
export function formatInteger(value: number): string {
  if (!Number.isFinite(value)) throw new DomainError('INVALID_NUMBER', 'Zahl ist nicht endlich');
  const rounded = Math.round(value);
  const negative = rounded < 0;
  const digits = String(Math.abs(rounded));
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return negative ? `-${grouped}` : grouped;
}

/** Dezimalzahl deutsch mit fester Nachkommazahl: formatDecimal(1234.56, 1) → "1.234,6". */
export function formatDecimal(value: number, fractionDigits: number): string {
  if (!Number.isFinite(value)) throw new DomainError('INVALID_NUMBER', 'Zahl ist nicht endlich');
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 6) {
    throw new DomainError('INVALID_NUMBER', 'Nachkommastellen 0 bis 6');
  }
  const factor = 10 ** fractionDigits;
  const scaled = Math.round(Math.abs(value) * factor);
  const whole = formatInteger(Math.floor(scaled / factor));
  const sign = value < 0 && scaled !== 0 ? '-' : '';
  if (fractionDigits === 0) return `${sign}${whole}`;
  return `${sign}${whole},${String(scaled % factor).padStart(fractionDigits, '0')}`;
}

/**
 * Centbetrag als Euro: 12345 → "123,45 €", 123456789 → "1.234.567,89 €", -500 → "-5,00 €".
 * `withSymbol: false` lässt " €" weg.
 */
export function formatCents(cents: number, options: { withSymbol?: boolean } = {}): string {
  if (!Number.isInteger(cents)) throw new DomainError('INVALID_AMOUNT', 'Betrag muss ganzzahlig in Cent sein');
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const euros = formatInteger(Math.floor(abs / 100));
  const rest = String(abs % 100).padStart(2, '0');
  const text = `${negative ? '-' : ''}${euros},${rest}`;
  return options.withSymbol === false ? text : `${text} €`;
}

/** Kilometerstand: 123456 → "123.456 km"; `null` → "unbekannt". */
export function formatKm(km: number | null): string {
  if (km === null) return 'unbekannt';
  return `${formatInteger(km)} km`;
}

/** Steuersatz in Basispunkten: 1900 → "19 %", 700 → "7 %", 1950 → "19,5 %". */
export function formatVatRate(vatRateBp: number): string {
  if (!Number.isInteger(vatRateBp)) throw new DomainError('INVALID_RATE', 'Steuersatz muss ganzzahlig sein');
  const whole = Math.trunc(vatRateBp / 100);
  const frac = String(Math.abs(vatRateBp % 100)).padStart(2, '0').replace(/0+$/, '');
  return frac.length > 0 ? `${whole},${frac} %` : `${whole} %`;
}

/**
 * Datum deutsch: "2026-09-26" → "26.09.2026". Ein Zeitpunkt (Date oder ISO-8601 mit Uhrzeit)
 * wird zuerst in Berliner Ortszeit umgerechnet.
 */
export function formatDate(value: IsoDate | Date | string): string {
  if (typeof value === 'string' && isIsoDate(value)) {
    const { year, month, day } = parseIsoDate(value);
    return `${two(day)}.${two(month)}.${String(year).padStart(4, '0')}`;
  }
  const local = toBerlinLocal(value);
  return `${two(local.day)}.${two(local.month)}.${String(local.year).padStart(4, '0')}`;
}

/** Uhrzeit in Berliner Ortszeit: "2026-09-26T12:30:00Z" → "14:30". */
export function formatTime(value: Date | string): string {
  return toBerlinLocal(value).time;
}

/** Datum und Uhrzeit in Berliner Ortszeit: "2026-09-26T12:30:00Z" → "26.09.2026, 14:30". */
export function formatDateTime(value: Date | string): string {
  const local = toBerlinLocal(value);
  return `${two(local.day)}.${two(local.month)}.${String(local.year).padStart(4, '0')}, ${local.time}`;
}

function two(n: number): string {
  return String(n).padStart(2, '0');
}
