import { describe, expect, it } from 'vitest';
import { tid } from '../testing/fixtures';
import { planCheckout, type ExistingCheckout } from './recording';
import { computeInvoicePaymentStatus, type InvoicePaymentInput } from './status';

const now = new Date('2026-09-26T10:00:00Z');
const invoiceRecord: InvoicePaymentInput & { id: string } = { id: tid(3001), status: 'issued', totalGrossCents: 20_000, dueDate: '2026-10-10' };
const statusOf = (paid: number[] = []) => computeInvoicePaymentStatus({ invoice: invoiceRecord, payments: paid.map((amountCents) => ({ amountCents })), refunds: [], today: '2026-09-26' });

describe('"Jetzt bezahlen" (Checkout planen)', () => {
  it('legt einen neuen Zahlungsversuch über den offenen Betrag an', () => {
    expect(planCheckout({ invoice: invoiceRecord, existingCheckouts: [], now, paymentStatus: statusOf() })).toEqual({
      action: 'create',
      amountCents: 20_000,
      currency: 'EUR',
      deactivateCheckoutIds: [],
    });
  });

  it('ändert den Rechnungs- und Zahlungsstatus nicht', () => {
    const before = statusOf();
    const snapshot = JSON.stringify(invoiceRecord);
    const plan = planCheckout({ invoice: invoiceRecord, existingCheckouts: [], now, paymentStatus: before });
    expect(plan).not.toHaveProperty('status');
    expect(plan).not.toHaveProperty('paymentStatus');
    expect(JSON.stringify(invoiceRecord)).toBe(snapshot);
    // Auch mit angelegtem (offenem) Zahlungsversuch bleibt die Rechnung offen: Zahlungsstatus zählt nur bestätigte Zahlungen.
    expect(statusOf().status).toBe('open');
    expect(statusOf()).toEqual(before);
  });

  it('verwendet einen offenen, gültigen Versuch über genau den offenen Betrag wieder', () => {
    const existing: ExistingCheckout[] = [
      { id: tid(3101), status: 'pending', amountCents: 20_000, validUntil: '2026-09-26T11:00:00Z' },
      { id: tid(3102), status: 'created', amountCents: 15_000, validUntil: '2026-09-26T11:00:00Z' },
    ];
    expect(planCheckout({ invoice: invoiceRecord, existingCheckouts: existing, now, paymentStatus: statusOf() })).toEqual({
      action: 'reuse',
      checkoutId: tid(3101),
      amountCents: 20_000,
      deactivateCheckoutIds: [tid(3102)],
    });
  });

  it('legt nach Teilzahlung neu an und deaktiviert ältere offene Versuche', () => {
    const existing: ExistingCheckout[] = [{ id: tid(3101), status: 'pending', amountCents: 20_000, validUntil: null }];
    expect(planCheckout({ invoice: invoiceRecord, existingCheckouts: existing, now, paymentStatus: statusOf([5_000]) })).toEqual({
      action: 'create',
      amountCents: 15_000,
      currency: 'EUR',
      deactivateCheckoutIds: [tid(3101)],
    });
  });

  it('abgelaufene oder bald ablaufende Versuche werden nicht wiederverwendet; fehlgeschlagene bleiben unberührt', () => {
    const existing: ExistingCheckout[] = [
      { id: tid(3101), status: 'created', amountCents: 20_000, validUntil: '2026-09-26T10:02:00Z' },
      { id: tid(3103), status: 'failed', amountCents: 20_000, validUntil: '2026-09-26T12:00:00Z' },
      { id: tid(3104), status: 'expired', amountCents: 20_000, validUntil: '2026-09-26T09:00:00Z' },
    ];
    const plan = planCheckout({ invoice: invoiceRecord, existingCheckouts: existing, now, paymentStatus: statusOf() });
    expect(plan).toEqual({ action: 'create', amountCents: 20_000, currency: 'EUR', deactivateCheckoutIds: [tid(3101)] });
  });

  it('lehnt ab bei bezahlter, stornierter Rechnung oder Entwurf', () => {
    expect(planCheckout({ invoice: invoiceRecord, existingCheckouts: [], now, paymentStatus: statusOf([20_000]) })).toMatchObject({ action: 'reject', code: 'NOTHING_OPEN' });
    expect(planCheckout({ invoice: { ...invoiceRecord, status: 'cancelled' }, existingCheckouts: [], now, paymentStatus: statusOf() })).toMatchObject({
      action: 'reject',
      code: 'INVOICE_CANCELLED',
    });
    expect(planCheckout({ invoice: { ...invoiceRecord, status: 'draft' }, existingCheckouts: [], now, paymentStatus: statusOf() })).toMatchObject({
      action: 'reject',
      code: 'INVOICE_DRAFT',
    });
  });
});
