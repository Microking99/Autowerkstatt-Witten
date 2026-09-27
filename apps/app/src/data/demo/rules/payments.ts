/**
 * Rechnungs- und Zahlungsregeln (R-ZAHL-1 bis R-ZAHL-12, AGENTS.md Regel 7).
 *
 * - "Jetzt bezahlen" legt nur einen Zahlungsversuch (Checkout) an; der Rechnungsstatus bleibt.
 * - Bezahlt erst nach serverseitig geprüfter Anbieterbestätigung: Betrag, Währung, Händler
 *   und Rechnungszuordnung (Referenz) müssen passen.
 * - Doppelt gemeldete Ereignisse und wiederholte Statusabfragen buchen nie doppelt
 *   (eindeutig je Anbieter-Transaktion).
 *
 * Platzhalter für @werkstatt/domain; reine Funktionen.
 */
import type { PaymentStatus } from '@werkstatt/contracts';
import { ApiError, ERROR_CODES } from '../../errors';
import type { DCheckout, DInvoice, DPayment, DProviderCheckout, DProviderEvent, DRefund } from '../model';

export interface InvoiceSummary {
  paidCents: number;
  refundedCents: number;
  openCents: number;
  paymentStatus: PaymentStatus;
  overdue: boolean;
}

export function summarizeInvoice(
  invoice: DInvoice,
  payments: readonly DPayment[],
  refunds: readonly DRefund[],
  today: string,
): InvoiceSummary {
  const own = payments.filter((p) => p.invoiceId === invoice.id);
  const paidCents = own.reduce((sum, p) => sum + p.amountCents, 0);
  const paymentIds = new Set(own.map((p) => p.id));
  const refundedCents = refunds
    .filter((r) => paymentIds.has(r.paymentId) && r.status === 'succeeded')
    .reduce((sum, r) => sum + r.amountCents, 0);
  const openCents = Math.max(0, invoice.totalGrossCents - paidCents);

  let paymentStatus: PaymentStatus;
  if (invoice.status === 'cancelled') paymentStatus = 'cancelled';
  else if (invoice.status === 'draft') paymentStatus = 'no_invoice';
  else if (refundedCents > 0 && refundedCents >= paidCents) paymentStatus = 'refunded';
  else if (refundedCents > 0) paymentStatus = 'partially_refunded';
  else if (paidCents >= invoice.totalGrossCents) paymentStatus = 'paid';
  else if (paidCents > 0) paymentStatus = 'partially_paid';
  else paymentStatus = 'open';

  const overdue =
    invoice.status === 'issued' && openCents > 0 && invoice.dueDate !== null && invoice.dueDate < today.slice(0, 10);
  return { paidCents, refundedCents, openCents, paymentStatus, overdue };
}

/** Zahlungsstatus eines Auftrags aus seinen gestellten Rechnungen. */
export function aggregatePaymentStatus(summaries: readonly InvoiceSummary[]): PaymentStatus {
  const relevant = summaries.filter((s) => s.paymentStatus !== 'no_invoice' && s.paymentStatus !== 'cancelled');
  if (relevant.length === 0) return 'no_invoice';
  const order: PaymentStatus[] = ['open', 'partially_paid', 'partially_refunded', 'refunded', 'paid'];
  for (const status of order) if (relevant.some((s) => s.paymentStatus === status)) return status;
  return 'paid';
}

/**
 * "Jetzt bezahlen": neuer Zahlungsversuch über den offenen Betrag. Ältere offene Versuche
 * werden deaktiviert. Die Rechnung selbst wird nicht verändert.
 */
export function startCheckout(args: {
  invoice: DInvoice;
  summary: InvoiceSummary;
  existing: readonly DCheckout[];
  checkoutId: string;
  providerCheckoutId: string;
  userId: string;
  now: string;
  hostedUrl: string;
}): { checkout: DCheckout; deactivatedIds: string[] } {
  const { invoice, summary } = args;
  if (invoice.status !== 'issued' || summary.openCents <= 0) {
    throw ApiError.conflict(ERROR_CODES.invoiceNotPayable, 'Diese Rechnung kann nicht online bezahlt werden.');
  }
  const deactivatedIds = args.existing
    .filter((c) => c.invoiceId === invoice.id && (c.status === 'created' || c.status === 'pending'))
    .map((c) => c.id);
  const attempt = args.existing.filter((c) => c.invoiceId === invoice.id).length + 1;
  const validUntil = new Date(new Date(args.now).getTime() + 30 * 60_000).toISOString();
  return {
    deactivatedIds,
    checkout: {
      id: args.checkoutId,
      invoiceId: invoice.id,
      provider: 'sumup',
      checkoutReference: `${invoice.invoiceNumber ?? invoice.id}-${attempt}`,
      providerCheckoutId: args.providerCheckoutId,
      amountCents: summary.openCents,
      currency: 'EUR',
      status: 'pending',
      hostedUrl: args.hostedUrl,
      validUntil,
      lastCheckedAt: null,
      providerTransactionId: null,
      createdByUserId: args.userId,
      createdAt: args.now,
    },
  };
}

