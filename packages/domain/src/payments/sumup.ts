/**
 * Abgleich eines SumUp-Checkouts (Antwort von `GET /v0.1/checkouts/{id}`) mit dem lokalen
 * Zahlungsversuch. Eine Zahlung gilt erst als bezahlt, wenn diese Prüfung `paid` liefert
 * (R-ZAHL-5). Webhooks sind nur Auslöser; der Status wird immer beim Anbieter abgefragt.
 *
 * Wichtig: `FAILED` ist bei SumUp NICHT endgültig. Derselbe Checkout kann später `PAID`
 * werden; deshalb wird `failed` nie als Endzustand behandelt.
 */
import { eurDecimalToCents } from '../common/money';

/** Transaktion innerhalb eines SumUp-Checkouts (Felder wie in der SumUp-API). */
export interface ProviderTransaction {
  id: string;
  transaction_code?: string;
  status: 'SUCCESSFUL' | 'FAILED' | 'PENDING' | 'CANCELLED';
  /** Betrag als Dezimalzahl in der Währung (EUR), z. B. 199.99. */
  amount: number;
  currency: string;
  /** Zeitpunkt ISO 8601. */
  timestamp: string;
  merchant_code?: string;
}

/** SumUp-Checkout, wie ihn die Checkouts-API liefert (relevante Felder). */
export interface ProviderCheckout {
  id: string;
  checkout_reference: string;
  /** Betrag als Dezimalzahl in EUR (nicht Cent!), z. B. 199.99. */
  amount: number;
  currency: string;
  merchant_code: string;
  status: 'PENDING' | 'FAILED' | 'PAID' | 'EXPIRED';
  transactions?: readonly ProviderTransaction[];
  valid_until?: string | null;
}

/** Lokaler Zahlungsversuch (Tabelle `checkouts`). */
export interface LocalCheckoutForVerification {
  id: string;
  invoiceId: string;
  /** Eigene, eindeutige Referenz, bei SumUp als `checkout_reference` hinterlegt. */
  checkoutReference: string;
  /** SumUp-Checkout-ID, sobald angelegt. */
  providerCheckoutId: string | null;
  amountCents: number;
  currency: string;
}

export type CheckoutRejectionReason =
  | 'MERCHANT_NOT_CONFIGURED'
  | 'INVOICE_MISMATCH'
  | 'CHECKOUT_ID_MISMATCH'
  | 'REFERENCE_MISMATCH'
  | 'MERCHANT_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'INVALID_AMOUNT'
  | 'AMOUNT_MISMATCH'
  | 'NO_SUCCESSFUL_TRANSACTION'
  | 'MULTIPLE_SUCCESSFUL_TRANSACTIONS'
  | 'TRANSACTION_MISMATCH'
  | 'INVALID_TIMESTAMP'
  | 'UNKNOWN_STATUS';

/** Ergebnis des Abgleichs. Nur `paid` darf zu einer Zahlungsbuchung führen. */
export type CheckoutVerification =
  | { kind: 'paid'; amountCents: number; transactionId: string; transactionCode: string | null; receivedAt: string }
  | { kind: 'pending' }
  | { kind: 'failed' }
  | { kind: 'expired' }
  | { kind: 'rejected'; reason: CheckoutRejectionReason; message: string };

function reject(reason: CheckoutRejectionReason, message: string): CheckoutVerification {
  return { kind: 'rejected', reason, message };
}

/**
 * Prüft einen SumUp-Checkout gegen den lokalen Zahlungsversuch und die Rechnung.
 *
 * `paid` NUR wenn alle Bedingungen erfüllt sind:
 * - Checkout gehört zur Rechnung (`localCheckout.invoiceId === invoice.id`),
 * - SumUp-ID und `checkout_reference` stimmen mit dem lokalen Versuch überein,
 * - Händlercode = erwarteter Händlercode der Werkstatt,
 * - Währung EUR (Checkout und Transaktion),
 * - Betrag (exakt in Cent umgerechnet, ohne Gleitkommarundung) = lokaler Betrag,
 * - Status `PAID` und genau eine erfolgreiche Transaktion mit passendem Betrag/Währung.
 *
 * Abweichungen bei Zuordnung, Händler, Währung oder Betrag führen immer zu `rejected`
 * (auch bei `PENDING`), weil der Checkout dann nicht zu diesem Vorgang gehört.
 * Eine Zahlung auf einen inzwischen deaktivierten Checkout oder eine stornierte Rechnung wird
 * dennoch als `paid` erkannt: Das Geld ist eingegangen und muss gebucht und ggf. erstattet
 * werden (Überzahlung meldet `computeInvoicePaymentStatus`).
 */
