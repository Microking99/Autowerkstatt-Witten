/**
 * Zahlungsabgleich (R-ZAHL-5 bis R-ZAHL-8): Status wird immer beim Anbieter abgefragt,
 * mit der Geschäftslogik (`verifyProviderCheckout`, `planPaymentRecording`) geprüft und
 * idempotent gebucht: Transaktion mit Zeilensperre auf der Rechnung plus Unique-Constraint
 * (provider, provider_transaction_id). Abweichungen werden protokolliert, nicht gebucht.
 */
import { and, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import { planPaymentRecording, verifyProviderCheckout, type CheckoutVerification } from '@werkstatt/domain';
import type { Db, DbOrTx } from '../db/index';
import { checkouts, invoices, payments } from '../db/schema/index';
import { audit, SYSTEM_AUDIT_CONTEXT, type AuditContext } from '../lib/audit';
import { enqueueNotification, notificationTargets, serviceRecipientIds } from '../notifications/outbox';
import type { PaymentProvider, ProviderCheckout } from '../payments/provider';
import { customerUserId } from './recipients';

export type CheckoutRow = typeof checkouts.$inferSelect;

export interface ProcessResult {
  outcome: 'recorded' | 'already_recorded' | 'pending' | 'failed' | 'expired' | 'rejected' | 'provider_error';
  detail?: string;
}

/** Nach bestätigter Zahlung Kunde und Service benachrichtigen (im selben Transaktionsschritt). */
export async function notifyPaymentConfirmed(tx: DbOrTx, invoice: typeof invoices.$inferSelect, paymentId: string, now: Date): Promise<void> {
  const customerUser = await customerUserId(tx, invoice.customerId);
  const recipients = [
    ...(customerUser ? [{ userId: customerUser, targetPath: notificationTargets.invoiceForCustomer(invoice.id) }] : []),
    ...(await serviceRecipientIds(tx)).map((userId) => ({ userId, targetPath: notificationTargets.invoiceForService(invoice.id) })),
  ];
  await enqueueNotification(
    tx,
    {
      eventType: 'payment.confirmed',
      title: 'Zahlung bestätigt',
      body: invoice.invoiceNumber ? `Zahlung zu Rechnung ${invoice.invoiceNumber} ist eingegangen.` : 'Eine Zahlung ist eingegangen.',
      recipients,
      dedupeKey: `payment.confirmed:${paymentId}`,
    },
    now,
  );
}

const LOCAL_STATUS: Record<Exclude<CheckoutVerification['kind'], 'paid' | 'rejected'>, CheckoutRow['status']> = {
  pending: 'pending',
  failed: 'failed',
  expired: 'expired',
};

/**
 * Fragt einen Zahlungsversuch beim Anbieter ab und bucht eine bestätigte Zahlung höchstens
 * einmal. Wird vom Webhook, von der Statusabfrage der Rückkehrseite und vom Abgleichslauf
 * aufgerufen.
 */
export async function processCheckout(
  deps: { db: Db; provider: PaymentProvider; now: () => Date },
  checkoutId: string,
  ctx: AuditContext = SYSTEM_AUDIT_CONTEXT,
): Promise<ProcessResult> {
  const { db, provider } = deps;
  const [initial] = await db.select().from(checkouts).where(eq(checkouts.id, checkoutId));
  if (!initial?.providerCheckoutId) return { outcome: 'rejected', detail: 'Zahlungsversuch ohne Anbieter-ID' };
  let remote: ProviderCheckout;
  try {
    remote = await provider.getCheckout(initial.providerCheckoutId);
  } catch (err) {
    await db.update(checkouts).set({ lastCheckedAt: deps.now() }).where(eq(checkouts.id, checkoutId));
    return { outcome: 'provider_error', detail: err instanceof Error ? err.message : String(err) };
  }
  const now = deps.now();
  return db.transaction(async (tx) => {
    // Zeilensperre: gleichzeitige Meldungen (Webhook + Rückkehrseite) werden nacheinander verarbeitet
    const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, initial.invoiceId)).for('update');
    const [checkout] = await tx.select().from(checkouts).where(eq(checkouts.id, checkoutId)).for('update');
    const existingPayments = await tx
      .select({ provider: payments.provider, providerTransactionId: payments.providerTransactionId })
      .from(payments)
      .where(eq(payments.invoiceId, invoice!.id));
    const verification = verifyProviderCheckout({
      localCheckout: {
        id: checkout!.id,
        invoiceId: checkout!.invoiceId,
        checkoutReference: checkout!.checkoutReference,
        providerCheckoutId: checkout!.providerCheckoutId,
        amountCents: checkout!.amountCents,
        currency: checkout!.currency,
      },
      invoice: { id: invoice!.id },
      provider: remote,
      expectedMerchantCode: checkout!.merchantCode === provider.merchantCode ? provider.merchantCode : '',
    });

    if (verification.kind === 'rejected') {
      await tx.update(checkouts).set({ lastCheckedAt: now }).where(eq(checkouts.id, checkout!.id));
      await audit(tx, ctx, {
        action: 'payment.mismatch',
        entityType: 'checkout',
        entityId: checkout!.id,
        data: { invoiceId: invoice!.id, workOrderId: invoice!.workOrderId, reason: verification.reason, message: verification.message, providerStatus: remote.status },
      });
      return { outcome: 'rejected', detail: verification.reason };
    }
    if (verification.kind !== 'paid') {
      const status = LOCAL_STATUS[verification.kind];
      // Deaktivierte Versuche bleiben deaktiviert, solange nichts bezahlt wurde
      await tx
        .update(checkouts)
        .set({ lastCheckedAt: now, ...(checkout!.status === 'deactivated' ? {} : { status }) })
        .where(eq(checkouts.id, checkout!.id));
      return { outcome: verification.kind };
    }

    const plan = planPaymentRecording({ existingPayments, verification, checkout: { id: checkout!.id, invoiceId: invoice!.id } });
    await tx
      .update(checkouts)
      .set({ status: 'paid', providerTransactionId: verification.transactionId, lastCheckedAt: now })
      .where(eq(checkouts.id, checkout!.id));
    if (plan.action === 'noop') return { outcome: 'already_recorded' };
    const inserted = await tx
      .insert(payments)
      .values({
        invoiceId: plan.payment.invoiceId,
        method: plan.payment.method,
        amountCents: plan.payment.amountCents,
        currency: plan.payment.currency,
        provider: plan.payment.provider,
        providerTransactionId: plan.payment.providerTransactionId,
        checkoutId: plan.payment.checkoutId,
        receivedAt: new Date(plan.payment.receivedAt),
        referenceText: verification.transactionCode,
      })
      .onConflictDoNothing({ target: [payments.provider, payments.providerTransactionId] })
      .returning({ id: payments.id });
    if (!inserted[0]) return { outcome: 'already_recorded' };
    await audit(tx, ctx, {
      action: 'payment.recorded',
      entityType: 'payment',
      entityId: inserted[0].id,
      data: {
        invoiceId: invoice!.id,
        workOrderId: invoice!.workOrderId,
        checkoutId: checkout!.id,
        amountCents: plan.payment.amountCents,
        providerTransactionId: plan.payment.providerTransactionId,
        invoiceStatus: invoice!.status,
      },
    });
    await notifyPaymentConfirmed(tx, invoice!, inserted[0].id, now);
    return { outcome: 'recorded' };
  });
}

/**
 * Abgleichslauf für den Hintergrund: offene (und fehlgeschlagene, weil SumUp sie noch als
 * bezahlt melden kann) Zahlungsversuche der letzten Tage beim Anbieter prüfen.
 */
export async function reconcilePendingCheckouts(
  deps: { db: Db; provider: PaymentProvider; now: () => Date },
  options: { maxAgeDays?: number; limit?: number } = {},
): Promise<{ checked: number; recorded: number }> {
  const since = new Date(deps.now().getTime() - (options.maxAgeDays ?? 7) * 86_400_000);
  const rows = await deps.db
    .select({ id: checkouts.id })
    .from(checkouts)
    .where(and(inArray(checkouts.status, ['created', 'pending', 'failed']), isNotNull(checkouts.providerCheckoutId), gt(checkouts.createdAt, since)))
    .limit(options.limit ?? 200);
  let recorded = 0;
  for (const r of rows) {
    const result = await processCheckout(deps, r.id);
    if (result.outcome === 'recorded') recorded += 1;
  }
  return { checked: rows.length, recorded };
}
