import { describe, expect, it } from 'vitest';
import { tid } from '../testing/fixtures';
import { planPaymentRecording } from './recording';
import { verifyProviderCheckout, type LocalCheckoutForVerification, type ProviderCheckout } from './sumup';

const MERCHANT = 'MTESTWERK';
const invoice = { id: tid(2001) };
const localCheckout: LocalCheckoutForVerification = {
  id: tid(2101),
  invoiceId: invoice.id,
  checkoutReference: 'RE-TEST-2026-0001-a1',
  providerCheckoutId: 'sumup-test-checkout-1',
  amountCents: 19_999,
  currency: 'EUR',
};

function provider(over: Partial<ProviderCheckout> = {}): ProviderCheckout {
  return {
    id: 'sumup-test-checkout-1',
    checkout_reference: 'RE-TEST-2026-0001-a1',
    amount: 199.99,
    currency: 'EUR',
    merchant_code: MERCHANT,
    status: 'PAID',
    transactions: [
      { id: 'sumup-test-tx-1', transaction_code: 'TTEST01', status: 'SUCCESSFUL', amount: 199.99, currency: 'EUR', timestamp: '2026-09-26T09:15:00.000Z' },
    ],
    ...over,
  };
}

const verify = (p: ProviderCheckout, over: Partial<Parameters<typeof verifyProviderCheckout>[0]> = {}) =>
  verifyProviderCheckout({ localCheckout, invoice, provider: p, expectedMerchantCode: MERCHANT, ...over });

describe('SumUp-Abgleich', () => {
  it('erfolgreiche Verifikation: bezahlt mit Betrag in Cent, Transaktion und Zeitpunkt', () => {
    expect(verify(provider())).toEqual({
      kind: 'paid',
      amountCents: 19_999,
      transactionId: 'sumup-test-tx-1',
      transactionCode: 'TTEST01',
      receivedAt: '2026-09-26T09:15:00.000Z',
    });
  });

  it('rechnet Beträge ohne Gleitkommafehler um (19,99 € = 1999 Cent)', () => {
    const local = { ...localCheckout, amountCents: 1_999 };
    const p = provider({ amount: 19.99, transactions: [{ ...provider().transactions![0]!, amount: 19.99 }] });
    expect(verifyProviderCheckout({ localCheckout: local, invoice, provider: p, expectedMerchantCode: MERCHANT }).kind).toBe('paid');
  });

  it('falscher Betrag → rejected', () => {
    expect(verify(provider({ amount: 199.98 }))).toMatchObject({ kind: 'rejected', reason: 'AMOUNT_MISMATCH' });
    expect(verify(provider({ amount: 199.999 }))).toMatchObject({ kind: 'rejected', reason: 'INVALID_AMOUNT' });
    expect(verify(provider({ transactions: [{ ...provider().transactions![0]!, amount: 100 }] }))).toMatchObject({ kind: 'rejected', reason: 'TRANSACTION_MISMATCH' });
  });

  it('falsche Währung → rejected', () => {
    expect(verify(provider({ currency: 'CHF' }))).toMatchObject({ kind: 'rejected', reason: 'CURRENCY_MISMATCH' });
    expect(verify(provider({ transactions: [{ ...provider().transactions![0]!, currency: 'USD' }] }))).toMatchObject({
      kind: 'rejected',
      reason: 'TRANSACTION_MISMATCH',
    });
  });

  it('falscher Händler → rejected', () => {
    expect(verify(provider({ merchant_code: 'MANDERER' }))).toMatchObject({ kind: 'rejected', reason: 'MERCHANT_MISMATCH' });
    expect(verify(provider(), { expectedMerchantCode: '' })).toMatchObject({ kind: 'rejected', reason: 'MERCHANT_NOT_CONFIGURED' });
    expect(verify(provider({ transactions: [{ ...provider().transactions![0]!, merchant_code: 'MANDERER' }] }))).toMatchObject({
      kind: 'rejected',
      reason: 'TRANSACTION_MISMATCH',
    });
  });

  it('falsche Referenz oder Checkout-ID → rejected', () => {
    expect(verify(provider({ checkout_reference: 'RE-ANDERE' }))).toMatchObject({ kind: 'rejected', reason: 'REFERENCE_MISMATCH' });
    expect(verify(provider({ id: 'sumup-fremd' }))).toMatchObject({ kind: 'rejected', reason: 'CHECKOUT_ID_MISMATCH' });
  });

  it('Checkout einer anderen Rechnung → rejected', () => {
    expect(verify(provider(), { invoice: { id: tid(2999) } })).toMatchObject({ kind: 'rejected', reason: 'INVOICE_MISMATCH' });
  });

  it('PENDING → pending, EXPIRED → expired', () => {
    expect(verify(provider({ status: 'PENDING', transactions: [] }))).toEqual({ kind: 'pending' });
    expect(verify(provider({ status: 'EXPIRED', transactions: [] }))).toEqual({ kind: 'expired' });
  });

  it('PAID ohne erfolgreiche Transaktion oder mit mehreren → rejected', () => {
    expect(verify(provider({ transactions: [] }))).toMatchObject({ kind: 'rejected', reason: 'NO_SUCCESSFUL_TRANSACTION' });
    expect(verify(provider({ transactions: [{ ...provider().transactions![0]!, status: 'FAILED' }] }))).toMatchObject({
      kind: 'rejected',
      reason: 'NO_SUCCESSFUL_TRANSACTION',
    });
    const tx = provider().transactions![0]!;
    expect(verify(provider({ transactions: [tx, { ...tx, id: 'sumup-test-tx-2' }] }))).toMatchObject({
      kind: 'rejected',
      reason: 'MULTIPLE_SUCCESSFUL_TRANSACTIONS',
    });
  });

  it('FAILED ist nicht endgültig: später PAID → bezahlt', () => {
    const failedTx = { ...provider().transactions![0]!, id: 'sumup-test-tx-0', status: 'FAILED' as const };
    const first = verify(provider({ status: 'FAILED', transactions: [failedTx] }));
    expect(first).toEqual({ kind: 'failed' });
    const later = verify(provider({ status: 'PAID', transactions: [failedTx, provider().transactions![0]!] }));
    expect(later).toMatchObject({ kind: 'paid', transactionId: 'sumup-test-tx-1' });
  });
});

