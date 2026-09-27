/**
 * Manuelle Zahlungszuordnung (Überweisung, Bar, Kartenterminal) und Erstattungen.
 */
import type { InvoiceStatus, PaymentMethod, RefundStatus } from '@werkstatt/contracts';
import { fail, ok, type DomainIssue, type Result } from '../common/result';
import { formatCents } from '../format/format';
import type { Actor } from '../permissions/actor';

// ---------------------------------------------------------------------------
// Manuelle Zahlung
// ---------------------------------------------------------------------------

export type ManualPaymentIssueCode =
  | 'MISSING_PERMISSION'
  | 'INVALID_METHOD'
  | 'INVALID_AMOUNT'
  | 'INVOICE_NOT_ISSUED'
  | 'INVALID_RECEIVED_AT'
  | 'RECEIVED_IN_FUTURE'
  | 'REFERENCE_REQUIRED'
  | 'EXCEEDS_OPEN_AMOUNT';

export interface ManualPaymentInput {
  method: PaymentMethod;
  amountCents: number;
  /** Zahlungseingang, ISO 8601. */
  receivedAt: string;
  /** Verwendungszweck/Beleg, Pflicht (Protokoll). */
  referenceText: string;
}

/** Neu zu buchende manuelle Zahlung. */
export interface NewManualPayment {
  invoiceId: string;
  method: Exclude<PaymentMethod, 'sumup_online'>;
  amountCents: number;
  currency: 'EUR';
  provider: null;
  providerTransactionId: null;
  receivedAt: string;
  recordedBy: string;
  referenceText: string;
}

/**
 * Prüft eine manuelle Zahlungszuordnung.
 * - Recht `payments.recordManual`; Methode nicht `sumup_online` (Online nur über Verifikation).
 * - Rechnung gestellt (nicht Entwurf/storniert); Betrag ganzzahlig > 0.
 * - Eingang nicht in der Zukunft; Referenztext Pflicht.
 * - Übersteigt der Betrag den offenen Betrag, nur mit `acceptOverpayment: true`
 *   (ausdrückliche Bestätigung; die Überzahlung wird zurückgemeldet).
 */
export function validateManualPayment(input: {
  actor: Actor;
  invoice: { id: string; status: InvoiceStatus };
  paymentStatus: { openCents: number };
  payment: ManualPaymentInput;
  now: Date;
  acceptOverpayment?: boolean;
}): Result<{ payment: NewManualPayment; overpaymentCents: number }, DomainIssue<ManualPaymentIssueCode>> {
  const { actor, invoice, payment, now } = input;
  if (!actor.accountActive || actor.role === 'customer' || !actor.permissions.has('payments.recordManual')) {
    return fail('MISSING_PERMISSION', 'Für manuelle Zahlungszuordnung fehlt die Berechtigung.');
  }
  if (payment.method === 'sumup_online') {
    return fail('INVALID_METHOD', 'Online-Zahlungen werden nur nach Anbieterbestätigung gebucht.');
  }
  if (invoice.status !== 'issued') {
    return fail('INVOICE_NOT_ISSUED', 'Zahlungen können nur zu gestellten Rechnungen gebucht werden.');
  }
  if (!Number.isInteger(payment.amountCents) || payment.amountCents <= 0) {
    return fail('INVALID_AMOUNT', 'Der Betrag muss größer als 0 sein.');
  }
  const receivedAt = new Date(payment.receivedAt);
  if (Number.isNaN(receivedAt.getTime())) return fail('INVALID_RECEIVED_AT', 'Der Zahlungseingang ist kein gültiger Zeitpunkt.');
  if (receivedAt.getTime() > now.getTime()) return fail('RECEIVED_IN_FUTURE', 'Der Zahlungseingang liegt in der Zukunft.');
  const referenceText = payment.referenceText.trim();
  if (referenceText.length === 0) return fail('REFERENCE_REQUIRED', 'Verwendungszweck bzw. Beleg ist Pflicht.');
  const overpaymentCents = Math.max(0, payment.amountCents - Math.max(0, input.paymentStatus.openCents));
  if (overpaymentCents > 0 && input.acceptOverpayment !== true) {
    return fail('EXCEEDS_OPEN_AMOUNT', 'Der Betrag übersteigt den offenen Betrag. Überzahlung ausdrücklich bestätigen.');
  }
  return ok({
    payment: {
      invoiceId: invoice.id,
      method: payment.method,
      amountCents: payment.amountCents,
      currency: 'EUR',
      provider: null,
      providerTransactionId: null,
      receivedAt: receivedAt.toISOString(),
      recordedBy: actor.userId,
      referenceText,
    },
    overpaymentCents,
  });
}