export function verifyProviderCheckout(input: {
  localCheckout: LocalCheckoutForVerification;
  invoice: { id: string };
  provider: ProviderCheckout;
  expectedMerchantCode: string;
}): CheckoutVerification {
  const { localCheckout, invoice, provider, expectedMerchantCode } = input;

  if (!expectedMerchantCode || expectedMerchantCode.trim() === '') {
    return reject('MERCHANT_NOT_CONFIGURED', 'Kein Händlercode der Werkstatt hinterlegt.');
  }
  if (localCheckout.invoiceId !== invoice.id) {
    return reject('INVOICE_MISMATCH', 'Der Zahlungsversuch gehört nicht zu dieser Rechnung.');
  }
  if (localCheckout.providerCheckoutId !== null && provider.id !== localCheckout.providerCheckoutId) {
    return reject('CHECKOUT_ID_MISMATCH', 'Die Checkout-ID des Anbieters passt nicht zum Zahlungsversuch.');
  }
  if (provider.checkout_reference !== localCheckout.checkoutReference) {
    return reject('REFERENCE_MISMATCH', 'Die Checkout-Referenz stimmt nicht überein.');
  }
  if (provider.merchant_code !== expectedMerchantCode) {
    return reject('MERCHANT_MISMATCH', 'Der Zahlungsempfänger (Händlercode) stimmt nicht überein.');
  }
  if (provider.currency !== 'EUR' || localCheckout.currency !== 'EUR') {
    return reject('CURRENCY_MISMATCH', 'Die Währung ist nicht EUR.');
  }
  const providerCents = eurDecimalToCents(provider.amount);
  if (providerCents === null) {
    return reject('INVALID_AMOUNT', 'Der Betrag des Anbieters ist ungültig.');
  }
  if (providerCents !== localCheckout.amountCents) {
    return reject('AMOUNT_MISMATCH', 'Der Betrag des Anbieters stimmt nicht mit dem Zahlungsversuch überein.');
  }

  switch (provider.status) {
    case 'PENDING':
      return { kind: 'pending' };
    case 'FAILED':
      return { kind: 'failed' };
    case 'EXPIRED':
      return { kind: 'expired' };
    case 'PAID':
      break;
    default:
      return reject('UNKNOWN_STATUS', `Unbekannter Anbieterstatus: ${String(provider.status)}`);
  }

  const successful = (provider.transactions ?? []).filter((t) => t.status === 'SUCCESSFUL');
  if (successful.length === 0) {
    return reject('NO_SUCCESSFUL_TRANSACTION', 'Der Anbieter meldet bezahlt, aber keine erfolgreiche Transaktion.');
  }
  if (successful.length > 1) {
    return reject('MULTIPLE_SUCCESSFUL_TRANSACTIONS', 'Mehrere erfolgreiche Transaktionen: manuelle Prüfung nötig.');
  }
  const tx = successful[0]!;
  const txCents = eurDecimalToCents(tx.amount);
  if (
    !tx.id ||
    tx.currency !== 'EUR' ||
    txCents !== localCheckout.amountCents ||
    (tx.merchant_code !== undefined && tx.merchant_code !== expectedMerchantCode)
  ) {
    return reject('TRANSACTION_MISMATCH', 'Die Transaktion passt nicht zu Betrag, Währung oder Händler.');
  }
  const receivedAt = new Date(tx.timestamp);
  if (Number.isNaN(receivedAt.getTime())) {
    return reject('INVALID_TIMESTAMP', 'Der Zeitpunkt der Transaktion ist ungültig.');
  }
  return {
    kind: 'paid',
    amountCents: txCents,
    transactionId: tx.id,
    transactionCode: tx.transaction_code ?? null,
    receivedAt: receivedAt.toISOString(),
  };
}
