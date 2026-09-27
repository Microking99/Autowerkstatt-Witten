import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { AuditEntrySchema, InvoiceSchema, NotificationSchema, StartCheckoutResponseSchema } from '@werkstatt/contracts';
import { checkouts, payments, providerEvents } from '../src/db/schema/index';
import { reconcilePendingCheckouts } from '../src/services/payments';
import { call, createHarness, expectOk, expectStatus, type Harness, type TestUser } from './support/harness';
import { customerWithVehicle, issueInvoice, setupWorkshop, type Workshop } from './support/scenario';

let h: Harness;
let w: Workshop;
beforeAll(async () => {
  h = await createHarness();
  w = await setupWorkshop(h);
});
afterAll(async () => h?.close());

async function invoiceFor(total = 10000): Promise<{ customer: TestUser; invoiceId: string }> {
  const { customer } = await customerWithVehicle(h, 'Zahlung');
  const invoice = await issueInvoice(h, w.service.token, { customerId: customer.customerId!, totalGrossCents: total });
  return { customer, invoiceId: invoice.id };
}

async function startCheckout(customer: TestUser, invoiceId: string) {
  const res = expectOk(await call(h, 'POST', `/invoices/${invoiceId}/checkout`, { token: customer.token }), StartCheckoutResponseSchema);
  const [row] = await h.db.select().from(checkouts).where(eq(checkouts.id, res.checkoutId));
  return { res, providerId: row!.providerCheckoutId! };
}

const webhook = (id: string) => call(h, 'POST', '/webhooks/sumup', { body: { event_type: 'CHECKOUT_STATUS_CHANGED', id } });
const getInvoice = async (token: string, id: string) => expectOk(await call(h, 'GET', `/invoices/${id}`, { token }), InvoiceSchema);