// ---------------------------------------------------------------------------
// Erstattungen
// ---------------------------------------------------------------------------

/** Vorhandene Erstattung (auch zu anderen Zahlungen, für die Schlüsselprüfung). */
export interface ExistingRefund {
  id: string;
  paymentId: string;
  idempotencyKey: string;
  amountCents: number;
  status: RefundStatus;
}

export type RefundIssueCode = 'MISSING_PERMISSION' | 'INVALID_IDEMPOTENCY_KEY' | 'IDEMPOTENCY_KEY_REUSED' | 'INVALID_AMOUNT' | 'EXCEEDS_REFUNDABLE';

export type RefundPlan =
  | {
      action: 'create';
      refund: { paymentId: string; amountCents: number; idempotencyKey: string; status: 'requested'; requestedBy: string };
      refundableAfterCents: number;
    }
  | { action: 'existing'; refundId: string; status: RefundStatus };

/**
 * Noch erstattbarer Betrag einer Zahlung: Zahlung − (angeforderte + erfolgreiche Erstattungen).
 * Fehlgeschlagene Erstattungen zählen nicht.
 */
export function refundableCents(payment: { id: string; amountCents: number }, refunds: readonly ExistingRefund[]): number {
  const reserved = refunds
    .filter((r) => r.paymentId === payment.id && (r.status === 'requested' || r.status === 'succeeded'))
    .reduce((sum, r) => sum + r.amountCents, 0);
  return Math.max(0, payment.amountCents - reserved);
}

/**
 * Prüft eine Erstattung.
 * - Recht `payments.refund` (Service nur, wenn zugewiesen).
 * - Gleicher Idempotenzschlüssel mit gleicher Zahlung und gleichem Betrag → derselbe Vorgang
 *   (`existing`), keine zweite Erstattung. Gleicher Schlüssel mit anderen Daten → Fehler.
 * - Betrag ganzzahlig > 0 und höchstens der noch erstattbare Betrag.
 */
export function validateRefund(input: {
  actor: Actor;
  payment: { id: string; amountCents: number };
  existingRefunds: readonly ExistingRefund[];
  amountCents: number;
  idempotencyKey: string;
}): Result<RefundPlan, DomainIssue<RefundIssueCode>> {
  const { actor, payment, existingRefunds, amountCents } = input;
  if (!actor.accountActive || actor.role === 'customer' || !actor.permissions.has('payments.refund')) {
    return fail('MISSING_PERMISSION', 'Für Erstattungen fehlt die Berechtigung.');
  }
  const key = input.idempotencyKey.trim();
  if (key.length < 8 || key.length > 64) {
    return fail('INVALID_IDEMPOTENCY_KEY', 'Der Idempotenzschlüssel muss 8 bis 64 Zeichen haben.');
  }
  const sameKey = existingRefunds.find((r) => r.idempotencyKey === key);
  if (sameKey) {
    if (sameKey.paymentId === payment.id && sameKey.amountCents === amountCents) {
      return ok({ action: 'existing', refundId: sameKey.id, status: sameKey.status });
    }
    return fail('IDEMPOTENCY_KEY_REUSED', 'Der Idempotenzschlüssel wurde bereits für eine andere Erstattung verwendet.');
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return fail('INVALID_AMOUNT', 'Der Erstattungsbetrag muss größer als 0 sein.');
  }
  const refundable = refundableCents(payment, existingRefunds);
  if (amountCents > refundable) {
    return fail('EXCEEDS_REFUNDABLE', `Es können höchstens ${formatCents(refundable)} erstattet werden.`);
  }
  return ok({
    action: 'create',
    refund: { paymentId: payment.id, amountCents, idempotencyKey: key, status: 'requested', requestedBy: actor.userId },
    refundableAfterCents: refundable - amountCents,
  });
}
