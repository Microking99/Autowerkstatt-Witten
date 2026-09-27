import { describe, expect, it } from 'vitest';
import { computeInvoicePaymentStatus, type InvoicePaymentInput } from './status';

const issued = (over: Partial<InvoicePaymentInput> = {}): InvoicePaymentInput => ({ status: 'issued', totalGrossCents: 10_000, dueDate: '2026-10-10', ...over });
const today = '2026-09-26';

describe('Zahlungsstatus einer Rechnung', () => {
  it('gestellte Rechnung ohne Zahlung ist offen', () => {
    expect(computeInvoicePaymentStatus({ invoice: issued(), payments: [], refunds: [], today })).toMatchObject({
      status: 'open',
      paidCents: 0,
      openCents: 10_000,
      overdue: false,
      overpaid: false,
    });
  });

  it('Teilzahlung', () => {
    expect(computeInvoicePaymentStatus({ invoice: issued(), payments: [{ amountCents: 3_000 }], refunds: [], today })).toMatchObject({
      status: 'partially_paid',
      paidCents: 3_000,
      openCents: 7_000,
    });
  });

  it('vollständig bezahlt, auch über mehrere Zahlungen', () => {
    expect(computeInvoicePaymentStatus({ invoice: issued(), payments: [{ amountCents: 3_000 }, { amountCents: 7_000 }], refunds: [], today })).toMatchObject({
      status: 'paid',
      openCents: 0,
      overpaidCents: 0,
    });
  });

  it('Überzahlung wird erkannt und gemeldet', () => {
    const s = computeInvoicePaymentStatus({ invoice: issued(), payments: [{ amountCents: 10_000 }, { amountCents: 2_500 }], refunds: [], today });
    expect(s).toMatchObject({ status: 'paid', openCents: 0, overpaid: true, overpaidCents: 2_500 });
  });

  it('Teilerstattung und Vollerstattung', () => {
    const payments = [{ amountCents: 10_000 }];
    expect(computeInvoicePaymentStatus({ invoice: issued(), payments, refunds: [{ amountCents: 3_000, status: 'succeeded' }], today })).toMatchObject({
      status: 'partially_refunded',
      refundedCents: 3_000,
      openCents: 0,
    });
    expect(computeInvoicePaymentStatus({ invoice: issued(), payments, refunds: [{ amountCents: 10_000, status: 'succeeded' }], today })).toMatchObject({
      status: 'refunded',
      refundedCents: 10_000,
    });
  });

  it('nur erfolgreiche Erstattungen zählen', () => {
    const s = computeInvoicePaymentStatus({
      invoice: issued(),
      payments: [{ amountCents: 10_000 }],
      refunds: [{ amountCents: 3_000, status: 'requested' }, { amountCents: 2_000, status: 'failed' }],
      today,
    });
    expect(s).toMatchObject({ status: 'paid', refundedCents: 0 });
  });

  it('erstattete Überzahlung lässt die Rechnung bezahlt', () => {
    const s = computeInvoicePaymentStatus({
      invoice: issued(),
      payments: [{ amountCents: 12_000 }],
      refunds: [{ amountCents: 2_000, status: 'succeeded' }],
      today,
    });
    expect(s).toMatchObject({ status: 'paid', overpaid: false });
  });

  it('überfällig nur bei offenem Betrag nach dem Fälligkeitsdatum', () => {
    expect(computeInvoicePaymentStatus({ invoice: issued({ dueDate: '2026-09-25' }), payments: [], refunds: [], today }).overdue).toBe(true);
    expect(computeInvoicePaymentStatus({ invoice: issued({ dueDate: '2026-09-26' }), payments: [], refunds: [], today }).overdue).toBe(false);
    expect(computeInvoicePaymentStatus({ invoice: issued({ dueDate: '2026-09-25' }), payments: [{ amountCents: 10_000 }], refunds: [], today }).overdue).toBe(false);
    expect(computeInvoicePaymentStatus({ invoice: issued({ dueDate: null }), payments: [], refunds: [], today }).overdue).toBe(false);
  });

  it('Entwurf hat keinen Kundenstatus', () => {
    expect(computeInvoicePaymentStatus({ invoice: issued({ status: 'draft' }), payments: [], refunds: [], today })).toMatchObject({
      status: 'no_invoice',
      customerVisible: false,
      openCents: 0,
    });
  });

  it('storniert: nie überfällig, bereits gezahltes Geld ist Überzahlung', () => {
    const s = computeInvoicePaymentStatus({ invoice: issued({ status: 'cancelled', dueDate: '2026-01-01' }), payments: [{ amountCents: 4_000 }], refunds: [], today });
    expect(s).toMatchObject({ status: 'cancelled', overdue: false, openCents: 0, overpaid: true, overpaidCents: 4_000 });
  });
});
