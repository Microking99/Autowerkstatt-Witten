import { describe, expect, it } from 'vitest';
import { ApiError } from '../../errors';
import type { DCheckout, DInvoice, DPayment, DProviderCheckout } from '../model';
import { aggregatePaymentStatus, reconcileCheckout, registerProviderEvent, startCheckout, summarizeInvoice, validateManualPayment } from './payments';

const TODAY = '2026-09-26';
const NOW = '2026-09-26T10:00:00.000Z';
const MERCHANT = 'MDEMOWITTEN';

const invoice: DInvoice = {
  id: 'inv-1', invoiceNumber: 'R-2026-0311', workOrderId: 'wo-1', customerId: 'k-1', status: 'issued', issuedAt: NOW, dueDate: '2026-10-07',
  totalGrossCents: 9_996, currency: 'EUR', vatBreakdown: [], documentId: null, createdAt: NOW, cancelledAt: null,
};

function checkoutFor(inv: DInvoice, payments: DPayment[] = [], existing: DCheckout[] = []) {
  return startCheckout({
    invoice: inv, summary: summarizeInvoice(inv, payments, [], TODAY), existing, checkoutId: 'co-1', providerCheckoutId: 'pc-1', userId: 'u-kunde', now: NOW, hostedUrl: 'https://anbieter.example/pc-1',
  }).checkout;
}

const paidAtProvider = (c: DCheckout, over: Partial<DProviderCheckout> = {}): DProviderCheckout => ({
  providerCheckoutId: c.providerCheckoutId, checkoutReference: c.checkoutReference, merchantCode: MERCHANT, amountCents: c.amountCents, currency: 'EUR', status: 'PAID', transactionId: 'TX-1', ...over,
});

describe('Zahlungsstatus', () => {
  it('berechnet offen, teilweise bezahlt, bezahlt und überfällig', () => {
    expect(summarizeInvoice(invoice, [], [], TODAY)).toMatchObject({ paymentStatus: 'open', openCents: 9_996, overdue: false });
    const part = [{ id: 'p1', invoiceId: 'inv-1', method: 'bank_transfer', amountCents: 5_000, currency: 'EUR', provider: null, providerTransactionId: null, checkoutId: null, receivedAt: NOW, recordedBy: 'u', referenceText: 'x' }] satisfies DPayment[];
    expect(summarizeInvoice(invoice, part, [], TODAY)).toMatchObject({ paymentStatus: 'partially_paid', openCents: 4_996 });
    expect(summarizeInvoice({ ...invoice, dueDate: '2026-09-01' }, [], [], TODAY).overdue).toBe(true);
    expect(summarizeInvoice({ ...invoice, dueDate: '2026-09-01' }, [{ ...part[0]!, amountCents: 9_996 }], [], TODAY)).toMatchObject({ paymentStatus: 'paid', overdue: false });
  });

  it('fasst Auftragsstatus aus mehreren Rechnungen zusammen', () => {
    expect(aggregatePaymentStatus([])).toBe('no_invoice');
    const open = summarizeInvoice(invoice, [], [], TODAY);
    expect(aggregatePaymentStatus([open])).toBe('open');
  });
});

describe('"Jetzt bezahlen" ändert nichts am Rechnungsstatus (Regel 7)', () => {
  it('legt nur einen Zahlungsversuch an; die Rechnung bleibt offen', () => {
    const checkout = checkoutFor(invoice);
    expect(checkout).toMatchObject({ status: 'pending', amountCents: 9_996, checkoutReference: 'R-2026-0311-1' });
    expect(summarizeInvoice(invoice, [], [], TODAY).paymentStatus).toBe('open');
  });

  it('deaktiviert ältere offene Versuche', () => {
    const first = checkoutFor(invoice);
    const second = startCheckout({ invoice, summary: summarizeInvoice(invoice, [], [], TODAY), existing: [first], checkoutId: 'co-2', providerCheckoutId: 'pc-2', userId: 'u', now: NOW, hostedUrl: 'https://anbieter.example/pc-2' });
    expect(second.deactivatedIds).toEqual(['co-1']);
    expect(second.checkout.checkoutReference).toBe('R-2026-0311-2');
  });

  it('verweigert bezahlte oder stornierte Rechnungen', () => {
    expect(() => checkoutFor({ ...invoice, status: 'cancelled' })).toThrow(ApiError);
  });
});

