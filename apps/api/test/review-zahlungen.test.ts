/**
 * Review (Claude-Unteragent, 27.09.2026): Angriffsszenarien Zahlungen (C-02).
 * Tests prüfen das SOLL-Verhalten; Ergebnisse in docs/uebergaben/2026-09-27-review-claude.md.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { AuditEntrySchema, InvoiceSchema, StartCheckoutResponseSchema, WorkOrderDetailSchema, WorkshopSettingsSchema } from '@werkstatt/contracts';
import { checkouts, payments, providerEvents, refunds, serviceEntries } from '../src/db/schema/index';
import { SumUpPaymentProvider } from '../src/payments/sumupProvider';
import { reconcilePendingCheckouts } from '../src/services/payments';
import { PaymentProviderError } from '../src/payments/provider';
import { call, createHarness, expectOk, expectStatus, type Harness, type TestUser } from './support/harness';
import { customerWithVehicle, issueInvoice, setupWorkshop, workOrderWithFinishedMaintenance, type Workshop } from './support/scenario';

let h: Harness;
let w: Workshop;
beforeAll(async () => {
  h = await createHarness();
  w = await setupWorkshop(h);
});
afterAll(async () => h?.close());

const iso = (offsetMs = 0) => new Date(h.clock.now().getTime() + offsetMs).toISOString();
const webhook = (body: unknown) => call(h, 'POST', '/webhooks/sumup', { body });
const hook = (id: string) => webhook({ event_type: 'CHECKOUT_STATUS_CHANGED', id });
const getInvoice = async (token: string, id: string) => expectOk(await call(h, 'GET', `/invoices/${id}`, { token }), InvoiceSchema);

async function invoiceFor(total: number, lastName = 'Zahlreview'): Promise<{ customer: TestUser; invoiceId: string; vehicleId: string }> {
  const { customer, vehicleId } = await customerWithVehicle(h, lastName);
  const invoice = await issueInvoice(h, w.service.token, { customerId: customer.customerId!, totalGrossCents: total });
  return { customer, invoiceId: invoice.id, vehicleId };
}

async function checkout(customer: TestUser, invoiceId: string) {
  const res = expectOk(await call(h, 'POST', `/invoices/${invoiceId}/checkout`, { token: customer.token }), StartCheckoutResponseSchema);
  const [row] = await h.db.select().from(checkouts).where(eq(checkouts.id, res.checkoutId));
  return { res, row: row!, providerId: row!.providerCheckoutId! };
}

const paymentRows = (invoiceId: string) => h.db.select().from(payments).where(eq(payments.invoiceId, invoiceId));

describe('Z01 gefälschte und fremde Webhooks', () => {
  it('Inhalt des Webhooks (status, amount) zählt nicht; nur die Anbieterabfrage', async () => {
    const { customer, invoiceId } = await invoiceFor(10000);
    const { providerId } = await checkout(customer, invoiceId);
    for (const body of [
      { event_type: 'CHECKOUT_STATUS_CHANGED', id: providerId, status: 'PAID', amount: 100 },
      { event_type: 'CHECKOUT_STATUS_CHANGED', id: providerId, status: 'PAID', transactions: [{ id: 'txn_fake', status: 'SUCCESSFUL', amount: 100, currency: 'EUR' }] },
      { id: providerId, status: 'PAID' },
      { event_type: 'CHECKOUT_STATUS_CHANGED', id: 12345 },
      { event_type: 'CHECKOUT_STATUS_CHANGED' },
    ]) {
      expectStatus(await webhook(body), 204);
    }
    // kein JSON: abgelehnt, ohne Wirkung
    expect([204, 415]).toContain((await webhook('kein json objekt')).statusCode);
    expect(await paymentRows(invoiceId)).toHaveLength(0);
    expect((await getInvoice(customer.token, invoiceId)).paymentStatus).toBe('open');
  });

  it('Anbieter meldet PAID, aber Referenz, Checkout-ID, Währung, Transaktion oder Betragsformat passen nicht: keine Buchung', async () => {
    const cases: Array<[string, (id: string) => void]> = [
      ['REFERENCE_MISMATCH', (id) => { h.fake.markPaid(id); h.fake.tamper(id, { checkout_reference: 'AW-FREMD-123' }); }],
      ['CHECKOUT_ID_MISMATCH', (id) => { h.fake.markPaid(id); h.fake.tamper(id, { id: 'fake_chk_andere' }); }],
      ['CURRENCY_MISMATCH', (id) => { h.fake.markPaid(id, { currency: 'USD' }); }],
      ['TRANSACTION_MISMATCH', (id) => { h.fake.markPaid(id, { merchantCode: 'MFREMD0002' }); h.fake.tamper(id, { merchant_code: h.fake.merchantCode }); }],
      ['MULTIPLE_SUCCESSFUL_TRANSACTIONS', (id) => { h.fake.markPaid(id); h.fake.markPaid(id); }],
      ['NO_SUCCESSFUL_TRANSACTION', (id) => { h.fake.tamper(id, { status: 'PAID', transactions: [] }); }],
    ];
    for (const [reason, mutate] of cases) {
      const { customer, invoiceId } = await invoiceFor(4200);
      const { providerId } = await checkout(customer, invoiceId);
      mutate(providerId);
      expectStatus(await hook(providerId), 204);
      await call(h, 'POST', `/invoices/${invoiceId}/payment-status/refresh`, { token: customer.token });
      expect(await paymentRows(invoiceId), reason).toHaveLength(0);
      const [event] = await h.db.select().from(providerEvents).where(eq(providerEvents.providerObjectId, providerId));
      expect(event!.result, reason).toContain(reason);
    }
  });

  it('Beträge: Dezimal-EUR exakt in Cent (19.99 → 1999); Gleitkomma-Artefakte werden abgelehnt', async () => {
    const ok = await invoiceFor(1999);
    const c1 = await checkout(ok.customer, ok.invoiceId);
    expect(h.fake.checkouts.get(c1.providerId)!.amount).toBe(19.99);
    h.fake.markPaid(c1.providerId);
    expectStatus(await hook(c1.providerId), 204);
    expect((await getInvoice(ok.customer.token, ok.invoiceId)).paidCents).toBe(1999);

    const bad = await invoiceFor(30);
    const c2 = await checkout(bad.customer, bad.invoiceId);
    h.fake.markPaid(c2.providerId);
    const tampered = h.fake.checkouts.get(c2.providerId)!;
    h.fake.tamper(c2.providerId, { amount: 0.1 + 0.2, transactions: tampered.transactions!.map((t) => ({ ...t, amount: 0.1 + 0.2 })) });
    expectStatus(await hook(c2.providerId), 204);
    expect(await paymentRows(bad.invoiceId)).toHaveLength(0);
  });

  it('Webhook speichert nur die nötigen Felder (keine beliebigen Inhalte von außen)', async () => {
    const { customer, invoiceId } = await invoiceFor(1234);
    const { providerId } = await checkout(customer, invoiceId);
    expectStatus(await webhook({ event_type: 'CHECKOUT_STATUS_CHANGED', id: providerId, card: { pan: '4111111111111111', cvv: '123' }, padding: 'x'.repeat(20_000) }), 204);
    const [event] = await h.db.select().from(providerEvents).where(eq(providerEvents.providerObjectId, providerId));
    expect(Object.keys(event!.payload as Record<string, unknown>).sort()).toEqual(['event_type', 'id']);
    expect(JSON.stringify(event!.payload)).not.toContain('4111111111111111');
  });
});

describe('Z02 Statusfolgen und alte Versuche', () => {
  it('FAILED und danach PAID im selben Versuch: genau eine Buchung', async () => {
    const { customer, invoiceId } = await invoiceFor(5100);
    const { providerId } = await checkout(customer, invoiceId);
    h.fake.markFailed(providerId);
    expectStatus(await hook(providerId), 204);
    expect((await getInvoice(customer.token, invoiceId)).paymentStatus).toBe('open');
    const c = h.fake.checkouts.get(providerId)!;
    h.fake.tamper(providerId, { status: 'PAID', transactions: [...c.transactions!, { id: 'txn_nach_fehler', status: 'SUCCESSFUL', amount: 51, currency: 'EUR', timestamp: iso(), merchant_code: h.fake.merchantCode }] });
    await Promise.all([hook(providerId), hook(providerId), call(h, 'POST', `/invoices/${invoiceId}/payment-status/refresh`, { token: customer.token })]);
    expect(await paymentRows(invoiceId)).toHaveLength(1);
    expect((await getInvoice(customer.token, invoiceId)).paymentStatus).toBe('paid');
  });

  it('neuer Versuch nach Teilzahlung deaktiviert den alten; wird der alte trotzdem bezahlt, entsteht eine sichtbare Überzahlung', async () => {
    const { customer, invoiceId } = await invoiceFor(10000);
    const first = await checkout(customer, invoiceId);
    expectOk(
      await call(h, 'POST', `/invoices/${invoiceId}/payments/manual`, {
        token: w.admin.token,
        body: { method: 'cash', amountCents: 3000, receivedAt: iso(-60_000), referenceText: 'Anzahlung bar, Beleg 17' },
      }),
      InvoiceSchema,
    );
    const second = await checkout(customer, invoiceId);
    expect(second.res.checkoutId).not.toBe(first.res.checkoutId);
    expect(second.row.amountCents).toBe(7000);
    const [old] = await h.db.select().from(checkouts).where(eq(checkouts.id, first.res.checkoutId));
    expect(old!.status).toBe('deactivated');
    expect(h.fake.calls.some((c) => c.method === 'deactivateCheckout' && c.args[0] === first.providerId)).toBe(true);
    // Überschneidung: Kunde hatte die alte Seite noch offen
    h.fake.tamper(first.providerId, { status: 'PENDING' });
    h.fake.markPaid(first.providerId);
    h.fake.markPaid(second.providerId);
    expectStatus(await hook(first.providerId), 204);
    expectStatus(await hook(second.providerId), 204);
    const inv = await getInvoice(w.service.token, invoiceId);
    expect(inv.paidCents).toBe(20000);
    expect(inv.paidCents).toBeGreaterThan(inv.totalGrossCents);
    expect(inv.payments).toHaveLength(3);
  });

  it('Storno mit offenem Versuch: Versuch deaktiviert; spätere Bestätigung wird gebucht, Rechnung bleibt storniert', async () => {
    const { customer, invoiceId } = await invoiceFor(8000);
    const { providerId, res } = await checkout(customer, invoiceId);
    expectOk(await call(h, 'POST', `/invoices/${invoiceId}/cancel`, { token: w.service.token, body: { reason: 'Fehler' } }), InvoiceSchema);
    const [row] = await h.db.select().from(checkouts).where(eq(checkouts.id, res.checkoutId));
    expect(row!.status).toBe('deactivated');
    expectStatus(await call(h, 'POST', `/invoices/${invoiceId}/checkout`, { token: customer.token }), 409, 'invoice_cancelled');
    h.fake.tamper(providerId, { status: 'PENDING' });
    h.fake.markPaid(providerId);
    expectStatus(await hook(providerId), 204);
    const inv = await getInvoice(customer.token, invoiceId);
    expect(inv.status).toBe('cancelled');
    expect(inv.paymentStatus).toBe('cancelled');
    expect(inv.paidCents).toBe(8000);
  });

  it('gleichzeitige Klicks auf "Jetzt bezahlen": ein Versuch beim Anbieter', async () => {
    const { customer, invoiceId } = await invoiceFor(6600);
    const before = h.fake.calls.filter((c) => c.method === 'createCheckout').length;
    const results = await Promise.all([1, 2, 3, 4].map(() => call(h, 'POST', `/invoices/${invoiceId}/checkout`, { token: customer.token })));
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200]);
    const ids = new Set(results.map((r) => r.json().checkoutId as string));
    expect(ids.size).toBe(1);
    expect(h.fake.calls.filter((c) => c.method === 'createCheckout').length - before).toBe(1);
    // Versuch mit Ablauf (docs/zahlungen.md 2.1)
    const args = h.fake.calls.filter((c) => c.method === 'createCheckout').at(-1)!.args[0] as { validUntil?: string };
    const until = new Date(args.validUntil!).getTime() - h.clock.now().getTime();
    expect(until).toBeGreaterThan(50 * 60_000);
    expect(until).toBeLessThanOrEqual(60 * 60_000);
  });

  it('Checkout für bezahlte, fremde oder Entwurfsrechnung', async () => {
    const paid = await invoiceFor(2000);
    expectOk(
      await call(h, 'POST', `/invoices/${paid.invoiceId}/payments/manual`, {
        token: w.admin.token,
        body: { method: 'bank_transfer', amountCents: 2000, receivedAt: iso(-60_000), referenceText: 'Überweisung R-1' },
      }),
      InvoiceSchema,
    );
    expectStatus(await call(h, 'POST', `/invoices/${paid.invoiceId}/checkout`, { token: paid.customer.token }), 409, 'nothing_open');
    const other = await invoiceFor(2000, 'Fremdrechnung');
    expectStatus(await call(h, 'POST', `/invoices/${other.invoiceId}/checkout`, { token: paid.customer.token }), 404);
    const draft = expectOk(await call(h, 'POST', '/invoices', { token: w.service.token, body: { customerId: paid.customer.customerId, totalGrossCents: 500 } }), InvoiceSchema, 201);
    expectStatus(await call(h, 'POST', `/invoices/${draft.id}/checkout`, { token: paid.customer.token }), 404);
    expectStatus(await call(h, 'POST', `/invoices/${other.invoiceId}/checkout`, { token: w.admin.token }), 403);
  });
});

describe('Z02b Abgleich deaktivierter Versuche', () => {
  it('bezahlter, aber lokal deaktivierter Versuch ohne Webhook wird vom Abgleichslauf und der Statusabfrage gefunden', async () => {
    for (const via of ['abgleich', 'statusabfrage'] as const) {
      const { customer, invoiceId } = await invoiceFor(10000, `Abgleich${via}`);
      const first = await checkout(customer, invoiceId);
      expectOk(
        await call(h, 'POST', `/invoices/${invoiceId}/payments/manual`, {
          token: w.admin.token,
          body: { method: 'cash', amountCents: 1000, receivedAt: iso(-60_000), referenceText: 'Anzahlung' },
        }),
        InvoiceSchema,
      );
      await checkout(customer, invoiceId); // neuer Versuch, alter wird deaktiviert
      // Deaktivierung beim Anbieter ist fehlgeschlagen bzw. kam zu spät: alter Versuch wurde bezahlt, Webhook ging verloren
      h.fake.tamper(first.providerId, { status: 'PENDING' });
      h.fake.markPaid(first.providerId);
      if (via === 'abgleich') await reconcilePendingCheckouts({ db: h.db, provider: h.fake, now: () => h.clock.now() });
      else await call(h, 'POST', `/invoices/${invoiceId}/payment-status/refresh`, { token: customer.token });
      const rows = await paymentRows(invoiceId);
      expect(rows.filter((p) => p.method === 'sumup_online'), via).toHaveLength(1);
    }
  });
});

describe('Z03 manuelle Zahlungen', () => {
  it('Betrag über offen, Storno, Entwurf, Zukunft, leerer Beleg: abgelehnt; Buchung mit Audit', async () => {
    const { invoiceId } = await invoiceFor(5000);
    const post = (id: string, body: Record<string, unknown>) =>
      call(h, 'POST', `/invoices/${id}/payments/manual`, {
        token: w.admin.token,
        body: { method: 'bank_transfer', amountCents: 1000, receivedAt: iso(-60_000), referenceText: 'Beleg', ...body },
      });
    expectStatus(await post(invoiceId, { amountCents: 5001 }), 422, 'exceeds_open_amount');
    expectStatus(await post(invoiceId, { amountCents: -5 }), 400);
    expectStatus(await post(invoiceId, { amountCents: 0 }), 400);
    expectStatus(await post(invoiceId, { receivedAt: iso(86_400_000) }), 422, 'received_in_future');
    expectStatus(await post(invoiceId, { referenceText: '   ' }), 400);
    expectStatus(await post(invoiceId, { method: 'sumup_online' }), 400);
    const draft = expectOk(await call(h, 'POST', '/invoices', { token: w.service.token, body: { customerId: (await customerWithVehicle(h, 'Entwurfmanuell')).customer.customerId, totalGrossCents: 500 } }), InvoiceSchema, 201);
    expectStatus(await post(draft.id, {}), 422, 'invoice_not_issued');
    const inv = expectOk(await post(invoiceId, { amountCents: 1500, referenceText: 'Kontoauszug 42' }), InvoiceSchema);
    expect(inv.paymentStatus).toBe('partially_paid');
    const audit = expectOk(await call(h, 'GET', '/audit', { token: w.admin.token, query: { action: 'payment.manual_recorded' } }), z.array(AuditEntrySchema));
    const entry = audit.find((a) => a.data.invoiceId === invoiceId)!;
    expect(entry).toBeDefined();
    expect(entry.actorRole).toBe('admin');
    expect(entry.data).toMatchObject({ amountCents: 1500, referenceText: 'Kontoauszug 42', method: 'bank_transfer' });
  });

  it('gleichzeitige manuelle Zahlungen über den vollen offenen Betrag: nur eine', async () => {
    const { invoiceId } = await invoiceFor(9000);
    const results = await Promise.all(
      [1, 2, 3].map((i) =>
        call(h, 'POST', `/invoices/${invoiceId}/payments/manual`, {
          token: w.admin.token,
          body: { method: 'bank_transfer', amountCents: 9000, receivedAt: iso(-60_000), referenceText: `Auszug ${i}` },
        }),
      ),
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(await paymentRows(invoiceId)).toHaveLength(1);
  });
});

describe('Z04 Erstattungen', () => {
  it('gleichzeitige Erstattungen mit verschiedenen Schlüsseln überschreiten den Zahlbetrag nicht', async () => {
    const { customer, invoiceId } = await invoiceFor(10000);
    const { providerId } = await checkout(customer, invoiceId);
    h.fake.markPaid(providerId);
    expectStatus(await hook(providerId), 204);
    const [payment] = await paymentRows(invoiceId);
    const results = await Promise.all(
      ['erst-a-000001', 'erst-b-000002', 'erst-c-000003'].map((key) =>
        call(h, 'POST', `/payments/${payment!.id}/refunds`, { token: w.admin.token, body: { amountCents: 6000, idempotencyKey: key, reason: 'Kulanz' } }),
      ),
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    const rows = await h.db.select().from(refunds).where(eq(refunds.paymentId, payment!.id));
    expect(rows.reduce((s, r) => s + r.amountCents, 0)).toBeLessThanOrEqual(10000);
    expect(h.fake.refunds.filter((r) => r.transactionId === payment!.providerTransactionId)).toHaveLength(1);
    // Wiederholung mit gleichem Schlüssel: kein zweiter Anbieteraufruf; anderer Betrag mit gleichem Schlüssel: 409
    const winnerKey = rows[0]!.idempotencyKey;
    expectOk(await call(h, 'POST', `/payments/${payment!.id}/refunds`, { token: w.admin.token, body: { amountCents: 6000, idempotencyKey: winnerKey, reason: 'Kulanz' } }), InvoiceSchema);
    expect(h.fake.refunds.filter((r) => r.transactionId === payment!.providerTransactionId)).toHaveLength(1);
    expectStatus(await call(h, 'POST', `/payments/${payment!.id}/refunds`, { token: w.admin.token, body: { amountCents: 100, idempotencyKey: winnerKey, reason: 'x' } }), 409);
    expectStatus(await call(h, 'POST', `/payments/${payment!.id}/refunds`, { token: w.admin.token, body: { amountCents: 4001, idempotencyKey: 'erst-d-000004', reason: 'x' } }), 422, 'exceeds_refundable');
    expectStatus(await call(h, 'POST', `/payments/${payment!.id}/refunds`, { token: customer.token, body: { amountCents: 1, idempotencyKey: 'erst-e-000005', reason: 'x' } }), 404);
  });
});

describe('Z05 Trennung der Status und Geheimnisse', () => {
  it('Zahlung ändert weder Arbeitsstatus noch erzeugt sie Serviceeinträge', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Trennung');
    const { wo } = await workOrderWithFinishedMaintenance(h, w, customer.customerId!, vehicleId);
    const invoice = await issueInvoice(h, w.service.token, { customerId: customer.customerId!, workOrderId: wo.id, totalGrossCents: 3000 });
    const { providerId } = await checkout(customer, invoice.id);
    h.fake.markPaid(providerId);
    expectStatus(await hook(providerId), 204);
    const detail = expectOk(await call(h, 'GET', `/work-orders/${wo.id}`, { token: w.service.token }), WorkOrderDetailSchema);
    expect(detail.status.work).toBe('work_completed');
    expect(detail.status.payment).toBe('paid');
    expect(await h.db.select().from(serviceEntries).where(eq(serviceEntries.workOrderId, wo.id))).toHaveLength(0);
  });

  it('Antworten enthalten keine Schlüssel, Kunden keine Versuche/Erstattungen', async () => {
    const { customer, invoiceId } = await invoiceFor(700);
    const { res } = await checkout(customer, invoiceId);
    expect(Object.keys(res).sort()).toEqual(['checkoutId', 'hostedUrl', 'invoicePaymentStatus']);
    const inv = await call(h, 'GET', `/invoices/${invoiceId}`, { token: customer.token });
    expect(inv.json().checkouts).toBeUndefined();
    expect(inv.json().refunds).toBeUndefined();
    const settings = expectOk(await call(h, 'GET', '/settings/workshop', { token: w.admin.token }), WorkshopSettingsSchema);
    expect(JSON.stringify(settings)).not.toMatch(/sup_sk_|apiKey|api_key/i);
  });
});

describe('Z06 SumUp-Adapter (ohne Netzwerk, mit Attrappe für fetch)', () => {
  function recordingFetch(responses: Array<{ status: number; body?: unknown }>) {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const impl = (async (url: string | URL, init?: RequestInit) => {
      requests.push({ url: String(url), init: init ?? {} });
      const r = responses.shift() ?? { status: 500 };
      return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
    }) as unknown as typeof fetch;
    return { requests, impl };
  }
  const checkoutBody = {
    id: 'chk_1',
    checkout_reference: 'AW-R1-abc',
    amount: 10.5,
    currency: 'EUR',
    merchant_code: 'MTEST',
    status: 'PENDING',
    hosted_checkout_url: 'https://checkout.sumup.example/pay/chk_1',
  };

  it('legt Checkouts mit Ablauf (valid_until) an, damit vergessene Versuche nicht später bezahlt werden', async () => {
    const { requests, impl } = recordingFetch([{ status: 201, body: checkoutBody }]);
    const provider = new SumUpPaymentProvider({ apiKey: 'sup_sk_test_GEHEIM', merchantCode: 'MTEST', baseUrl: 'https://api.sumup.example/', fetchImpl: impl });
    await provider.createCheckout({
      checkoutReference: 'AW-R1-abc',
      amountCents: 1050,
      currency: 'EUR',
      description: 'Rechnung R1',
      returnUrl: 'https://api.werkstatt.test/api/v1/webhooks/sumup',
      redirectUrl: 'https://app.werkstatt.test/zahlung/rueckkehr?rechnung=1',
    });
    const body = JSON.parse(String(requests[0]!.init.body)) as Record<string, unknown>;
    expect(body.amount).toBe(10.5);
    expect(body.hosted_checkout).toEqual({ enabled: true });
    expect(typeof body.valid_until).toBe('string');
    const until = new Date(body.valid_until as string).getTime();
    expect(until).toBeGreaterThan(Date.now());
    expect(until).toBeLessThanOrEqual(Date.now() + 2 * 3600_000);
  });

  it('keine abschließenden Schrägstriche, Schlüssel nie in Fehlermeldungen, Antworttext nicht übernommen', async () => {
    const { requests, impl } = recordingFetch([
      { status: 200, body: checkoutBody },
      { status: 401, body: { message: 'invalid key sup_sk_test_GEHEIM for card 4111111111111111' } },
    ]);
    const provider = new SumUpPaymentProvider({ apiKey: 'sup_sk_test_GEHEIM', merchantCode: 'MTEST', baseUrl: 'https://api.sumup.example/', fetchImpl: impl });
    await provider.getCheckout('chk_1');
    expect(requests[0]!.url).toBe('https://api.sumup.example/v0.1/checkouts/chk_1');
    const err = await provider.getCheckout('chk/../../me').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaymentProviderError);
    expect(String((err as Error).message)).not.toMatch(/GEHEIM|4111/);
    expect(requests[1]!.url).toBe('https://api.sumup.example/v0.1/checkouts/chk%2F..%2F..%2Fme');
    for (const r of requests) expect(r.url.endsWith('/')).toBe(false);
  });
});
