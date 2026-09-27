import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { InvoiceSchema, StartCheckoutResponseSchema } from '@werkstatt/contracts';
import { checkouts, payments } from '../src/db/schema/index';
import { call, createHarness, expectOk, type Harness } from './support/harness';
import { customerWithVehicle, issueInvoice, setupWorkshop, type Workshop } from './support/scenario';

let h: Harness;
let w: Workshop;
beforeAll(async () => {
  h = await createHarness();
  w = await setupWorkshop(h);
});
afterAll(async () => h?.close());

describe('T-07 "Jetzt bezahlen" und Rückkehrseite ändern keinen Status', () => {
  it('Rechnung bleibt nach POST /invoices/:id/checkout und nach Rückkehr ohne Bestätigung offen', async () => {
    const { customer } = await customerWithVehicle(h, 'Rueckkehr');
    const invoice = await issueInvoice(h, w.service.token, { customerId: customer.customerId!, totalGrossCents: 23800 });
    expect(invoice.paymentStatus).toBe('open');

    const start = expectOk(await call(h, 'POST', `/invoices/${invoice.id}/checkout`, { token: customer.token }), StartCheckoutResponseSchema);
    expect(start.invoicePaymentStatus).toBe('open');
    expect(start.hostedUrl).toMatch(/^https:\/\//);
    const afterCheckout = expectOk(await call(h, 'GET', `/invoices/${invoice.id}`, { token: customer.token }), InvoiceSchema);
    expect(afterCheckout.paymentStatus).toBe('open');
    expect(afterCheckout.paidCents).toBe(0);

    // Zweiter Klick: höchstens ein Versuch wird wiederverwendet, keine Dopplung
    const again = expectOk(await call(h, 'POST', `/invoices/${invoice.id}/checkout`, { token: customer.token }), StartCheckoutResponseSchema);
    expect(again.checkoutId).toBe(start.checkoutId);

    // Rückkehrseite: App fragt den Serverstatus ab; der Anbieter meldet noch nichts Bestätigtes
    const afterReturn = expectOk(await call(h, 'POST', `/invoices/${invoice.id}/payment-status/refresh`, { token: customer.token }), InvoiceSchema);
    expect(afterReturn.paymentStatus).toBe('open');
    expect(afterReturn.payments).toHaveLength(0);
    // Auch eine behauptete Erfolgsseite (ohne Anbieterbestätigung) ändert nichts
    const [row] = await h.db.select().from(checkouts).where(eq(checkouts.id, start.checkoutId));
    expect(row!.status).toBe('pending');
    expect(await h.db.select().from(payments).where(eq(payments.invoiceId, invoice.id))).toHaveLength(0);

    // Erst die geprüfte Anbieterbestätigung setzt den Status
    h.fake.markPaid(row!.providerCheckoutId!);
    const confirmed = expectOk(await call(h, 'POST', `/invoices/${invoice.id}/payment-status/refresh`, { token: customer.token }), InvoiceSchema);
    expect(confirmed.paymentStatus).toBe('paid');
  });
});
