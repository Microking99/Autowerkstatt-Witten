/**
 * Deutsche Formate (docs/designsystem.md, Abschnitt 8):
 * Datum 26.09.2026, Uhrzeit 14:30, Betrag 1.234,56 €, Laufleistung 123.456 km.
 * Bewusst ohne Intl, damit Ausgabe auf allen Plattformen identisch ist.
 */

const NBSP = ' ';

export function groupThousands(value: number): string {
  const negative = value < 0;
  const digits = Math.abs(Math.trunc(value)).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return negative ? `-${grouped}` : grouped;
}

export function formatMoney(cents: number, currency: 'EUR' = 'EUR'): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const rest = (abs % 100).toString().padStart(2, '0');
  const symbol = currency === 'EUR' ? '€' : currency;
  return `${negative ? '-' : ''}${groupThousands(euros)},${rest}${NBSP}${symbol}`;
}

export function formatKm(km: number | null | undefined): string {
  if (km === null || km === undefined) return 'unbekannt';
  return `${groupThousands(km)}${NBSP}km`;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Akzeptiert ISO-Zeitpunkt oder ISO-Datum (YYYY-MM-DD, dann ohne Zeitzonenverschiebung). */
export function toDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, d);
  }
  return new Date(value);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return 'ohne Datum';
  const d = toDate(value);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function formatTime(value: string | Date): string {
  const d = toDate(value);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return 'ohne Datum';
  return `${formatDate(value)}, ${formatTime(value)} Uhr`;
}

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const WEEKDAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

export function weekday(value: string | Date, short = false): string {
  const d = toDate(value);
  return (short ? WEEKDAYS_SHORT : WEEKDAYS)[d.getDay()] ?? '';
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / 86_400_000);
}

/** "heute", "morgen", "gestern" oder "Mo, 28.09.2026". */
export function formatDayLabel(value: string | Date, now: Date = new Date()): string {
  const d = toDate(value);
  const diff = daysBetween(now, d);
  if (diff === 0) return 'heute';
  if (diff === 1) return 'morgen';
  if (diff === -1) return 'gestern';
  return `${weekday(d, true)}, ${formatDate(d)}`;
}

/** Zeitraum mit Bindestrich: "Mo, 28.09.2026, 8:00-9:30 Uhr" */
export function formatTimeRange(start: string | Date, end: string | Date, now: Date = new Date()): string {
  const s = toDate(start);
  const e = toDate(end);
  const day = formatDayLabel(s, now);
  const dayCap = day.charAt(0).toUpperCase() + day.slice(1);
  if (daysBetween(s, e) === 0) return `${dayCap}, ${formatTime(s)}-${formatTime(e)} Uhr`;
  return `${dayCap}, ${formatTime(s)} Uhr bis ${formatDayLabel(e, now)}, ${formatTime(e)} Uhr`;
}

export function formatRelativeTime(value: string | Date, now: Date = new Date()): string {
  const d = toDate(value);
  const minutes = Math.round((now.getTime() - d.getTime()) / 60_000);
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes} Min.`;
  const diff = daysBetween(d, now);
  if (diff === 0) return `heute, ${formatTime(d)} Uhr`;
  if (diff === 1) return `gestern, ${formatTime(d)} Uhr`;
  return formatDate(d);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Byte`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/** Kennzeichen/FIN lesbar gruppieren, ohne den Inhalt zu verändern. */
export function formatVin(vin: string): string {
  return vin.replace(/(.{3})(.{6})(.{8})/, '$1 $2 $3');
}

export function formatPercentBp(bp: number): string {
  return `${(bp / 100).toString().replace('.', ',')}${NBSP}%`;
}

export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Kennzeichen nicht umbrechen ("EN-MK 3308" bleibt zusammen): geschützter Bindestrich und
 * geschütztes Leerzeichen innerhalb erkannter Kennzeichen, der übrige Text bleibt unverändert.
 */
export function keepPlates(text: string): string {
  return text
    .replace(/\b([AR])-(\d{4})-(\d{4})\b/g, '$1\u2011$2\u2011$3')
    .replace(/\b([A-ZÄÖÜ]{1,3})-([A-Z]{1,2}) (\d{1,4}[EH]?)\b/g, '$1\u2011$2\u00A0$3');
}
