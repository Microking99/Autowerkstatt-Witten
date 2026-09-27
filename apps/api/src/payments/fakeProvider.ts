/**
 * Test-Zahlungsanbieter (in-memory, steuerbar). Bildet die für R-ZAHL relevanten Fälle ab:
 * bezahlt, fehlgeschlagen, ausstehend, abgelaufen, falscher Betrag/Händler/Währung,
 * mehrere Transaktionen, Erstattungsfehler. Kein Netzwerk, keine echten Zahlungen.
 */
import { randomUUID } from 'node:crypto';
import {
  centsToEurDecimal,
  PaymentProviderError,
  type CreateCheckoutRequest,
  type PaymentProvider,
  type ProviderCheckout,
  type ProviderTransaction,
} from './provider';

export const FAKE_MERCHANT_CODE = 'MTESTFAKE01';

export interface FakePaidOptions {
  /** abweichender Transaktions-/Checkoutbetrag in Cent (Test "falscher Betrag") */
  amountCents?: number;
  merchantCode?: string;
  currency?: string;
  transactionId?: string;
  timestamp?: string;
}

export interface FakeCall {
  method: 'createCheckout' | 'getCheckout' | 'deactivateCheckout' | 'refund' | 'listPaymentMethods';
  args: unknown[];
}

export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'sumup' as const;
  readonly merchantCode: string;
  readonly checkouts = new Map<string, ProviderCheckout>();
  readonly calls: FakeCall[] = [];
  readonly refunds: Array<{ transactionId: string; amountCents: number; providerRefundId: string }> = [];
  private refundFailures = 0;
  private unavailable = false;

  constructor(merchantCode: string = FAKE_MERCHANT_CODE) {
    this.merchantCode = merchantCode;
  }

  // Steuerung für Tests ------------------------------------------------------------------

  /** Anbieter nicht erreichbar (Netzwerkfehler) simulieren */
  setUnavailable(value: boolean): void {
    this.unavailable = value;
  }

  failNextRefunds(count = 1): void {
    this.refundFailures = count;
  }

  private get(id: string): ProviderCheckout {
    const c = this.checkouts.get(id);
    if (!c) throw new PaymentProviderError('Checkout beim Anbieter unbekannt', 404, false);
    return c;
  }

  private tx(checkout: ProviderCheckout, status: ProviderTransaction['status'], opts: FakePaidOptions = {}): ProviderTransaction {
    return {
      id: opts.transactionId ?? `txn_${randomUUID()}`,
      transaction_code: `TC${Math.floor(Math.random() * 1e8)}`,
      status,
      amount: opts.amountCents !== undefined ? centsToEurDecimal(opts.amountCents) : checkout.amount,
      currency: opts.currency ?? checkout.currency,
      timestamp: opts.timestamp ?? new Date().toISOString(),
      merchant_code: opts.merchantCode ?? checkout.merchant_code,
    };
  }

  markPaid(id: string, opts: FakePaidOptions = {}): ProviderTransaction {
    const c = this.get(id);
    const t = this.tx(c, 'SUCCESSFUL', opts);
    const updated: ProviderCheckout = {
      ...c,
      status: 'PAID',
      amount: opts.amountCents !== undefined ? centsToEurDecimal(opts.amountCents) : c.amount,
      merchant_code: opts.merchantCode ?? c.merchant_code,
      currency: opts.currency ?? c.currency,
      transactions: [...(c.transactions ?? []), t],
    };
    this.checkouts.set(id, updated);
    return t;
  }

  markFailed(id: string): void {
    const c = this.get(id);
    this.checkouts.set(id, { ...c, status: 'FAILED', transactions: [...(c.transactions ?? []), this.tx(c, 'FAILED')] });
  }

  markPending(id: string): void {
    const c = this.get(id);
    this.checkouts.set(id, { ...c, status: 'PENDING' });
  }

  markExpired(id: string): void {
    const c = this.get(id);
    this.checkouts.set(id, { ...c, status: 'EXPIRED' });
  }

  /** Beliebige Felder überschreiben (z. B. falscher Händler oder Betrag beim Anbieter) */
  tamper(id: string, patch: Partial<ProviderCheckout>): void {
    this.checkouts.set(id, { ...this.get(id), ...patch });
  }

  lastCheckout(): ProviderCheckout | undefined {
    return [...this.checkouts.values()].at(-1);
  }

  // PaymentProvider ---------------------------------------------------------------------

  async createCheckout(input: CreateCheckoutRequest): Promise<ProviderCheckout> {
    this.calls.push({ method: 'createCheckout', args: [input] });
    if (this.unavailable) throw new PaymentProviderError('Anbieter nicht erreichbar', null, true);
    const id = `fake_chk_${randomUUID()}`;
    const checkout: ProviderCheckout = {
      id,
      checkout_reference: input.checkoutReference,
      amount: centsToEurDecimal(input.amountCents),
      currency: input.currency,
      merchant_code: this.merchantCode,
      status: 'PENDING',
      transactions: [],
      valid_until: input.validUntil ?? new Date(Date.now() + 30 * 60_000).toISOString(),
      hosted_checkout_url: `https://checkout.fake-provider.invalid/pay/${id}`,
    };
    this.checkouts.set(id, checkout);
    return { ...checkout };
  }

  async getCheckout(providerCheckoutId: string): Promise<ProviderCheckout> {
    this.calls.push({ method: 'getCheckout', args: [providerCheckoutId] });
    if (this.unavailable) throw new PaymentProviderError('Anbieter nicht erreichbar', null, true);
    return structuredClone(this.get(providerCheckoutId));
  }

  async deactivateCheckout(providerCheckoutId: string): Promise<void> {
    this.calls.push({ method: 'deactivateCheckout', args: [providerCheckoutId] });
    if (this.unavailable) throw new PaymentProviderError('Anbieter nicht erreichbar', null, true);
    const c = this.get(providerCheckoutId);
    if (c.status === 'PENDING' || c.status === 'FAILED') this.checkouts.set(providerCheckoutId, { ...c, status: 'EXPIRED' });
  }

  async refund(transactionId: string, amountCents: number): Promise<{ providerRefundId: string | null }> {
    this.calls.push({ method: 'refund', args: [transactionId, amountCents] });
    if (this.unavailable) throw new PaymentProviderError('Anbieter nicht erreichbar', null, true);
    if (this.refundFailures > 0) {
      this.refundFailures -= 1;
      throw new PaymentProviderError('Erstattung vom Anbieter abgelehnt', 400, false);
    }
    const providerRefundId = `fake_ref_${randomUUID()}`;
    this.refunds.push({ transactionId, amountCents, providerRefundId });
    return { providerRefundId };
  }

  async listPaymentMethods(amountCents: number, currency: 'EUR'): Promise<string[]> {
    this.calls.push({ method: 'listPaymentMethods', args: [amountCents, currency] });
    return ['card', 'apple_pay', 'google_pay'];
  }
}
