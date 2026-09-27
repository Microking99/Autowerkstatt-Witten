/**
 * Exakte Geldrechnung in Cent.
 *
 * Mengen dürfen Dezimalzahlen sein (z. B. 1,5 Stunden). Damit Gleitkommafehler
 * (0,1 + 0,2) keine Cent-Abweichungen erzeugen, werden Mengen auf 6 Nachkommastellen als
 * Ganzzahl skaliert und mit BigInt multipliziert. Gerundet wird kaufmännisch
 * (ab ,5 vom Nullpunkt weg).
 */
import { DomainError } from './result';

/** Skalierung für Mengen: 6 Nachkommastellen. */
export const QUANTITY_SCALE = 1_000_000;
const QUANTITY_SCALE_BIG = BigInt(QUANTITY_SCALE);

/** Menge als skalierte Ganzzahl (Menge × 10^6), kaufmännisch gerundet. */
export function scaleQuantity(quantity: number): bigint {
  if (!Number.isFinite(quantity)) throw new DomainError('INVALID_QUANTITY', 'Menge ist keine endliche Zahl');
  return BigInt(Math.round(quantity * QUANTITY_SCALE));
}

/** Kanonische Dezimaldarstellung einer Menge ("1.5", "2", "0.333333"). */
export function canonicalQuantity(quantity: number): string {
  const scaled = scaleQuantity(quantity);
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = abs / QUANTITY_SCALE_BIG;
  const frac = (abs % QUANTITY_SCALE_BIG).toString().padStart(6, '0').replace(/0+$/, '');
  const text = frac.length > 0 ? `${whole.toString()}.${frac}` : whole.toString();
  return negative && text !== '0' ? `-${text}` : text;
}

/** Division mit kaufmännischer Rundung (ab ,5 vom Nullpunkt weg). */
export function divRoundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new DomainError('DIVISION_BY_ZERO', 'Division durch null');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n * 2n + d) / (2n * d);
  return negative ? -q : q;
}

/** Zeilenbetrag netto in Cent: Menge × Einzelpreis, kaufmännisch auf Cent gerundet. */
export function lineNetCents(quantity: number, unitPriceCents: number): number {
  if (!Number.isInteger(unitPriceCents)) throw new DomainError('INVALID_PRICE', 'Einzelpreis muss ganzzahlig in Cent sein');
  const cents = divRoundHalfAwayFromZero(scaleQuantity(quantity) * BigInt(unitPriceCents), QUANTITY_SCALE_BIG);
  return toSafeNumber(cents);
}

/** Umsatzsteuer in Cent für einen Nettobetrag und einen Satz in Basispunkten (1900 = 19 %). */
export function vatCents(netCents: number, vatRateBp: number): number {
  if (!Number.isInteger(netCents) || !Number.isInteger(vatRateBp)) {
    throw new DomainError('INVALID_AMOUNT', 'Betrag und Steuersatz müssen ganzzahlig sein');
  }
  return toSafeNumber(divRoundHalfAwayFromZero(BigInt(netCents) * BigInt(vatRateBp), 10_000n));
}

/**
 * Wandelt einen Euro-Betrag als Dezimalzahl (wie in der SumUp-API, z. B. `19.99`) exakt in
 * Cent um. Liefert `null`, wenn der Wert nicht endlich ist oder mehr als zwei
 * Nachkommastellen hat (dann ist ein exakter Abgleich unmöglich).
 *
 * Umsetzung über die kürzeste Dezimaldarstellung der Zahl (`String(19.99) === "19.99"`),
 * nicht über `amount * 100` (das ergäbe 1998.9999999999998).
 */
export function eurDecimalToCents(amount: number | string): number | null {
  const text = typeof amount === 'number' ? (Number.isFinite(amount) ? String(amount) : '') : amount.trim();
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return null;
  const whole = Number(m[2]);
  const frac = Number((m[3] ?? '').padEnd(2, '0'));
  const cents = whole * 100 + frac;
  if (!Number.isSafeInteger(cents)) return null;
  return m[1] ? -cents : cents;
}

function toSafeNumber(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new DomainError('AMOUNT_TOO_LARGE', 'Betrag ist zu groß');
  return n;
}
