/**
 * Rechnungen: DTO-Aufbau mit berechnetem Zahlungsstatus (Geschäftslogik
 * `computeInvoicePaymentStatus`), Feldfilter je Rolle.
 */
import { asc, eq, inArray } from 'drizzle-orm';
import type { Invoice, InvoiceStatus } from '@werkstatt/contracts';
import { berlinDateOf, computeInvoicePaymentStatus, redactInvoiceForActor, type Actor } from '@werkstatt/domain';
import type { DbOrTx } from '../db/index';
import { checkouts, customers, invoices, payments, refunds, users, workOrders, workshopSettings } from '../db/schema/index';
import { customerDisplayName } from './customers';

export type InvoiceRow = typeof invoices.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type RefundRow = typeof refunds.$inferSelect;
export type CheckoutRow = typeof checkouts.$inferSelect;

export interface InvoiceBundle {
  invoice: InvoiceRow;
  payments: PaymentRow[];
  refunds: RefundRow[];
  checkouts: CheckoutRow[];
}

export async function loadInvoiceBundles(db: DbOrTx, invoiceRows: InvoiceRow[]): Promise<InvoiceBundle[]> {
  if (invoiceRows.length === 0) return [];
  const ids = invoiceRows.map((i) => i.id);
  const pay = await db.select().from(payments).where(inArray(payments.invoiceId, ids)).orderBy(asc(payments.receivedAt));
  const payIds = pay.map((p) => p.id);
  const ref = payIds.length > 0 ? await db.select().from(refunds).where(inArray(refunds.paymentId, payIds)).orderBy(asc(refunds.requestedAt)) : [];
  const chk = await db.select().from(checkouts).where(inArray(checkouts.invoiceId, ids)).orderBy(asc(checkouts.createdAt));
  return invoiceRows.map((invoice) => {
    const p = pay.filter((x) => x.invoiceId === invoice.id);
    const pIds = new Set(p.map((x) => x.id));
    return { invoice, payments: p, refunds: ref.filter((r) => pIds.has(r.paymentId)), checkouts: chk.filter((c) => c.invoiceId === invoice.id) };
  });
}

export function paymentStatusOf(bundle: Pick<InvoiceBundle, 'invoice' | 'payments' | 'refunds'>, now: Date) {
  return computeInvoicePaymentStatus({
    invoice: { status: bundle.invoice.status as InvoiceStatus, totalGrossCents: bundle.invoice.totalGrossCents, dueDate: bundle.invoice.dueDate },
    payments: bundle.payments.map((p) => ({ amountCents: p.amountCents })),
    refunds: bundle.refunds.map((r) => ({ amountCents: r.amountCents, status: r.status })),
    today: berlinDateOf(now),
  });
}

export interface InvoiceDtoContext {
  onlinePaymentAvailable: boolean;
  now: Date;
}

export async function invoiceDtoContext(db: DbOrTx, paymentsConfigured: boolean, now: Date): Promise<InvoiceDtoContext & { settings: typeof workshopSettings.$inferSelect | undefined }> {
  const [settings] = await db.select().from(workshopSettings).limit(1);
  return { settings, onlinePaymentAvailable: paymentsConfigured && settings?.paymentProvider === 'sumup', now };
}

export async function toInvoiceDtos(db: DbOrTx, bundles: InvoiceBundle[], actor: Actor, ctx: InvoiceDtoContext & { settings: typeof workshopSettings.$inferSelect | undefined }): Promise<Invoice[]> {
  if (bundles.length === 0) return [];
  const customerIds = [...new Set(bundles.map((b) => b.invoice.customerId))];
  const custRows = await db.select().from(customers).where(inArray(customers.id, customerIds));
  const woIds = [...new Set(bundles.map((b) => b.invoice.workOrderId).filter((x): x is string => !!x))];
  const woRows = woIds.length > 0 ? await db.select({ id: workOrders.id, orderNumber: workOrders.orderNumber }).from(workOrders).where(inArray(workOrders.id, woIds)) : [];
  const recorderIds = [...new Set(bundles.flatMap((b) => b.payments.map((p) => p.recordedBy)).filter((x): x is string => !!x))];
  const recorders = recorderIds.length > 0 ? await db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, recorderIds)) : [];
  const settings = ctx.settings;

  return bundles.map((b) => {
    const status = paymentStatusOf(b, ctx.now);
    const customer = custRows.find((c) => c.id === b.invoice.customerId);
    const bankTransfer =
      settings?.iban && b.invoice.status === 'issued'
        ? {
            recipient: settings.legalName ?? settings.name,
            iban: settings.iban,
            bic: settings.bic ?? null,
            reference: b.invoice.invoiceNumber ?? b.invoice.id,
          }
        : null;
    const dto: Invoice = {
      id: b.invoice.id,
      invoiceNumber: b.invoice.invoiceNumber,
      workOrderId: b.invoice.workOrderId,
      orderNumber: woRows.find((w) => w.id === b.invoice.workOrderId)?.orderNumber ?? null,
      customerId: b.invoice.customerId,
      customerDisplayName: customer ? customerDisplayName(customer) : '',
      status: b.invoice.status,
      paymentStatus: status.status,
      overdue: status.overdue,
      totalGrossCents: b.invoice.totalGrossCents,
      paidCents: status.paidCents,
      refundedCents: status.refundedCents,
      openCents: status.openCents,
      currency: 'EUR',
      issuedAt: b.invoice.issuedAt ? b.invoice.issuedAt.toISOString() : null,
      dueDate: b.invoice.dueDate,
      documentId: b.invoice.documentId,
      payments: b.payments.map((p) => ({
        id: p.id,
        method: p.method,
        amountCents: p.amountCents,
        currency: 'EUR' as const,
        receivedAt: p.receivedAt.toISOString(),
        providerTransactionId: p.providerTransactionId,
        referenceText: p.referenceText,
        recordedByDisplayName: p.recordedBy ? (recorders.find((r) => r.id === p.recordedBy)?.displayName ?? null) : null,
        refundedCents: b.refunds.filter((r) => r.paymentId === p.id && r.status === 'succeeded').reduce((s, r) => s + r.amountCents, 0),
      })),
      checkouts: b.checkouts.map((c) => ({
        id: c.id,
        status: c.status,
        amountCents: c.amountCents,
        createdAt: c.createdAt.toISOString(),
        lastCheckedAt: c.lastCheckedAt ? c.lastCheckedAt.toISOString() : null,
      })),
      refunds: b.refunds.map((r) => ({
        id: r.id,
        paymentId: r.paymentId,
        amountCents: r.amountCents,
        status: r.status,
        requestedAt: r.requestedAt.toISOString(),
        completedAt: r.completedAt ? r.completedAt.toISOString() : null,
        failureReason: r.failureReason,
      })),
      bankTransfer,
      onlinePaymentAvailable: ctx.onlinePaymentAvailable && b.invoice.status === 'issued' && status.openCents > 0,
    };
    return redactInvoiceForActor(dto, actor);
  });
}

export async function loadInvoiceBundle(db: DbOrTx, id: string): Promise<InvoiceBundle | null> {
  const [row] = await db.select().from(invoices).where(eq(invoices.id, id));
  if (!row) return null;
  const [bundle] = await loadInvoiceBundles(db, [row]);
  return bundle ?? null;
}