describe('Buchung verifizierter Zahlungen', () => {
  const checkout = { id: localCheckout.id, invoiceId: invoice.id };

  it('bucht eine verifizierte Zahlung', () => {
    const plan = planPaymentRecording({ existingPayments: [], verification: verify(provider()), checkout });
    expect(plan).toEqual({
      action: 'record',
      payment: {
        invoiceId: invoice.id,
        checkoutId: localCheckout.id,
        method: 'sumup_online',
        amountCents: 19_999,
        currency: 'EUR',
        provider: 'sumup',
        providerTransactionId: 'sumup-test-tx-1',
        receivedAt: '2026-09-26T09:15:00.000Z',
      },
      checkoutUpdate: { checkoutId: localCheckout.id, status: 'paid', providerTransactionId: 'sumup-test-tx-1' },
    });
  });

  it('doppelt gemeldete Zahlung (Webhook und Statusabfrage) → noop', () => {
    const existingPayments = [{ provider: 'sumup', providerTransactionId: 'sumup-test-tx-1' }];
    expect(planPaymentRecording({ existingPayments, verification: verify(provider()), checkout })).toEqual({ action: 'noop', reason: 'already_recorded' });
  });

  it('nicht bezahlte oder abgelehnte Checkouts werden nie gebucht', () => {
    for (const verification of [verify(provider({ status: 'PENDING' })), verify(provider({ status: 'FAILED' })), verify(provider({ amount: 1 }))]) {
      expect(planPaymentRecording({ existingPayments: [], verification, checkout })).toEqual({ action: 'noop', reason: 'not_paid' });
    }
  });

  it('gleiche Transaktions-ID eines anderen Anbieters ist keine Dublette', () => {
    const existingPayments = [{ provider: null, providerTransactionId: 'sumup-test-tx-1' }];
    expect(planPaymentRecording({ existingPayments, verification: verify(provider()), checkout }).action).toBe('record');
  });
});
