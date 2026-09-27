/**
 * Rechnungs- und Zahlungsregeln im Demo-Modus (R-ZAHL-1 bis R-ZAHL-12, AGENTS.md Regel 7).
 *
 * Die Regeln kommen aus @werkstatt/domain wie in der API:
 * - Zahlungsstatus nur aus bestätigten Zahlungen und erfolgreichen Erstattungen
 *   (`computeInvoicePaymentStatus`, `aggregatePaymentStatus`).
 * - "Jetzt bezahlen" plant nur einen Zahlungsversuch (`planCheckout`), der Status bleibt.
 * - Bezahlt erst nach Prüfung von Betrag, Währung, Händler und Rechnungszuordnung
 *   (`verifyProviderCheckout`), gebucht höchstens einmal je Anbieter-Transaktion
 *   (`planPaymentRecording`).
 * - Manuelle Zahlung und Erstattung mit Recht und Pflichtangaben (`validateManualPayment`,
 *   `validateRefund`).
 * Hier wird nur zwischen Demo-Zustand und Domain übersetzt; Fehler als `ApiError` mit den
 * Codes der API.
 */
import { API_ERROR_CODES, apiCodeFromDomain, type PaymentStatus } from '@werkstatt/contracts';
import {
  aggregatePaymentStatus as domainAggregate,
  computeInvoicePaymentStatus,
  planCheckout,
  planPaymentRecording,
  validateManualPayment as domainValidateManualPayment,
  validateRefund as domainValidateRefund,
  verifyProviderCheckout,
  type Actor,
  type InvoiceWithPayments,
  type ManualPaymentInput,
  type ProviderCheckout,
} from '@werkstatt/domain';
import { ApiError } from '../../errors';
import type { DCheckout, DInvoice, DPayment, DProviderCheckout, DProviderEvent, DRefund } from '../model';

export interface InvoiceSummary {
  paidCents: number;
  refundedCents: number;
  openCents: number;
  paymentStatus: PaymentStatus;
  overdue: boolean;
  overpaidCents: number;
}

function invoiceInput(invoice: DInvoice, payments: readonly DPayment[], refunds: readonly DRefund[]): InvoiceWithPayments {
  const own = payments.filter((p) => p.invoiceId === invoice.id);
  const ids = new Set(own.map((p) => p.id));
  return {
    invoice: { status: invoice.status, totalGrossCents: invoice.totalGrossCents, dueDate: invoice.dueDate },
    payments: own.map((p) => ({ amountCents: p.amountCents })),
    refunds: refunds.filter((r) => ids.has(r.paymentId)).map((r) => ({ amountCents: r.amountCents, status: r.status })),
  };
}

export function summarizeInvoice(invoice: DInvoice, payments: readonly DPayment[], refunds: readonly DRefund[], today: string): InvoiceSummary {
  const s = computeInvoicePaymentStatus({ ...invoiceInput(invoice, payments, refunds), today: today.slice(0, 10) });
  return { paidCents: s.paidCents, refundedCents: s.refundedCents, openCents: s.openCents, paymentStatus: s.status, overdue: s.overdue, overpaidCents: s.overpaidCents };
}

/** Zahlungsstatus eines Auftrags aus seinen Rechnungen (Entwürfe zählen nicht). */
export function aggregatePaymentStatus(invoices: readonly DInvoice[], payments: readonly DPayment[], refunds: readonly DRefund[], today: string): { status: PaymentStatus; overdue: boolean } {
  return domainAggregate(invoices.map((i) => invoiceInput(i, payments, refunds)), today.slice(0, 10));
}

