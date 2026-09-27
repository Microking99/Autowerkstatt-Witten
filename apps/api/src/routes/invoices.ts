/**
 * Rechnungen und Zahlungen (R-ZAHL, R-DOK-3): Entwurf mit PDF und Betrag, Stellen,
 * Stornieren, "Jetzt bezahlen" (ändert den Status NICHT), Statusabfrage, manuelle Zahlung,
 * Erstattung, CSV-Export. Zahlungsstatus wird immer berechnet, nie gespeichert.
 */
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  CreateInvoiceRequestSchema,
  IdSchema,
  InvoiceSchema,
  IssueInvoiceRequestSchema,
  ManualPaymentRequestSchema,
  RefundRequestSchema,
  StartCheckoutResponseSchema,
  paymentStatusLabels,
  routes,
  type Invoice,
} from '@werkstatt/contracts';
import {
  addDays,
  berlinDateOf,
  canRefundPayment,
  canStartCheckout,
  canViewInvoice,
  hasPermission,
  planCheckout,
  validateManualPayment,
  validateRefund,
  type Actor,
} from '@werkstatt/domain';
import type { DbOrTx } from '../db/index';
import { checkouts, customers, documents, invoices, payments, refunds, workOrders } from '../db/schema/index';
import { audit, auditContextFrom } from '../lib/audit';
import { randomToken } from '../lib/crypto';
import { HttpError, conflict, forbidden, unprocessable } from '../lib/errors';
import { IdParamsSchema, ensure, ensureFound, requireActor } from '../lib/http';
import { enqueueNotification, notificationTargets } from '../notifications/outbox';
import { PaymentProviderError } from '../payments/provider';
import { customerDisplayName } from '../services/customers';
import { invoiceDtoContext, loadInvoiceBundle, loadInvoiceBundles, paymentStatusOf, toInvoiceDtos, type InvoiceRow } from '../services/invoices';
import { notifyPaymentConfirmed, processCheckout } from '../services/payments';
import { customerUserId } from '../services/recipients';
import { loadSettings } from '../services/settings';
import { createDocument } from './documents';
import { loadAttachableFile } from './files';
import type { App } from '../types';

const ListQuerySchema = z.object({
  paymentStatus: z.enum(['no_invoice', 'open', 'partially_paid', 'paid', 'partially_refunded', 'refunded', 'cancelled']).optional(),
  overdue: z.enum(['true', 'false']).optional(),
  customerId: IdSchema.optional(),
  status: z.enum(['draft', 'issued', 'cancelled']).optional(),
});

const CancelInvoiceSchema = z.object({ reason: z.string().trim().max(500).nullable().optional() }).default({});

function invoiceAccess(row: InvoiceRow) {
  return { customerId: row.customerId, status: row.status };
}