describe('Anbieterbestätigung wird serverseitig geprüft', () => {
  it('bucht bei passender Bestätigung genau eine Zahlung', () => {
    const c = checkoutFor(invoice);
    const r = reconcileCheckout({ checkout: c, provider: paidAtProvider(c), payments: [], merchantCode: MERCHANT, paymentId: 'pay-1', now: NOW });
    expect(r.outcome).toBe('booked');
    expect(r.payment).toMatchObject({ amountCents: 9_996, providerTransactionId: 'TX-1', invoiceId: 'inv-1' });
    expect(summarizeInvoice(invoice, [r.payment!], [], TODAY).paymentStatus).toBe('paid');
  });

  it('bucht bei wiederholter Meldung derselben Transaktion nicht doppelt', () => {
    const c = checkoutFor(invoice);
    const first = reconcileCheckout({ checkout: c, provider: paidAtProvider(c), payments: [], merchantCode: MERCHANT, paymentId: 'pay-1', now: NOW });
    const second = reconcileCheckout({ checkout: first.checkout, provider: paidAtProvider(c), payments: [first.payment!], merchantCode: MERCHANT, paymentId: 'pay-2', now: NOW });
    expect(second.outcome).toBe('already_booked');
    expect(second.payment).toBeNull();
  });

  it.each([
    ['Betrag', { amountCents: 100 }],
    ['Währung', { currency: 'USD' }],
    ['Händler', { merchantCode: 'FREMD' }],
    ['Rechnungszuordnung', { checkoutReference: 'R-2026-9999-1' }],
  ])('bucht nicht bei abweichendem %s', (_label, over) => {
    const c = checkoutFor(invoice);
    const r = reconcileCheckout({ checkout: c, provider: paidAtProvider(c, over), payments: [], merchantCode: MERCHANT, paymentId: 'pay-1', now: NOW });
    expect(r.outcome).toBe('rejected');
    expect(r.payment).toBeNull();
  });

  it('Abbruch und Fehler lassen die Rechnung offen', () => {
    const c = checkoutFor(invoice);
    for (const status of ['FAILED', 'EXPIRED', 'PENDING'] as const) {
      const r = reconcileCheckout({ checkout: c, provider: paidAtProvider(c, { status, transactionId: null }), payments: [], merchantCode: MERCHANT, paymentId: 'p', now: NOW });
      expect(r.payment).toBeNull();
    }
    expect(summarizeInvoice(invoice, [], [], TODAY).paymentStatus).toBe('open');
  });

  it('zählt doppelte Anbieterereignisse, verarbeitet sie aber nur einmal', () => {
    const e = { dedupeKey: 'sumup:pc-1:PAID', eventType: 'CHECKOUT_STATUS_CHANGED', providerObjectId: 'pc-1' };
    const first = registerProviderEvent([], e, NOW);
    expect(first.duplicate).toBe(false);
    const second = registerProviderEvent(first.events, e, NOW);
    expect(second.duplicate).toBe(true);
    expect(second.events).toHaveLength(1);
    expect(second.events[0]?.receiveCount).toBe(2);
  });

  it('manuelle Zahlung darf den offenen Betrag nicht übersteigen', () => {
    const summary = summarizeInvoice(invoice, [], [], TODAY);
    expect(() => validateManualPayment(summary, 10_000)).toThrow(ApiError);
    expect(() => validateManualPayment(summary, 9_996)).not.toThrow();
  });
});
