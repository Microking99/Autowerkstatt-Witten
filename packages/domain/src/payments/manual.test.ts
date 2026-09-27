import { describe, expect, it } from 'vitest';
import { admin, customerA, grant, mechanic, service, tid } from '../testing/fixtures';
import { refundableCents, validateManualPayment, validateRefund, type ExistingRefund } from './manual';

const now = new Date('2026-09-26T12:00:00Z');
const invoice = { id: tid(4001), status: 'issued' as const };
const manual = { method: 'bank_transfer' as const, amountCents: 5_000, receivedAt: '2026-09-25T09:00:00Z', referenceText: 'RE-TEST-0001' };

describe('Manuelle Zahlung', () => {
  it('Service mit Recht bucht eine Überweisung', () => {
    const r = validateManualPayment({ actor: service([grant('payments.recordManual')]), invoice, paymentStatus: { openCents: 10_000 }, payment: manual, now });
    expect(r).toMatchObject({ ok: true, value: { overpaymentCents: 0, payment: { method: 'bank_transfer', amountCents: 5_000, provider: null, recordedBy: tid(2) } } });
  });

  it('ohne Recht abgelehnt (Service ohne Zuweisung, Mechaniker, Kunde)', () => {
    for (const actor of [service(), mechanic(), customerA()]) {
      expect(validateManualPayment({ actor, invoice, paymentStatus: { openCents: 10_000 }, payment: manual, now })).toMatchObject({
        ok: false,
        error: { code: 'MISSING_PERMISSION' },
      });
    }
  });

  it('Online-Zahlungen nie manuell; nur gestellte Rechnungen; Pflichtangaben', () => {
    const base = { actor: admin(), invoice, paymentStatus: { openCents: 10_000 }, now };
    expect(validateManualPayment({ ...base, payment: { ...manual, method: 'sumup_online' } })).toMatchObject({ ok: false, error: { code: 'INVALID_METHOD' } });
    expect(validateManualPayment({ ...base, invoice: { ...invoice, status: 'draft' }, payment: manual })).toMatchObject({ ok: false, error: { code: 'INVOICE_NOT_ISSUED' } });
    expect(validateManualPayment({ ...base, payment: { ...manual, amountCents: 0 } })).toMatchObject({ ok: false, error: { code: 'INVALID_AMOUNT' } });
    expect(validateManualPayment({ ...base, payment: { ...manual, referenceText: ' ' } })).toMatchObject({ ok: false, error: { code: 'REFERENCE_REQUIRED' } });
    expect(validateManualPayment({ ...base, payment: { ...manual, receivedAt: '2026-09-27T09:00:00Z' } })).toMatchObject({ ok: false, error: { code: 'RECEIVED_IN_FUTURE' } });
  });

  it('Überzahlung nur mit ausdrücklicher Bestätigung', () => {
    const base = { actor: admin(), invoice, paymentStatus: { openCents: 3_000 }, payment: manual, now };
    expect(validateManualPayment(base)).toMatchObject({ ok: false, error: { code: 'EXCEEDS_OPEN_AMOUNT' } });
    expect(validateManualPayment({ ...base, acceptOverpayment: true })).toMatchObject({ ok: true, value: { overpaymentCents: 2_000 } });
  });
});

describe('Erstattungen', () => {
  const payment = { id: tid(4101), amountCents: 10_000 };
  const refunder = () => service([grant('payments.refund')]);
  const refund = (over: Partial<ExistingRefund>): ExistingRefund => ({ id: tid(4201), paymentId: payment.id, idempotencyKey: 'key-00000001', amountCents: 1_000, status: 'succeeded', ...over });

  it('Service ohne payments.refund kann nicht erstatten', () => {
    expect(validateRefund({ actor: service(), payment, existingRefunds: [], amountCents: 1_000, idempotencyKey: 'key-00000001' })).toMatchObject({
      ok: false,
      error: { code: 'MISSING_PERMISSION' },
    });
  });

  it('Teilerstattung und Vollerstattung', () => {
    const partial = validateRefund({ actor: refunder(), payment, existingRefunds: [], amountCents: 4_000, idempotencyKey: 'key-00000001' });
    expect(partial).toMatchObject({ ok: true, value: { action: 'create', refund: { amountCents: 4_000, status: 'requested' }, refundableAfterCents: 6_000 } });
    const full = validateRefund({ actor: admin(), payment, existingRefunds: [], amountCents: 10_000, idempotencyKey: 'key-00000002' });
    expect(full).toMatchObject({ ok: true, value: { action: 'create', refundableAfterCents: 0 } });
  });

  it('Erstattung über den Restbetrag wird abgelehnt (angeforderte zählen mit, fehlgeschlagene nicht)', () => {
    const existing = [refund({ amountCents: 6_000 }), refund({ id: tid(4202), idempotencyKey: 'key-00000002', amountCents: 3_000, status: 'requested' }), refund({ id: tid(4203), idempotencyKey: 'key-00000003', amountCents: 5_000, status: 'failed' })];
    expect(refundableCents(payment, existing)).toBe(1_000);
    expect(validateRefund({ actor: refunder(), payment, existingRefunds: existing, amountCents: 1_001, idempotencyKey: 'key-00000009' })).toMatchObject({
      ok: false,
      error: { code: 'EXCEEDS_REFUNDABLE' },
    });
    expect(validateRefund({ actor: refunder(), payment, existingRefunds: existing, amountCents: 1_000, idempotencyKey: 'key-00000009' }).ok).toBe(true);
  });

  it('gleicher Idempotenzschlüssel → derselbe Vorgang, keine zweite Erstattung', () => {
    const existing = [refund({ amountCents: 4_000, status: 'requested' })];
    expect(validateRefund({ actor: refunder(), payment, existingRefunds: existing, amountCents: 4_000, idempotencyKey: 'key-00000001' })).toEqual({
      ok: true,
      value: { action: 'existing', refundId: tid(4201), status: 'requested' },
    });
  });

  it('gleicher Schlüssel mit anderen Daten wird abgelehnt', () => {
    const existing = [refund({ amountCents: 4_000 })];
    expect(validateRefund({ actor: refunder(), payment, existingRefunds: existing, amountCents: 5_000, idempotencyKey: 'key-00000001' })).toMatchObject({
      ok: false,
      error: { code: 'IDEMPOTENCY_KEY_REUSED' },
    });
  });

  it('ungültige Beträge und Schlüssel', () => {
    expect(validateRefund({ actor: refunder(), payment, existingRefunds: [], amountCents: 0, idempotencyKey: 'key-00000001' })).toMatchObject({ ok: false, error: { code: 'INVALID_AMOUNT' } });
    expect(validateRefund({ actor: refunder(), payment, existingRefunds: [], amountCents: 100, idempotencyKey: 'kurz' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_IDEMPOTENCY_KEY' },
    });
  });
});