/**
 * "Jetzt bezahlen" (Domain `planCheckout`): offenen Versuch wiederverwenden oder neuen über den
 * offenen Betrag anlegen; ältere offene werden deaktiviert. Die Rechnung bleibt unverändert.
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
}): { checkout: DCheckout; deactivatedIds: string[]; reused: boolean } {
  const { invoice, summary } = args;
  const own = args.existing.filter((c) => c.invoiceId === invoice.id);
  const plan = planCheckout({
    invoice: { id: invoice.id, status: invoice.status },
    existingCheckouts: own.map((c) => ({ id: c.id, status: c.status, amountCents: c.amountCents, validUntil: c.validUntil })),
    now: new Date(args.now),
    paymentStatus: { status: summary.paymentStatus, openCents: summary.openCents },
  });
  if (plan.action === 'reject') throw ApiError.conflict(apiCodeFromDomain(plan.code), plan.message);
  if (plan.action === 'reuse') {
    const checkout = own.find((c) => c.id === plan.checkoutId)!;
    return { checkout, deactivatedIds: plan.deactivateCheckoutIds, reused: true };
  }
  const attempt = own.length + 1;
  return {
    deactivatedIds: plan.deactivateCheckoutIds,
    reused: false,
    checkout: {
      id: args.checkoutId,
      invoiceId: invoice.id,
      provider: 'sumup',
      checkoutReference: `${invoice.invoiceNumber ?? invoice.id}-${attempt}`,
      providerCheckoutId: args.providerCheckoutId,
      amountCents: plan.amountCents,
      currency: 'EUR',
      status: 'pending',
      hostedUrl: args.hostedUrl,
      validUntil: new Date(new Date(args.now).getTime() + 30 * 60_000).toISOString(),
      lastCheckedAt: null,
      providerTransactionId: null,
      createdByUserId: args.userId,
      createdAt: args.now,
    },
  };
}

/** Simulierter Anbieterzustand in der Form der SumUp-Checkouts-API (Beträge in Euro). */
export function toProviderCheckout(p: DProviderCheckout, now: string): ProviderCheckout {
  const amount = p.amountCents / 100;
  return {
    id: p.providerCheckoutId,
    checkout_reference: p.checkoutReference,
    amount,
    currency: p.currency,
    merchant_code: p.merchantCode,
    status: p.status,
    transactions:
      p.status === 'PAID' && p.transactionId
        ? [{ id: p.transactionId, status: 'SUCCESSFUL', amount, currency: p.currency, timestamp: now, merchant_code: p.merchantCode }]
        : p.status === 'FAILED'
          ? [{ id: `${p.providerCheckoutId}-f`, status: 'FAILED', amount, currency: p.currency, timestamp: now, merchant_code: p.merchantCode }]
          : [],
  };
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
  if (!args.provider) return { checkout: checked, payment: null, outcome: 'pending' };
  const verification = verifyProviderCheckout({
    localCheckout: {
      id: args.checkout.id,
      invoiceId: args.checkout.invoiceId,
      checkoutReference: args.checkout.checkoutReference,
      providerCheckoutId: args.checkout.providerCheckoutId,
      amountCents: args.checkout.amountCents,
      currency: args.checkout.currency,
    },
    invoice: { id: args.checkout.invoiceId },
    provider: toProviderCheckout(args.provider, args.now),
    expectedMerchantCode: args.merchantCode,
  });
  if (verification.kind === 'pending') return { checkout: { ...checked, status: 'pending' }, payment: null, outcome: 'pending' };
  if (verification.kind === 'failed') return { checkout: { ...checked, status: 'failed' }, payment: null, outcome: 'failed' };
  if (verification.kind === 'expired') return { checkout: { ...checked, status: 'expired' }, payment: null, outcome: 'expired' };
  if (verification.kind === 'rejected') return { checkout: checked, payment: null, outcome: 'rejected', reason: verification.message };
  const plan = planPaymentRecording({
    existingPayments: args.payments.map((p) => ({ provider: p.provider, providerTransactionId: p.providerTransactionId })),
    verification,
    checkout: { id: args.checkout.id, invoiceId: args.checkout.invoiceId },
  });
  const paidCheckout: DCheckout = { ...checked, status: 'paid', providerTransactionId: verification.transactionId };
  if (plan.action === 'noop') return { checkout: paidCheckout, payment: null, outcome: 'already_booked' };
  return {
    checkout: paidCheckout,
    outcome: 'booked',
    payment: {
      id: args.paymentId,
      invoiceId: plan.payment.invoiceId,
      method: 'sumup_online',
      amountCents: plan.payment.amountCents,
      currency: 'EUR',
      provider: 'sumup',
      providerTransactionId: plan.payment.providerTransactionId,
      checkoutId: plan.payment.checkoutId,
      receivedAt: plan.payment.receivedAt,
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
    return { duplicate: true, events: events.map((e) => (e === existing ? { ...e, receiveCount: e.receiveCount + 1, lastReceivedAt: now } : e)) };
  }
  return { duplicate: false, events: [...events, { ...event, receiveCount: 1, firstReceivedAt: now, lastReceivedAt: now, processedAt: null, result: null }] };
}

/** Manuelle Zuordnung (Überweisung, Bar, Kartenterminal) nach Domain-Regeln (422 bei Ablehnung). */
export function validateManualPayment(args: { actor: Actor; invoice: DInvoice; summary: InvoiceSummary; payment: ManualPaymentInput; now: string }): void {
  const check = domainValidateManualPayment({
    actor: args.actor,
    invoice: { id: args.invoice.id, status: args.invoice.status },
    paymentStatus: { openCents: args.summary.openCents },
    payment: args.payment,
    now: new Date(args.now),
  });
  if (!check.ok) {
    if (check.error.code === 'MISSING_PERMISSION') throw ApiError.forbidden(check.error.message);
    throw ApiError.unprocessable(apiCodeFromDomain(check.error.code), check.error.message);
  }
}

/** Erstattung nach Domain-Regeln; `existing` = gleicher Idempotenzschlüssel, nichts Neues. */
export function planRefund(args: { actor: Actor; payment: DPayment; refunds: readonly DRefund[]; amountCents: number; idempotencyKey: string }): { action: 'create' } | { action: 'existing' } {
  const check = domainValidateRefund({
    actor: args.actor,
    payment: { id: args.payment.id, amountCents: args.payment.amountCents },
    existingRefunds: args.refunds.map((r) => ({ id: r.id, paymentId: r.paymentId, idempotencyKey: r.idempotencyKey, amountCents: r.amountCents, status: r.status })),
    amountCents: args.amountCents,
    idempotencyKey: args.idempotencyKey,
  });
  if (!check.ok) {
    if (check.error.code === 'MISSING_PERMISSION') throw ApiError.forbidden(check.error.message);
    if (check.error.code === 'IDEMPOTENCY_KEY_REUSED') throw ApiError.conflict(API_ERROR_CODES.idempotencyKeyReused, check.error.message);
    throw ApiError.unprocessable(apiCodeFromDomain(check.error.code), check.error.message);
  }
  return { action: check.value.action };
}