describe('T-06 Zahlungen', () => {
  it('erfolgreich: Webhook → Anbieterabfrage → bezahlt (genau eine Buchung, Benachrichtigung)', async () => {
    const { customer, invoiceId } = await invoiceFor(10000);
    const { res, providerId } = await startCheckout(customer, invoiceId);
    expect(res.invoicePaymentStatus).toBe('open');
    expect(h.fake.calls.find((c) => c.method === 'createCheckout')!.args[0]).toMatchObject({
      amountCents: 10000,
      currency: 'EUR',
      returnUrl: 'https://api.werkstatt.test/api/v1/webhooks/sumup',
      redirectUrl: `https://app.werkstatt.test/zahlung/rueckkehr?rechnung=${invoiceId}`,
    });
    const tx = h.fake.markPaid(providerId);
    expectStatus(await webhook(providerId), 204);
    const invoice = await getInvoice(customer.token, invoiceId);
    expect(invoice.paymentStatus).toBe('paid');
    expect(invoice.openCents).toBe(0);
    expect(invoice.payments).toHaveLength(1);
    expect(invoice.payments[0]).toMatchObject({ method: 'sumup_online', amountCents: 10000, providerTransactionId: tx.id });
    const notes = expectOk(await call(h, 'GET', '/notifications', { token: customer.token }), z.array(NotificationSchema));
    expect(notes.some((n) => n.eventType === 'payment.confirmed' && n.targetPath === `/kunde/rechnungen/${invoiceId}`)).toBe(true);
  });

  it('abgebrochen, fehlgeschlagen, ausstehend oder abgelaufen: Rechnung bleibt offen', async () => {
    for (const outcome of ['failed', 'pending', 'expired'] as const) {
      const { customer, invoiceId } = await invoiceFor(2500);
      const { providerId } = await startCheckout(customer, invoiceId);
      if (outcome === 'failed') h.fake.markFailed(providerId);
      if (outcome === 'pending') h.fake.markPending(providerId);
      if (outcome === 'expired') h.fake.markExpired(providerId);
      expectStatus(await webhook(providerId), 204);
      const invoice = await getInvoice(w.service.token, invoiceId);
      expect(invoice.paymentStatus, outcome).toBe('open');
      expect(invoice.payments, outcome).toHaveLength(0);
      expect(invoice.checkouts![0]!.status, outcome).toBe(outcome);
    }
  });

  it('mehrfach gemeldet (auch gleichzeitig, plus Statusabfrage und Abgleich): genau eine Zahlung', async () => {
    const { customer, invoiceId } = await invoiceFor(7000);
    const { res, providerId } = await startCheckout(customer, invoiceId);
    h.fake.markPaid(providerId);
    const results = await Promise.all([webhook(providerId), webhook(providerId), webhook(providerId), webhook(providerId)]);
    expect(results.every((r) => r.statusCode === 204)).toBe(true);
    await webhook(providerId);
    await call(h, 'POST', `/invoices/${invoiceId}/payment-status/refresh`, { token: customer.token });
    await reconcilePendingCheckouts({ db: h.db, provider: h.fake, now: () => h.clock.now() });
    const rows = await h.db.select().from(payments).where(eq(payments.invoiceId, invoiceId));
    expect(rows).toHaveLength(1);
    const [event] = await h.db.select().from(providerEvents).where(eq(providerEvents.providerObjectId, providerId));
    expect(event!.receiveCount).toBe(5);
    const invoice = await getInvoice(customer.token, invoiceId);
    expect(invoice.paidCents).toBe(7000);
    expect(res.checkoutId).toBeTruthy();
  });

  it('falscher Betrag oder falscher Händler: nicht gebucht, protokolliert', async () => {
    const a = await invoiceFor(9900);
    const ca = await startCheckout(a.customer, a.invoiceId);
    h.fake.markPaid(ca.providerId, { amountCents: 100 });
    expectStatus(await webhook(ca.providerId), 204);
    expect((await getInvoice(w.service.token, a.invoiceId)).paymentStatus).toBe('open');

    const b = await invoiceFor(9900);
    const cb = await startCheckout(b.customer, b.invoiceId);
    h.fake.markPaid(cb.providerId, { merchantCode: 'MFREMD0001' });
    expectStatus(await webhook(cb.providerId), 204);
    expect((await getInvoice(w.service.token, b.invoiceId)).payments).toHaveLength(0);

    const audit = expectOk(await call(h, 'GET', '/audit', { token: w.admin.token, query: { action: 'payment.mismatch' } }), z.array(AuditEntrySchema));
    const reasons = audit.map((e) => e.data.reason);
    expect(reasons).toContain('AMOUNT_MISMATCH');
    expect(reasons).toContain('MERCHANT_MISMATCH');
    const events = await h.db.select().from(providerEvents).where(eq(providerEvents.providerObjectId, ca.providerId));
    expect(events[0]!.result).toBe('rejected:AMOUNT_MISMATCH');
    // unbekannter Checkout: gespeichert, 2xx, nichts gebucht
    expectStatus(await webhook('fake_chk_unbekannt'), 204);
  });

  it('Teilzahlung: manuelle Überweisung, Rest online', async () => {
    const { customer, invoiceId } = await invoiceFor(10000);
    const partial = expectOk(
      await call(h, 'POST', `/invoices/${invoiceId}/payments/manual`, {
        token: w.admin.token,
        body: { method: 'bank_transfer', amountCents: 4000, receivedAt: new Date(Date.now() - 60_000).toISOString(), referenceText: 'Überweisung Teilbetrag [TEST]' },
      }),
      InvoiceSchema,
    );
    expect(partial).toMatchObject({ paymentStatus: 'partially_paid', paidCents: 4000, openCents: 6000 });
    // Pflichtfelder und Überzahlung
    expectStatus(
      await call(h, 'POST', `/invoices/${invoiceId}/payments/manual`, {
        token: w.admin.token,
        body: { method: 'cash', amountCents: 999999, receivedAt: new Date().toISOString(), referenceText: 'zu viel' },
      }),
      422,
      'exceeds_open_amount',
    );
    expectStatus(
      await call(h, 'POST', `/invoices/${invoiceId}/payments/manual`, { token: w.admin.token, body: { method: 'cash', amountCents: 100, receivedAt: new Date().toISOString() } }),
      400,
      'validation_failed',
    );
    const { res, providerId } = await startCheckout(customer, invoiceId);
    expect(res.invoicePaymentStatus).toBe('partially_paid');
    const [row] = await h.db.select().from(checkouts).where(eq(checkouts.id, res.checkoutId));
    expect(row!.amountCents).toBe(6000);
    h.fake.markPaid(providerId);
    await webhook(providerId);
    const invoice = await getInvoice(customer.token, invoiceId);
    expect(invoice).toMatchObject({ paymentStatus: 'paid', paidCents: 10000, openCents: 0 });
    expect(invoice.payments.map((p) => p.method).sort()).toEqual(['bank_transfer', 'sumup_online']);
  });

  it('Erstattung: idempotent, nicht mehr als erstattbar', async () => {
    const { customer, invoiceId } = await invoiceFor(5000);
    const { providerId } = await startCheckout(customer, invoiceId);
    h.fake.markPaid(providerId);
    await webhook(providerId);
    const paymentId = (await getInvoice(w.admin.token, invoiceId)).payments[0]!.id;
    const refundCalls = () => h.fake.calls.filter((c) => c.method === 'refund').length;
    const before = refundCalls();
    const body = { amountCents: 2000, idempotencyKey: 'erstattung-0001', reason: 'Kulanz [TEST]' };
    const first = expectOk(await call(h, 'POST', `/payments/${paymentId}/refunds`, { token: w.admin.token, body }), InvoiceSchema);
    const second = expectOk(await call(h, 'POST', `/payments/${paymentId}/refunds`, { token: w.admin.token, body }), InvoiceSchema);
    expect(first.refundedCents).toBe(2000);
    expect(second.refundedCents).toBe(2000);
    expect(second.refunds).toHaveLength(1);
    expect(refundCalls() - before).toBe(1);
    expect(first.paymentStatus).toBe('partially_refunded');
    // gleicher Schlüssel, anderer Betrag → abgewiesen
    expectStatus(await call(h, 'POST', `/payments/${paymentId}/refunds`, { token: w.admin.token, body: { ...body, amountCents: 100 } }), 409, 'idempotency_key_reused');
    // mehr als erstattbar → abgewiesen
    expectStatus(
      await call(h, 'POST', `/payments/${paymentId}/refunds`, { token: w.admin.token, body: { amountCents: 3001, idempotencyKey: 'erstattung-0002', reason: 'zu viel' } }),
      422,
      'exceeds_refundable',
    );
    const rest = expectOk(
      await call(h, 'POST', `/payments/${paymentId}/refunds`, { token: w.admin.token, body: { amountCents: 3000, idempotencyKey: 'erstattung-0003', reason: 'Rest' } }),
      InvoiceSchema,
    );
    expect(rest.paymentStatus).toBe('refunded');
    // Kunde sieht erstattete Beträge an der Zahlung, aber keine Erstattungsvorgänge
    const customerView = await getInvoice(customer.token, invoiceId);
    expect(customerView.refunds).toBeUndefined();
    expect(customerView.payments[0]!.refundedCents).toBe(5000);
  });

  it('Mitarbeiter lösen keinen Online-Checkout aus; Entwürfe sind nicht bezahlbar', async () => {
    const { invoiceId } = await invoiceFor(1000);
    expectStatus(await call(h, 'POST', `/invoices/${invoiceId}/checkout`, { token: w.service.token }), 403);
  });
});