export type VerificationResult = { ok: true } | { ok: false; reason: string };

/** Prüft die Anbieterangaben gegen den eigenen Zahlungsversuch (R-ZAHL-5). */
export function verifyProviderConfirmation(
  checkout: DCheckout,
  provider: DProviderCheckout,
  merchantCode: string,
): VerificationResult {
  if (provider.status !== 'PAID') return { ok: false, reason: `Anbieterstatus ${provider.status}` };
  if (provider.merchantCode !== merchantCode) return { ok: false, reason: 'Händlerkonto stimmt nicht überein' };
  if (provider.checkoutReference !== checkout.checkoutReference) return { ok: false, reason: 'Rechnungszuordnung stimmt nicht überein' };
  if (provider.currency !== checkout.currency) return { ok: false, reason: 'Währung stimmt nicht überein' };
  if (provider.amountCents !== checkout.amountCents) return { ok: false, reason: 'Betrag stimmt nicht überein' };
  if (!provider.transactionId) return { ok: false, reason: 'Keine Transaktionsnummer' };
  return { ok: true };
}

export interface ReconcileResult {
  checkout: DCheckout;
  payment: DPayment | null;
  outcome: 'booked' | 'already_booked' | 'pending' | 'failed' | 'expired' | 'rejected';
  reason?: string;
}

/**
 * Gleicht einen Zahlungsversuch mit dem Anbieterstatus ab (Webhook-Auslöser oder
 * Statusabfrage). Bucht höchstens eine Zahlung je Anbieter-Transaktion.
 */
export function reconcileCheckout(args: {
  checkout: DCheckout;
  provider: DProviderCheckout | undefined;
  payments: readonly DPayment[];
  merchantCode: string;
  paymentId: string;
  now: string;
}): ReconcileResult {
  const checked = { ...args.checkout, lastCheckedAt: args.now };
  const provider = args.provider;
  if (!provider) return { checkout: checked, payment: null, outcome: 'pending' };

  if (provider.status === 'PENDING') return { checkout: { ...checked, status: 'pending' }, payment: null, outcome: 'pending' };
  if (provider.status === 'FAILED') return { checkout: { ...checked, status: 'failed' }, payment: null, outcome: 'failed' };
  if (provider.status === 'EXPIRED') return { checkout: { ...checked, status: 'expired' }, payment: null, outcome: 'expired' };

  const verification = verifyProviderConfirmation(args.checkout, provider, args.merchantCode);
  if (!verification.ok) {
    // Nicht buchen; der Versuch bleibt offen und wird im Protokoll zur Prüfung markiert.
    return { checkout: checked, payment: null, outcome: 'rejected', reason: verification.reason };
  }
  const existing = args.payments.find((p) => p.provider === 'sumup' && p.providerTransactionId === provider.transactionId);
  const paidCheckout: DCheckout = { ...checked, status: 'paid', providerTransactionId: provider.transactionId };
  if (existing) return { checkout: paidCheckout, payment: null, outcome: 'already_booked' };
  return {
    checkout: paidCheckout,
    outcome: 'booked',
    payment: {
      id: args.paymentId,
      invoiceId: args.checkout.invoiceId,
      method: 'sumup_online',
      amountCents: provider.amountCents,
      currency: 'EUR',
      provider: 'sumup',
      providerTransactionId: provider.transactionId,
      checkoutId: args.checkout.id,
      receivedAt: args.now,
      recordedBy: null,
      referenceText: args.checkout.checkoutReference,
    },
  };
}

/**
 * Anbieterereignis entgegennehmen: Ereignisse sind nur Auslöser. Doppelte Meldungen
 * (gleicher dedupeKey) werden gezählt, aber nicht erneut verarbeitet.
 */
export function registerProviderEvent(
  events: readonly DProviderEvent[],
  event: { dedupeKey: string; eventType: string; providerObjectId: string },
  now: string,
): { events: DProviderEvent[]; duplicate: boolean } {
  const existing = events.find((e) => e.dedupeKey === event.dedupeKey);
  if (existing) {
    return {
      duplicate: true,
      events: events.map((e) => (e === existing ? { ...e, receiveCount: e.receiveCount + 1, lastReceivedAt: now } : e)),
    };
  }
  return {
    duplicate: false,
    events: [
      ...events,
      { ...event, receiveCount: 1, firstReceivedAt: now, lastReceivedAt: now, processedAt: null, result: null },
    ],
  };
}

/** Manuelle Zuordnung (Überweisung, Bar): Pflichtangaben und kein Überzahlen. */
export function validateManualPayment(summary: InvoiceSummary, amountCents: number): void {
  if (amountCents <= 0) throw ApiError.validation('Betrag muss größer als 0 sein.');
  if (amountCents > summary.openCents) {
    throw ApiError.validation('Der Betrag ist höher als der offene Betrag der Rechnung.');
  }
}
