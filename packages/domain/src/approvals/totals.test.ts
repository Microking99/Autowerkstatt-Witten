import { describe, expect, it } from 'vitest';
import { calculateTotals } from './totals';

describe('Summen', () => {
  it('berechnet Netto, USt je Satz und Brutto in Cent', () => {
    const t = calculateTotals([
      { quantity: 1.5, unitPriceCents: 8_990, vatRateBp: 1900 }, // 134,85 €
      { quantity: 2, unitPriceCents: 1_250, vatRateBp: 1900 }, // 25,00 €
      { quantity: 1, unitPriceCents: 1_000, vatRateBp: 700 }, // 10,00 €
    ]);
    expect(t.lineNetCents).toEqual([13_485, 2_500, 1_000]);
    expect(t.totalNetCents).toBe(16_985);
    expect(t.vatBreakdown).toEqual([
      { vatRateBp: 700, netCents: 1_000, vatCents: 70 },
      { vatRateBp: 1900, netCents: 15_985, vatCents: 3_037 }, // 3037,15 → 3037
    ]);
    expect(t.totalVatCents).toBe(3_107);
    expect(t.totalGrossCents).toBe(20_092);
  });

  it('rundet je Zeile kaufmännisch und die USt einmal je Satz', () => {
    // 0,333 × 1000 Cent = 333 Cent; 3 Zeilen = 999 Cent; USt 19 % auf 999 = 189,81 → 190
    const t = calculateTotals([
      { quantity: 0.333, unitPriceCents: 1_000, vatRateBp: 1900 },
      { quantity: 0.333, unitPriceCents: 1_000, vatRateBp: 1900 },
      { quantity: 0.333, unitPriceCents: 1_000, vatRateBp: 1900 },
    ]);
    expect(t.totalNetCents).toBe(999);
    expect(t.totalVatCents).toBe(190);
    expect(t.totalGrossCents).toBe(1_189);
  });

  it('leere Liste ergibt 0 und ungültige Sätze werden abgelehnt', () => {
    expect(calculateTotals([]).totalGrossCents).toBe(0);
    expect(() => calculateTotals([{ quantity: 1, unitPriceCents: 100, vatRateBp: 19.5 }])).toThrow();
  });
});
