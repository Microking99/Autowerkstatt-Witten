/**
 * SumUp-Adapter (Checkouts-API mit gehostetem Checkout).
 *
 * - `POST /v0.1/checkouts` mit `hosted_checkout: { enabled: true }`,
 *   `checkout_reference` = eigene eindeutige Referenz, `return_url` = Webhook-Adresse,
 *   `redirect_url` = Rückkehrseite der App. Beträge als Dezimal-EUR.
 * - `GET /v0.1/checkouts/{id}` liefert den maßgeblichen Status.
 * - `DELETE /v0.1/checkouts/{id}` deaktiviert einen offenen Checkout.
 * - `POST /v0.1/me/refund/{transaction_id}` erstattet (ohne Anbieter-Idempotenz).
 * - `GET /v0.1/merchants/{merchant_code}/payment-methods` listet verfügbare Zahlarten.
 *
 * Pfade ohne abschließenden Schrägstrich. Der API-Schlüssel wird nie geloggt.
 * NICHT GETESTET gegen die echte API (kein Sandbox-Zugang in dieser Umgebung); in Tests wird
 * ausschließlich `FakePaymentProvider` verwendet.
 */
import { z } from 'zod';
import {
  centsToEurDecimal,
  PaymentProviderError,
  type CreateCheckoutRequest,
  type PaymentProvider,
  type ProviderCheckout,
} from './provider';

const TransactionSchema = z.object({
  id: z.string(),
  transaction_code: z.string().optional(),
  status: z.enum(['SUCCESSFUL', 'FAILED', 'PENDING', 'CANCELLED']),
  amount: z.number(),
  currency: z.string(),
  timestamp: z.string(),
  merchant_code: z.string().optional(),
});

const CheckoutSchema = z.object({
  id: z.string(),
  checkout_reference: z.string(),
  amount: z.number(),
  currency: z.string(),
  merchant_code: z.string(),
  status: z.enum(['PENDING', 'FAILED', 'PAID', 'EXPIRED']),
  transactions: z.array(TransactionSchema).optional(),
  valid_until: z.string().nullable().optional(),
  hosted_checkout_url: z.string().nullable().optional(),
});

const PaymentMethodsSchema = z.object({
  available_payment_methods: z.array(z.object({ id: z.string() })).default([]),
});

export interface SumUpOptions {
  apiKey: string;
  merchantCode: string;
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class SumUpPaymentProvider implements PaymentProvider {
  readonly name = 'sumup' as const;
  readonly merchantCode: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SumUpOptions) {
    this.apiKey = options.apiKey;
    this.merchantCode = options.merchantCode;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new PaymentProviderError('Zahlungsanbieter nicht erreichbar', null, true);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    if (!res.ok) {
      // Antworttext nicht übernehmen (könnte Kontodaten enthalten); nur Status melden
      throw new PaymentProviderError(`Zahlungsanbieter antwortet mit Status ${res.status}`, res.status, res.status >= 500 || res.status === 429);
    }
    if (text.length === 0) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new PaymentProviderError('Ungültige Antwort des Zahlungsanbieters', res.status, true);
    }
  }

  private parseCheckout(data: unknown): ProviderCheckout {
    const parsed = CheckoutSchema.safeParse(data);
    if (!parsed.success) throw new PaymentProviderError('Unerwartetes Checkout-Format des Zahlungsanbieters', null, false);
    return parsed.data;
  }

  async createCheckout(input: CreateCheckoutRequest): Promise<ProviderCheckout> {
    const data = await this.request('POST', '/v0.1/checkouts', {
      checkout_reference: input.checkoutReference,
      amount: centsToEurDecimal(input.amountCents),
      currency: input.currency,
      merchant_code: this.merchantCode,
      description: input.description,
      return_url: input.returnUrl,
      redirect_url: input.redirectUrl,
      hosted_checkout: { enabled: true },
    });
    return this.parseCheckout(data);
  }

  async getCheckout(providerCheckoutId: string): Promise<ProviderCheckout> {
    return this.parseCheckout(await this.request('GET', `/v0.1/checkouts/${encodeURIComponent(providerCheckoutId)}`));
  }

  async deactivateCheckout(providerCheckoutId: string): Promise<void> {
    await this.request('DELETE', `/v0.1/checkouts/${encodeURIComponent(providerCheckoutId)}`);
  }

  async refund(transactionId: string, amountCents: number): Promise<{ providerRefundId: string | null }> {
    await this.request('POST', `/v0.1/me/refund/${encodeURIComponent(transactionId)}`, { amount: centsToEurDecimal(amountCents) });
    // SumUp liefert bei Erfolg 204 ohne eigene Erstattungs-ID
    return { providerRefundId: null };
  }

  async listPaymentMethods(amountCents: number, currency: 'EUR'): Promise<string[]> {
    const query = `amount=${encodeURIComponent(String(centsToEurDecimal(amountCents)))}&currency=${currency}`;
    const data = await this.request('GET', `/v0.1/merchants/${encodeURIComponent(this.merchantCode)}/payment-methods?${query}`);
    const parsed = PaymentMethodsSchema.safeParse(data ?? {});
    return parsed.success ? parsed.data.available_payment_methods.map((m) => m.id) : [];
  }
}
