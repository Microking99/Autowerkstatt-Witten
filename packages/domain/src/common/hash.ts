/**
 * Plattformneutrales Hashing (Node, React Native, Browser) und kanonisches JSON.
 *
 * - SHA-256 über `@noble/hashes` (kein `node:crypto`, keine Web-Crypto-Abhängigkeit).
 * - UTF-8-Kodierung selbst implementiert, damit kein `TextEncoder` nötig ist
 *   (nicht in jeder JavaScript-Laufzeit vorhanden).
 * - Kanonisches JSON: Objektschlüssel rekursiv sortiert, keine Leerzeichen, `undefined`
 *   entfällt; nur endliche Zahlen. Damit ergibt derselbe Inhalt immer denselben Hash.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { DomainError } from './result';

/** Kodiert eine Zeichenkette als UTF-8. Einzelne Surrogate werden zu U+FFFD (wie TextEncoder). */
export function utf8Encode(input: string): Uint8Array {
  const bytes: number[] = [];
  for (const ch of input) {
    let cp = ch.codePointAt(0) ?? 0xfffd;
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
    if (cp < 0x80) {
      bytes.push(cp);
    } else if (cp < 0x800) {
      bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
  }
  return Uint8Array.from(bytes);
}

/** SHA-256 einer Zeichenkette (UTF-8) als Hex (64 Kleinbuchstaben). */
export function sha256Hex(input: string): string {
  return bytesToHex(sha256(utf8Encode(input)));
}

/** true, wenn der Wert wie ein SHA-256-Hex-Hash aussieht (64 Hex-Zeichen, klein). */
export function isSha256Hex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/**
 * Kanonische JSON-Darstellung: Schlüssel sortiert (UTF-16-Codeeinheiten), keine Leerzeichen,
 * `undefined`-Eigenschaften entfallen, `-0` wird `0`. Wirft bei nicht darstellbaren Werten
 * (NaN, Infinity, Date, BigInt, Funktionen), damit nichts stillschweigend verloren geht.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new DomainError('NOT_CANONICAL', 'Zahl ist nicht endlich');
      return Object.is(value, -0) ? '0' : JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
      }
      const proto = Object.getPrototypeOf(value) as unknown;
      if (proto !== Object.prototype && proto !== null) {
        throw new DomainError('NOT_CANONICAL', 'Nur einfache Objekte sind kanonisierbar (z. B. kein Date)');
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((k) => record[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(',')}}`;
    }
    default:
      throw new DomainError('NOT_CANONICAL', `Wert vom Typ ${typeof value} ist nicht kanonisierbar`);
  }
}

/**
 * Vereinheitlicht Freitext für Hashes: Zeilenenden `\n`, Unicode-NFC (falls die Laufzeit
 * `String.prototype.normalize` bietet), Leerraum am Anfang/Ende entfernt.
 * Maßgeblich ist immer der von der API berechnete Hash.
 */
export function normalizeText(value: string): string {
  let s = value.replace(/\r\n?/g, '\n');
  if (typeof s.normalize === 'function') s = s.normalize('NFC');
  return s.trim();
}

/** Wie {@link normalizeText}; leere Texte werden `null`. */
export function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const s = normalizeText(value);
  return s.length > 0 ? s : null;
}

/** Vereinheitlicht eine ID (UUID) für Hashes: getrimmt, Kleinbuchstaben. */
export function normalizeId(value: string): string {
  return value.trim().toLowerCase();
}
