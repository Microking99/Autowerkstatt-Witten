/**
 * Buchung verifizierter Online-Zahlungen und "Jetzt bezahlen" (Checkout-Planung).
 */
import type { CheckoutStatus, InvoiceStatus, PaymentStatus } from '@werkstatt/contracts';
import { toDate } from '../common/dates';
import type { CheckoutVerification } from './sumup';

/** Bereits gebuchte Zahlung (nur die für die Idempotenz nötigen Felder). */
export interface ExistingPaymentRef {
  provider: string | null;
  providerTransactionId: string | null;
}

/** Neu zu buchende Online-Zahlung (Zeile in `payments`). */
export interface NewProviderPayment {
  invoiceId: string;
  checkoutId: string;
  method: 'sumup_online';
  amountCents: number;
  currency: 'EUR';
  provider: 'sumup';
  providerTransactionId: string;
  receivedAt: string;
}

export type PaymentRecordingPlan =
  | { action: 'record'; payment: NewProviderPayment; checkoutUpdate: { checkoutId: string; status: 'paid'; providerTransactionId: string } }
  | { action: 'noop'; reason: 'already_recorded' | 'not_paid' };

/**
 * Plant die Buchung einer verifizierten Zahlung. Idempotent über
 * (`provider`, `provider_transaction_id`): Ist die Transaktion schon gebucht (z. B. weil
 * Webhook und Statusabfrage beide eintreffen), passiert nichts (`noop`). Die Datenbank sichert
 * dasselbe zusätzlich über einen Unique-Index ab.
 *
 * Nur `verification.kind === 'paid'` führt zu einer Buchung.
 */
export function planPaymentRecording(input: {
  existingPayments: readonly ExistingPaymentRef[];
  verification: CheckoutVerification;
  checkout: { id: string; invoiceId: string };
}): PaymentRecordingPlan {
  const { verification, checkout } = input;
  if (verification.kind !== 'paid') return { action: 'noop', reason: 'not_paid' };
  const duplicate = input.existingPayments.some(
    (p) => p.provider === 'sumup' && p.providerTransactionId === verification.transactionId,
  );
  if (duplicate) return { action: 'noop', reason: 'already_recorded' };
  return {
    action: 'record',
    payment: {
      invoiceId: checkout.invoiceId,
      checkoutId: checkout.id,
      method: 'sumup_online',
      amountCents: verification.amountCents,
      currency: 'EUR',
      provider: 'sumup',
      providerTransactionId: verification.transactionId,
      receivedAt: verification.receivedAt,
    },
    checkoutUpdate: { checkoutId: checkout.id, status: 'paid', providerTransactionId: verification.transactionId },
  };
}

/** Vorhandener Zahlungsversuch einer Rechnung. */
export interface ExistingCheckout {
  id: string;
  status: CheckoutStatus;
  amountCents: number;
  /** Ablauf beim Anbieter; `null` = ohne Ablauf. */
  validUntil: string | null;
}

export type CheckoutPlan =
  | { action: 'reuse'; checkoutId: string; amountCents: number; deactivateCheckoutIds: string[] }
  | { action: 'create'; amountCents: number; currency: 'EUR'; deactivateCheckoutIds: string[] }
  | { action: 'reject'; code: 'INVOICE_DRAFT' | 'INVOICE_CANCELLED' | 'NOTHING_OPEN'; message: string };

/** Offene (noch bezahlbare) Checkout-Status. `failed` zählt nicht: nicht wiederverwenden, aber weiter prüfen. */
const OPEN_CHECKOUT_STATUSES: readonly CheckoutStatus[] = ['created', 'pending'];

/**
 * "Jetzt bezahlen": entscheidet, ob ein vorhandener Zahlungsversuch wiederverwendet, ein neuer
 * angelegt (und ältere offene deaktiviert) oder abgelehnt wird.
 *
 * - Abgelehnt bei Entwurf, stornierter Rechnung oder ohne offenen Betrag.
 * - Wiederverwendet wird ein offener Versuch (`created`/`pending`) über genau den offenen
 *   Betrag, der noch mindestens `minRemainingValidityMinutes` gültig ist.
 * - Sonst neu über den offenen Betrag; alle anderen offenen Versuche werden deaktiviert.
 *   Versuche im Status `failed` bleiben unberührt, weil SumUp sie später noch als bezahlt
 *   melden kann; sie werden weiter geprüft.
 *
 * Dieser Schritt ändert NIE den Rechnungs- oder Zahlungsstatus (R-ZAHL-4): Das Ergebnis
 * enthält bewusst keinen Status. Bezahlt ist erst, was `verifyProviderCheckout` bestätigt.
 */
export function planCheckout(input: {
  invoice: { id: string; status: InvoiceStatus };
  existingCheckouts: readonly ExistingCheckout[];
  now: Date;
  paymentStatus: { status: PaymentStatus; openCents: number };
  minRemainingValidityMinutes?: number;
}): CheckoutPlan {
  const { invoice, existingCheckouts, now, paymentStatus } = input;
  if (invoice.status === 'draft') {
    return { action: 'reject', code: 'INVOICE_DRAFT', message: 'Die Rechnung ist noch nicht gestellt.' };
  }
  if (invoice.status === 'cancelled') {
    return { action: 'reject', code: 'INVOICE_CANCELLED', message: 'Die Rechnung ist storniert.' };
  }
  if (paymentStatus.openCents <= 0) {
    return { action: 'reject', code: 'NOTHING_OPEN', message: 'Für diese Rechnung ist kein Betrag offen.' };
  }
  const minValidUntil = now.getTime() + (input.minRemainingValidityMinutes ?? 5) * 60_000;
  const open = existingCheckouts.filter((c) => OPEN_CHECKOUT_STATUSES.includes(c.status));
  const validUntilMs = (c: ExistingCheckout): number => (c.validUntil === null ? Number.POSITIVE_INFINITY : toDate(c.validUntil).getTime());
  const reusable = open
    .filter((c) => c.amountCents === paymentStatus.openCents && validUntilMs(c) >= minValidUntil)
    .sort((a, b) => validUntilMs(b) - validUntilMs(a));
  const chosen = reusable[0];
  if (chosen) {
    return {
      action: 'reuse',
      checkoutId: chosen.id,
      amountCents: chosen.amountCents,
      deactivateCheckoutIds: open.filter((c) => c.id !== chosen.id).map((c) => c.id),
    };
  }
  return { action: 'create', amountCents: paymentStatus.openCents, currency: 'EUR', deactivateCheckoutIds: open.map((c) => c.id) };
}