/** CSV-Zelle: Semikolon-sicher, Formel-Injektion verhindern. */
function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[;"\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function euro(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

export async function invoiceRoutes(app: App): Promise<void> {
  const dtoFor = async (db: DbOrTx, actor: Actor, id: string): Promise<Invoice> => {
    const bundle = ensureFound(await loadInvoiceBundle(db, id));
    const ctx = await invoiceDtoContext(db, app.deps.payments !== null, app.deps.now());
    const [dto] = await toInvoiceDtos(db, [bundle], actor, ctx);
    return dto!;
  };

  const loadVisibleInvoice = async (db: DbOrTx, actor: Actor, id: string, forUpdate = false): Promise<InvoiceRow> => {
    const q = db.select().from(invoices).where(eq(invoices.id, id));
    const [row] = forUpdate ? await q.for('update') : await q;
    ensureFound(row);
    ensure(canViewInvoice(actor, invoiceAccess(row!)));
    return row!;
  };

  app.get('/invoices', { schema: { querystring: ListQuerySchema, response: { 200: z.array(InvoiceSchema) } } }, async (request) => {
    const actor = requireActor(request);
    const { db, now } = app.deps;
    const q = request.query;
    const conditions: (SQL | undefined)[] = [];
    if (actor.role === 'customer') {
      if (!actor.customerId) return [];
      conditions.push(eq(invoices.customerId, actor.customerId), sql`${invoices.status} <> 'draft'`);
    } else {
      ensure(hasPermission(actor, 'invoices.read'));
      if (q.customerId) conditions.push(eq(invoices.customerId, q.customerId));
    }
    if (q.status) conditions.push(eq(invoices.status, q.status));
    const rows = await db.select().from(invoices).where(and(...conditions)).orderBy(desc(invoices.createdAt)).limit(1000);
    const visible = rows.filter((r) => canViewInvoice(actor, invoiceAccess(r)).allowed);
    const ctx = await invoiceDtoContext(db, app.deps.payments !== null, now());
    let dtos = await toInvoiceDtos(db, await loadInvoiceBundles(db, visible), actor, ctx);
    if (q.paymentStatus) dtos = dtos.filter((d) => d.paymentStatus === q.paymentStatus);
    if (q.overdue === 'true') dtos = dtos.filter((d) => d.overdue);
    return dtos;
  });

  app.post('/invoices', { schema: { body: CreateInvoiceRequestSchema, response: { 201: InvoiceSchema } } }, async (request, reply) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'invoices.write'));
    const { db } = app.deps;
    const body = request.body;
    const id = await db.transaction(async (tx) => {
      const [customer] = await tx.select().from(customers).where(eq(customers.id, body.customerId));
      if (!customer) throw unprocessable('invalid_customer', 'Kunde nicht gefunden.');
      let vehicleId: string | null = null;
      if (body.workOrderId) {
        const [wo] = await tx.select().from(workOrders).where(eq(workOrders.id, body.workOrderId));
        if (!wo || wo.customerId !== body.customerId) throw unprocessable('work_order_mismatch', 'Auftrag und Kunde passen nicht zusammen.');
        vehicleId = wo.vehicleId;
      }
      let documentId: string | null = null;
      if (body.documentFileId) {
        const file = await loadAttachableFile(tx, actor, body.documentFileId);
        if (file.mimeType !== 'application/pdf') throw unprocessable('pdf_required', 'Die Rechnung muss als PDF hochgeladen werden.');
        const doc = await createDocument(tx, {
          kind: 'invoice',
          title: 'Rechnung',
          fileId: file.id,
          customerId: body.customerId,
          vehicleId,
          workOrderId: body.workOrderId ?? null,
          createdBy: actor.userId,
        });
        documentId = doc.id;
      }
      const [created] = await tx
        .insert(invoices)
        .values({
          workOrderId: body.workOrderId ?? null,
          customerId: body.customerId,
          status: 'draft',
          dueDate: body.dueDate ?? null,
          totalGrossCents: body.totalGrossCents,
          currency: 'EUR',
          vatBreakdown: body.vatBreakdown,
          documentId,
          createdBy: actor.userId,
        })
        .returning();
      await audit(tx, auditContextFrom(request), {
        action: 'invoice.created',
        entityType: 'invoice',
        entityId: created!.id,
        data: { workOrderId: created!.workOrderId, totalGrossCents: created!.totalGrossCents },
      });
      return created!.id;
    });
    return reply.code(201).send(await dtoFor(db, actor, id));
  });

  app.get('/invoices/:id', { schema: { params: IdParamsSchema, response: { 200: InvoiceSchema } } }, async (request) => {
    const actor = requireActor(request);
    const { db } = app.deps;
    await loadVisibleInvoice(db, actor, request.params.id);
    return dtoFor(db, actor, request.params.id);
  });

  app.post('/invoices/:id/issue', { schema: { params: IdParamsSchema, body: IssueInvoiceRequestSchema, response: { 200: InvoiceSchema } } }, async (request) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'invoices.write'));
    const { db, now: clock } = app.deps;
    const now = clock();
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(invoices).where(eq(invoices.id, request.params.id)).for('update');
      ensureFound(row);
      if (row!.status !== 'draft') throw conflict('not_draft', 'Nur Entwürfe können gestellt werden.');
      const [taken] = await tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.invoiceNumber, request.body.invoiceNumber));
      if (taken) throw conflict('invoice_number_taken', 'Diese Rechnungsnummer ist bereits vergeben.');
      const settings = await loadSettings(tx);
      const dueDate = row!.dueDate ?? addDays(berlinDateOf(now), settings.paymentTermDays);
      await tx.update(invoices).set({ status: 'issued', invoiceNumber: request.body.invoiceNumber, issuedAt: now, dueDate }).where(eq(invoices.id, row!.id));
      if (row!.documentId) {
        // Rechnungs-PDF wird mit dem Stellen für den Kunden bereitgestellt
        await tx
          .update(documents)
          .set({ visibility: 'customer', publishedAt: now, publishedBy: actor.userId, title: `Rechnung ${request.body.invoiceNumber}` })
          .where(eq(documents.id, row!.documentId));
      }
      await audit(tx, auditContextFrom(request), {
        action: 'invoice.issued',
        entityType: 'invoice',
        entityId: row!.id,
        data: { workOrderId: row!.workOrderId, invoiceNumber: request.body.invoiceNumber, totalGrossCents: row!.totalGrossCents, dueDate },
      });
      const customerUser = await customerUserId(tx, row!.customerId);
      if (customerUser) {
        await enqueueNotification(
          tx,
          {
            eventType: 'invoice.issued',
            title: 'Rechnung bereitgestellt',
            body: `Ihre Rechnung ${request.body.invoiceNumber} liegt bereit.`,
            recipients: [{ userId: customerUser, targetPath: notificationTargets.invoiceForCustomer(row!.id) }],
            dedupeKey: `invoice.issued:${row!.id}`,
          },
          now,
        );
      }
    });
    return dtoFor(db, actor, request.params.id);
  });

  app.post('/invoices/:id/cancel', { schema: { params: IdParamsSchema, body: CancelInvoiceSchema, response: { 200: InvoiceSchema } } }, async (request) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'invoices.write'));
    const { db, now: clock, payments: provider } = app.deps;
    const now = clock();
    const toDeactivate = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(invoices).where(eq(invoices.id, request.params.id)).for('update');
      ensureFound(row);
      if (row!.status === 'cancelled') throw conflict('already_cancelled', 'Die Rechnung ist bereits storniert.');
      await tx.update(invoices).set({ status: 'cancelled', cancelledAt: now }).where(eq(invoices.id, row!.id));
      const open = await tx.select().from(checkouts).where(and(eq(checkouts.invoiceId, row!.id), inArray(checkouts.status, ['created', 'pending'])));
      if (open.length > 0) await tx.update(checkouts).set({ status: 'deactivated' }).where(inArray(checkouts.id, open.map((c) => c.id)));
      await audit(tx, auditContextFrom(request), {
        action: 'invoice.cancelled',
        entityType: 'invoice',
        entityId: row!.id,
        data: { workOrderId: row!.workOrderId, reason: request.body?.reason ?? null },
      });
      return open;
    });
    for (const c of toDeactivate) {
      if (provider && c.providerCheckoutId) await provider.deactivateCheckout(c.providerCheckoutId).catch(() => undefined);
    }
    return dtoFor(db, actor, request.params.id);
  });

  // "Jetzt bezahlen": gehosteter Checkout; der Rechnungsstatus bleibt unverändert (R-ZAHL-4)
  app.post('/invoices/:id/checkout', { schema: { params: IdParamsSchema, response: { 200: StartCheckoutResponseSchema } } }, async (request) => {
    const actor = requireActor(request);
    const { db, now: clock, payments: provider, config } = app.deps;
    const now = clock();
    const row = await loadVisibleInvoice(db, actor, request.params.id);
    ensure(canStartCheckout(actor, invoiceAccess(row)));
    const ctx = await invoiceDtoContext(db, provider !== null, now);
    if (!provider || !ctx.onlinePaymentAvailable) {
      throw conflict('online_payment_unavailable', 'Online-Zahlung ist derzeit nicht verfügbar. Bitte per Überweisung bezahlen.');
    }
    const result = await db.transaction(async (tx) => {
      // Zeilensperre: ein Klick erzeugt höchstens einen neuen Zahlungsversuch
      const [locked] = await tx.select().from(invoices).where(eq(invoices.id, row.id)).for('update');
      const bundle = (await loadInvoiceBundles(tx, [locked!]))[0]!;
      const status = paymentStatusOf(bundle, now);
      const plan = planCheckout({
        invoice: { id: locked!.id, status: locked!.status },
        existingCheckouts: bundle.checkouts.map((c) => ({
          id: c.id,
          status: c.status,
          amountCents: c.amountCents,
          validUntil: c.validUntil ? c.validUntil.toISOString() : null,
        })),
        now,
        paymentStatus: { status: status.status, openCents: status.openCents },
      });
      if (plan.action === 'reject') throw new HttpError(409, plan.code.toLowerCase(), plan.message);
      const deactivate = bundle.checkouts.filter((c) => plan.deactivateCheckoutIds.includes(c.id));
      if (deactivate.length > 0) {
        await tx.update(checkouts).set({ status: 'deactivated' }).where(inArray(checkouts.id, deactivate.map((c) => c.id)));
        for (const c of deactivate) {
          await audit(tx, auditContextFrom(request), { action: 'checkout.deactivated', entityType: 'checkout', entityId: c.id, data: { invoiceId: locked!.id } });
        }
      }
      if (plan.action === 'reuse') {
        const existing = bundle.checkouts.find((c) => c.id === plan.checkoutId)!;
        return { checkout: existing, deactivate, paymentStatus: status.status };
      }
      const reference = `AW-${(locked!.invoiceNumber ?? 'R').replace(/[^A-Za-z0-9-]/g, '')}-${randomToken(9)}`;
      const [local] = await tx
        .insert(checkouts)
        .values({
          invoiceId: locked!.id,
          provider: 'sumup',
          checkoutReference: reference,
          amountCents: plan.amountCents,
          currency: 'EUR',
          merchantCode: provider.merchantCode,
          status: 'created',
          createdByUserId: actor.userId,
        })
        .returning();
      let remote;
      try {
        remote = await provider.createCheckout({
          checkoutReference: reference,
          amountCents: plan.amountCents,
          currency: 'EUR',
          description: `Rechnung ${locked!.invoiceNumber ?? ''} Autowerkstatt Witten`.trim(),
          returnUrl: `${config.API_PUBLIC_URL.replace(/\/+$/, '')}/api/v1/webhooks/sumup`,
          redirectUrl: `${config.APP_BASE_URL.replace(/\/+$/, '')}${routes.paymentReturn(locked!.id)}`,
        });
      } catch (err) {
        if (err instanceof PaymentProviderError) {
          throw new HttpError(502, 'payment_provider_unavailable', 'Der Zahlungsanbieter ist gerade nicht erreichbar. Bitte später erneut versuchen.');
        }
        throw err;
      }
      if (!remote.hosted_checkout_url) throw new HttpError(502, 'payment_provider_unavailable', 'Der Zahlungsanbieter hat keine Zahlungsseite geliefert.');
      const [updated] = await tx
        .update(checkouts)
        .set({
          providerCheckoutId: remote.id,
          hostedUrl: remote.hosted_checkout_url,
          status: 'pending',
          validUntil: remote.valid_until ? new Date(remote.valid_until) : null,
        })
        .where(eq(checkouts.id, local!.id))
        .returning();
      await audit(tx, auditContextFrom(request), {
        action: 'checkout.created',
        entityType: 'checkout',
        entityId: local!.id,
        data: { invoiceId: locked!.id, workOrderId: locked!.workOrderId, amountCents: plan.amountCents },
      });
      return { checkout: updated!, deactivate, paymentStatus: status.status };
    });
    for (const c of result.deactivate) {
      if (c.providerCheckoutId) await provider.deactivateCheckout(c.providerCheckoutId).catch(() => undefined);
    }
    return { checkoutId: result.checkout.id, hostedUrl: result.checkout.hostedUrl!, invoicePaymentStatus: result.paymentStatus };
  });

  // Rückkehrseite/Statusprüfung: fragt offene Versuche beim Anbieter ab (gedrosselt)
  app.post(
    '/invoices/:id/payment-status/refresh',
    {
      schema: { params: IdParamsSchema, response: { 200: InvoiceSchema } },
      config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: (req) => `${req.ip}|${req.actor?.userId ?? ''}` } },
    },
    async (request) => {
      const actor = requireActor(request);
      const { db, now, payments: provider, config } = app.deps;
      const row = await loadVisibleInvoice(db, actor, request.params.id);
      if (provider) {
        const open = await db.select().from(checkouts).where(and(eq(checkouts.invoiceId, row.id), inArray(checkouts.status, ['created', 'pending', 'failed'])));
        const minAge = config.PAYMENT_REFRESH_MIN_SECONDS * 1000;
        for (const c of open) {
          if (c.lastCheckedAt && now().getTime() - c.lastCheckedAt.getTime() < minAge) continue;
          await processCheckout({ db, provider, now }, c.id, auditContextFrom(request));
        }
      }
      return dtoFor(db, actor, row.id);
    },
  );

  app.post(
    '/invoices/:id/payments/manual',
    { schema: { params: IdParamsSchema, body: ManualPaymentRequestSchema, response: { 200: InvoiceSchema } } },
    async (request) => {
      const actor = requireActor(request);
      ensure(hasPermission(actor, 'payments.recordManual'));
      const { db, now: clock } = app.deps;
      const now = clock();
      await db.transaction(async (tx) => {
        const [row] = await tx.select().from(invoices).where(eq(invoices.id, request.params.id)).for('update');
        ensureFound(row);
        const bundle = (await loadInvoiceBundles(tx, [row!]))[0]!;
        const status = paymentStatusOf(bundle, now);
        const check = validateManualPayment({
          actor,
          invoice: { id: row!.id, status: row!.status },
          paymentStatus: { openCents: status.openCents },
          payment: { method: request.body.method, amountCents: request.body.amountCents, receivedAt: request.body.receivedAt, referenceText: request.body.referenceText },
          now,
        });
        if (!check.ok) {
          if (check.error.code === 'MISSING_PERMISSION') throw forbidden(check.error.message);
          throw unprocessable(check.error.code.toLowerCase(), check.error.message);
        }
        const p = check.value.payment;
        const [inserted] = await tx
          .insert(payments)
          .values({
            invoiceId: p.invoiceId,
            method: p.method,
            amountCents: p.amountCents,
            currency: 'EUR',
            receivedAt: new Date(p.receivedAt),
            recordedBy: p.recordedBy,
            referenceText: p.referenceText,
            note: request.body.note ?? null,
          })
          .returning({ id: payments.id });
        await audit(tx, auditContextFrom(request), {
          action: 'payment.manual_recorded',
          entityType: 'payment',
          entityId: inserted!.id,
          data: { invoiceId: row!.id, workOrderId: row!.workOrderId, method: p.method, amountCents: p.amountCents, referenceText: p.referenceText, receivedAt: p.receivedAt },
        });
        await notifyPaymentConfirmed(tx, row!, inserted!.id, now);
      });
      return dtoFor(db, actor, request.params.id);
    },
  );

  app.post('/payments/:id/refunds', { schema: { params: IdParamsSchema, body: RefundRequestSchema, response: { 200: InvoiceSchema } } }, async (request) => {
    const actor = requireActor(request);
    ensure(canRefundPayment(actor));
    const { db, now: clock, payments: provider } = app.deps;
    const now = clock();
    const body = request.body;
    const planned = await db.transaction(async (tx) => {
      const [payment] = await tx.select().from(payments).where(eq(payments.id, request.params.id)).for('update');
      ensureFound(payment);
      const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, payment!.invoiceId));
      ensure(canViewInvoice(actor, invoiceAccess(invoice!)));
      const existing = await tx
        .select()
        .from(refunds)
        .where(sql`${refunds.paymentId} = ${payment!.id} OR ${refunds.idempotencyKey} = ${body.idempotencyKey}`);
      const check = validateRefund({
        actor,
        payment: { id: payment!.id, amountCents: payment!.amountCents },
        existingRefunds: existing.map((r) => ({ id: r.id, paymentId: r.paymentId, idempotencyKey: r.idempotencyKey, amountCents: r.amountCents, status: r.status })),
        amountCents: body.amountCents,
        idempotencyKey: body.idempotencyKey,
      });
      if (!check.ok) {
        if (check.error.code === 'MISSING_PERMISSION') throw forbidden(check.error.message);
        if (check.error.code === 'IDEMPOTENCY_KEY_REUSED') throw conflict('idempotency_key_reused', check.error.message);
        throw unprocessable(check.error.code.toLowerCase(), check.error.message);
      }
      if (check.value.action === 'existing') return { invoiceId: invoice!.id, refundId: null as string | null, amountCents: 0, payment: payment!, invoice: invoice! };
      const [refund] = await tx
        .insert(refunds)
        .values({
          paymentId: payment!.id,
          amountCents: check.value.refund.amountCents,
          status: 'requested',
          idempotencyKey: check.value.refund.idempotencyKey,
          reason: body.reason,
          requestedBy: actor.userId,
          requestedAt: now,
        })
        .returning();
      await audit(tx, auditContextFrom(request), {
        action: 'refund.requested',
        entityType: 'refund',
        entityId: refund!.id,
        data: { invoiceId: invoice!.id, workOrderId: invoice!.workOrderId, paymentId: payment!.id, amountCents: refund!.amountCents, reason: body.reason },
      });
      return { invoiceId: invoice!.id, refundId: refund!.id, amountCents: refund!.amountCents, payment: payment!, invoice: invoice! };
    });

    if (planned.refundId) {
      // Anbieter-Erstattung außerhalb der Transaktion; eigene Idempotenz über den Schlüssel
      let status: 'succeeded' | 'failed' = 'succeeded';
      let providerRefundId: string | null = null;
      let failureReason: string | null = null;
      if (planned.payment.method === 'sumup_online') {
        if (!provider || !planned.payment.providerTransactionId) {
          status = 'failed';
          failureReason = 'Kein Zahlungsanbieter konfiguriert.';
        } else {
          try {
            providerRefundId = (await provider.refund(planned.payment.providerTransactionId, planned.amountCents)).providerRefundId;
          } catch (err) {
            status = 'failed';
            failureReason = err instanceof Error ? err.message.slice(0, 300) : 'Erstattung fehlgeschlagen';
          }
        }
      }
      await db.transaction(async (tx) => {
        await tx
          .update(refunds)
          .set({ status, providerRefundId, failureReason, completedAt: clock() })
          .where(eq(refunds.id, planned.refundId!));
        await audit(tx, auditContextFrom(request), {
          action: status === 'succeeded' ? 'refund.succeeded' : 'refund.failed',
          entityType: 'refund',
          entityId: planned.refundId!,
          data: { invoiceId: planned.invoiceId, workOrderId: planned.invoice.workOrderId, paymentId: planned.payment.id, failureReason },
        });
      });
    }
    return dtoFor(db, actor, planned.invoiceId);
  });

  app.get('/exports/invoices.csv', { schema: { querystring: z.object({ from: z.string().optional(), to: z.string().optional() }) } }, async (request, reply) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'reports.export'));
    ensure(hasPermission(actor, 'invoices.read'));
    const { db, now } = app.deps;
    const rows = await db.select().from(invoices).where(sql`${invoices.status} <> 'draft'`).orderBy(asc(invoices.issuedAt));
    const bundles = await loadInvoiceBundles(db, rows);
    const custRows = rows.length > 0 ? await db.select().from(customers).where(inArray(customers.id, [...new Set(rows.map((r) => r.customerId))])) : [];
    const woRows = rows.some((r) => r.workOrderId)
      ? await db.select({ id: workOrders.id, orderNumber: workOrders.orderNumber }).from(workOrders).where(inArray(workOrders.id, rows.map((r) => r.workOrderId).filter((x): x is string => !!x)))
      : [];
    const header = ['Rechnungsnummer', 'Rechnungsdatum', 'Fällig am', 'Kundennummer', 'Kunde', 'Auftrag', 'Status', 'Zahlungsstatus', 'Überfällig', 'Betrag brutto (EUR)', 'Bezahlt (EUR)', 'Erstattet (EUR)', 'Offen (EUR)'];
    const lines = [header.join(';')];
    for (const b of bundles) {
      const s = paymentStatusOf(b, now());
      const c = custRows.find((x) => x.id === b.invoice.customerId);
      lines.push(
        [
          b.invoice.invoiceNumber,
          b.invoice.issuedAt ? berlinDateOf(b.invoice.issuedAt) : '',
          b.invoice.dueDate,
          c?.customerNumber,
          c ? customerDisplayName(c) : '',
          woRows.find((w) => w.id === b.invoice.workOrderId)?.orderNumber ?? '',
          b.invoice.status === 'issued' ? 'gestellt' : 'storniert',
          paymentStatusLabels[s.status].label,
          s.overdue ? 'ja' : 'nein',
          euro(b.invoice.totalGrossCents),
          euro(s.paidCents),
          euro(s.refundedCents),
          euro(s.openCents),
        ]
          .map(csvCell)
          .join(';'),
      );
    }
    await audit(db, auditContextFrom(request), { action: 'export.invoices_csv', entityType: 'export', data: { rows: bundles.length } });
    const csv = `﻿${lines.join('\r\n')}\r\n`;
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="rechnungen-${berlinDateOf(now())}.csv"`)
      .send(csv);
  });
}
