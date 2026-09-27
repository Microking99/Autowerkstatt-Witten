import { describe, expect, it } from 'vitest';
import { berlinDateOf, berlinOffsetMinutes, toBerlinLocal } from './berlin';
import { formatCents, formatDate, formatDateTime, formatDecimal, formatInteger, formatKm, formatTime, formatVatRate } from './format';

describe('Deutsche Formatierung', () => {
  it('formatiert Centbeträge als Euro mit Tausenderpunkten', () => {
    expect(formatCents(12345)).toBe('123,45 €');
    expect(formatCents(123456789)).toBe('1.234.567,89 €');
    expect(formatCents(5)).toBe('0,05 €');
    expect(formatCents(0)).toBe('0,00 €');
    expect(formatCents(-500)).toBe('-5,00 €');
    expect(formatCents(100000, { withSymbol: false })).toBe('1.000,00');
  });

  it('lehnt nicht ganzzahlige Centbeträge ab', () => {
    expect(() => formatCents(12.5)).toThrow();
  });

  it('formatiert Kilometerstände und Zahlen', () => {
    expect(formatKm(123456)).toBe('123.456 km');
    expect(formatKm(0)).toBe('0 km');
    expect(formatKm(null)).toBe('unbekannt');
    expect(formatInteger(1000000)).toBe('1.000.000');
    expect(formatInteger(999)).toBe('999');
    expect(formatDecimal(1234.56, 1)).toBe('1.234,6');
    expect(formatDecimal(-0.04, 1)).toBe('0,0');
  });

  it('formatiert Steuersätze', () => {
    expect(formatVatRate(1900)).toBe('19 %');
    expect(formatVatRate(700)).toBe('7 %');
    expect(formatVatRate(1950)).toBe('19,5 %');
  });

  it('formatiert Datumsangaben ohne Zeitzonenverschiebung', () => {
    expect(formatDate('2026-09-26')).toBe('26.09.2026');
    expect(formatDate('2026-01-01')).toBe('01.01.2026');
  });

  it('formatiert Zeitpunkte in Berliner Ortszeit (Sommer- und Winterzeit)', () => {
    expect(formatDateTime('2026-09-26T12:30:00Z')).toBe('26.09.2026, 14:30');
    expect(formatTime('2026-09-26T12:30:00Z')).toBe('14:30');
    expect(formatDateTime('2026-12-24T17:05:00Z')).toBe('24.12.2026, 18:05');
    expect(formatDate('2026-09-26T22:30:00Z')).toBe('27.09.2026');
    expect(formatDateTime(new Date(Date.UTC(2026, 0, 1, 0, 0)))).toBe('01.01.2026, 01:00');
  });

  it('stellt an den Umstellungszeitpunkten korrekt um', () => {
    expect(formatTime('2026-03-29T00:59:00Z')).toBe('01:59');
    expect(formatTime('2026-03-29T01:00:00Z')).toBe('03:00');
    expect(formatTime('2026-10-25T00:59:00Z')).toBe('02:59');
    expect(formatTime('2026-10-25T01:00:00Z')).toBe('02:00');
    expect(berlinOffsetMinutes('2026-07-01T00:00:00Z')).toBe(120);
    expect(berlinOffsetMinutes('2026-01-01T00:00:00Z')).toBe(60);
  });

  it('liefert Kalendertag und Wochentag in Berlin', () => {
    expect(berlinDateOf('2026-09-26T21:59:59Z')).toBe('2026-09-26');
    expect(berlinDateOf('2026-09-26T22:00:00Z')).toBe('2026-09-27');
    expect(toBerlinLocal('2026-09-28T08:00:00Z').weekday).toBe(1); // Montag
    expect(toBerlinLocal('2026-09-27T08:00:00Z').weekday).toBe(7); // Sonntag
  });

  it('stimmt mit Intl (Europe/Berlin) über viele Jahre überein', () => {
    const intl = new Intl.DateTimeFormat('de-DE', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const viaIntl = (d: Date): string => {
      const parts = Object.fromEntries(intl.formatToParts(d).map((p) => [p.type, p.value]));
      return `${parts.day}.${parts.month}.${parts.year}, ${parts.hour}:${parts.minute}`;
    };
    const samples: Date[] = [];
    // Umstellungszeitpunkte 1996 bis 2040, jeweils ± 1 Minute und ± 1 Stunde
    for (let year = 1996; year <= 2040; year++) {
      for (const month of [2, 9]) {
        const lastDay = new Date(Date.UTC(year, month + 1, 0));
        const sunday = lastDay.getUTCDate() - lastDay.getUTCDay();
        const switchAt = Date.UTC(year, month, sunday, 1);
        for (const delta of [-3_600_000, -60_000, 0, 60_000, 3_600_000]) samples.push(new Date(switchAt + delta));
      }
    }
    // Raster alle 7 Stunden über 2024 bis 2028
    for (let t = Date.UTC(2024, 0, 1); t < Date.UTC(2029, 0, 1); t += 7 * 3_600_000) samples.push(new Date(t));
    for (const d of samples) expect(formatDateTime(d)).toBe(viaIntl(d));
  });
});
