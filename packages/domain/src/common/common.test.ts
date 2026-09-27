import { describe, expect, it } from 'vitest';
import { addDays, addMonths, daysBetween, isIsoDate, parseIsoDate } from './dates';
import { canonicalJson, isSha256Hex, normalizeOptionalText, normalizeText, sha256Hex, utf8Encode } from './hash';
import { canonicalQuantity, eurDecimalToCents, lineNetCents, vatCents } from './money';
import { DomainError } from './result';

describe('SHA-256 und UTF-8', () => {
  it('liefert die bekannten Prüfwerte', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(isSha256Hex(sha256Hex('[TEST] Ölwechsel'))).toBe(true);
  });

  it('kodiert Umlaute, Euro-Zeichen und Emoji korrekt als UTF-8', () => {
    expect([...utf8Encode('Ö')]).toEqual([0xc3, 0x96]);
    expect([...utf8Encode('€')]).toEqual([0xe2, 0x82, 0xac]);
    expect([...utf8Encode('\u{1F600}')]).toEqual([0xf0, 0x9f, 0x98, 0x80]);
    expect([...utf8Encode('\ud800')]).toEqual([0xef, 0xbf, 0xbd]);
  });
});

describe('Kanonisches JSON', () => {
  it('sortiert Schlüssel rekursiv und lässt undefined weg', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: 'x' }, e: undefined })).toBe('{"a":{"c":"x","d":[1,2]},"b":1}');
  });

  it('ergibt bei anderer Schlüsselreihenfolge denselben Text', () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });

  it('wandelt -0 in 0 und lehnt nicht darstellbare Werte ab', () => {
    expect(canonicalJson(-0)).toBe('0');
    expect(() => canonicalJson(Number.NaN)).toThrow(DomainError);
    expect(() => canonicalJson(new Date())).toThrow(DomainError);
  });

  it('normalisiert Texte (Zeilenenden, NFC, Rand)', () => {
    expect(normalizeText('  a\r\nb  ')).toBe('a\nb');
    expect(normalizeText('Öl')).toBe('Öl');
    expect(normalizeOptionalText('   ')).toBeNull();
  });
});

describe('Geldrechnung', () => {
  it('rechnet Mengen mit Nachkommastellen ohne Gleitkommafehler', () => {
    expect(lineNetCents(1.5, 8990)).toBe(13485);
    expect(lineNetCents(0.1 + 0.2, 1000)).toBe(300);
    expect(lineNetCents(3, 1999)).toBe(5997);
  });

  it('rundet kaufmännisch (ab ,5 vom Nullpunkt weg)', () => {
    expect(lineNetCents(0.5, 1)).toBe(1);
    expect(lineNetCents(0.5, -1)).toBe(-1);
    expect(lineNetCents(0.25, 1)).toBe(0);
    expect(vatCents(1050, 1900)).toBe(200); // 199,5 → 200
    expect(vatCents(1049, 1900)).toBe(199); // 199,31 → 199
  });

  it('stellt Mengen kanonisch dar', () => {
    expect(canonicalQuantity(1.5)).toBe('1.5');
    expect(canonicalQuantity(2)).toBe('2');
    expect(canonicalQuantity(0.1 + 0.2)).toBe('0.3');
  });

  it('wandelt Euro-Dezimalbeträge exakt in Cent um', () => {
    expect(eurDecimalToCents(19.99)).toBe(1999);
    expect(eurDecimalToCents(0.1)).toBe(10);
    expect(eurDecimalToCents(1234.5)).toBe(123450);
    expect(eurDecimalToCents(100)).toBe(10000);
    expect(eurDecimalToCents('12.50')).toBe(1250);
    expect(eurDecimalToCents(19.999)).toBeNull();
    expect(eurDecimalToCents(Number.NaN)).toBeNull();
    expect(eurDecimalToCents(1e21)).toBeNull();
  });
});

describe('Datumsrechnung', () => {
  it('begrenzt Monatsaddition auf das Monatsende', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-09-26', 24)).toBe('2028-09-26');
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15');
  });

  it('zählt Tage zwischen Datumsangaben über die Zeitumstellung hinweg', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-09-26', '2026-09-20')).toBe(-6);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('lehnt ungültige Datumsangaben ab', () => {
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('26.09.2026')).toBe(false);
    expect(() => parseIsoDate('2026-13-01')).toThrow(DomainError);
  });
});
