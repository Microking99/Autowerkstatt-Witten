/**
 * Summen einer Freigabe- oder Rechnungsposition.
 *
 * Rundungsregel (kaufmännisch, ab ,5 vom Nullpunkt weg):
 * 1. Je Zeile: Netto = Menge × Einzelpreis, auf ganze Cent gerundet.
 * 2. Je Steuersatz: USt = Summe der Zeilennetto dieses Satzes × Satz, einmal auf Cent gerundet.
 * 3. Brutto = Netto gesamt + USt gesamt.
 * Mengen werden exakt auf 6 Nachkommastellen gerechnet (keine Gleitkommafehler).
 */
import { DomainError } from '../common/result';
import { lineNetCents, vatCents } from '../common/money';

/** Minimale Zeilendaten für die Summenbildung. */
export interface TotalsLine {
  quantity: number;
  unitPriceCents: number;
  /** Steuersatz in Basispunkten (1900 = 19 %). */
  vatRateBp: number;
}

export interface VatBreakdownEntry {
  vatRateBp: number;
  netCents: number;
  vatCents: number;
}

export interface Totals {
  /** Netto je Zeile (Reihenfolge wie Eingabe). */
  lineNetCents: number[];
  totalNetCents: number;
  /** Aufteilung nach Steuersatz, aufsteigend sortiert. */
  vatBreakdown: VatBreakdownEntry[];
  totalVatCents: number;
  totalGrossCents: number;
}

/** Berechnet Netto, USt je Satz und Brutto in Cent (Rundung siehe Dateikopf). */
export function calculateTotals(lines: readonly TotalsLine[]): Totals {
  const nets: number[] = [];
  const byRate = new Map<number, number>();
  for (const line of lines) {
    if (!Number.isInteger(line.vatRateBp) || line.vatRateBp < 0 || line.vatRateBp > 10_000) {
      throw new DomainError('INVALID_VAT_RATE', 'Steuersatz muss zwischen 0 und 10000 Basispunkten liegen');
    }
    const net = lineNetCents(line.quantity, line.unitPriceCents);
    nets.push(net);
    byRate.set(line.vatRateBp, (byRate.get(line.vatRateBp) ?? 0) + net);
  }
  const vatBreakdown = [...byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([vatRateBp, netCents]) => ({ vatRateBp, netCents, vatCents: vatCents(netCents, vatRateBp) }));
  const totalNetCents = nets.reduce((s, n) => s + n, 0);
  const totalVatCents = vatBreakdown.reduce((s, v) => s + v.vatCents, 0);
  return { lineNetCents: nets, totalNetCents, vatBreakdown, totalVatCents, totalGrossCents: totalNetCents + totalVatCents };
}
