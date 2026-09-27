/**
 * Zahlungsanbieter-Schnittstelle (R-ZAHL). Die Felder der Checkouts entsprechen der
 * SumUp-Checkouts-API (Beträge als Dezimal-EUR), damit die Geschäftslogik
 * (`verifyProviderCheckout` in packages/domain) sie unverändert prüfen kann.
 *
 * Grundsätze:
 * - Webhooks sind nur Auslöser; maßgeblich ist immer `getCheckout` beim Anbieter.
 * - Keine Kartendaten im eigenen System (gehosteter Checkout des Anbieters).
 * - Der echte Adapter wird nie in Tests aufgerufen.
 */

export interface ProviderTransaction {
  id: string;
  transaction_code?: string;
  status: 'SUCCESSFUL' | 'FAILED' | 'PENDING' | 'CANCELLED';
  /** Dezimal-EUR, z. B. 199.99 */
  amount: number;
  currency: string;
  timestamp: string;
  merchant_code?: string;
}

export interface ProviderCheckout {
  id: string;
  checkout_reference: string;
  /** Dezimal-EUR, z. B. 199.99 (nicht Cent) */
  amount: number;
  currency: string;
  merchant_code: string;
  status: 'PENDING' | 'FAILED' | 'PAID' | 'EXPIRED';
  transactions?: readonly ProviderTransaction[];
  valid_until?: string | null;
  /** Nur bei gehostetem Checkout: Zahlungsseite des Anbieters */
  hosted_checkout_url?: string | null;
}

export interface CreateCheckoutRequest {
  /** Eigene, eindeutige Referenz */
  checkoutReference: string;
  amountCents: number;
  currency: 'EUR';
  description: string;
  /** Webhook-Adresse (SumUp: `return_url`) */
  returnUrl: string;
  /** Rückkehrseite der App nach der Zahlung (SumUp: `redirect_url`) */
  redirectUrl: string;
}

export interface PaymentProvider {
  readonly name: 'sumup';
  /** Händlerkennung, unter der Checkouts angelegt und gegen die sie geprüft werden */
  readonly merchantCode: string;
  createCheckout(input: CreateCheckoutRequest): Promise<ProviderCheckout>;
  getCheckout(providerCheckoutId: string): Promise<ProviderCheckout>;
  deactivateCheckout(providerCheckoutId: string): Promise<void>;
  /** Erstattung zu einer Transaktion. Der Anbieter bietet keine Idempotenz; die API sichert das selbst ab. */
  refund(transactionId: string, amountCents: number): Promise<{ providerRefundId: string | null }>;
  listPaymentMethods(amountCents: number, currency: 'EUR'): Promise<string[]>;
}

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

/** Cent → Dezimal-EUR ohne Gleitkomma-Artefakte (1999 → 19.99). */
export function centsToEurDecimal(cents: number): number {
  return Number((cents / 100).toFixed(2));
}
