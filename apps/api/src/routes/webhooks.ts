/**
 * SumUp-Webhook: nur Auslöser. Das Ereignis wird gespeichert und dedupliziert, danach wird
 * der Checkout beim Anbieter abgefragt und mit der Geschäftslogik geprüft. Der Anbieter
 * erhält nach dem Speichern immer eine 2xx-Antwort (auch bei Abweichungen, die protokolliert
 * statt gebucht werden).
 */
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { checkouts, providerEvents } from '../db/schema/index';
import { sha256Hex } from '../lib/crypto';
import { processCheckout } from '../services/payments';
import type { App } from '../types';

export async function webhookRoutes(app: App): Promise<void> {
  app.post(
    '/webhooks/sumup',
    {
      bodyLimit: 64 * 1024,
      schema: { body: z.unknown() },
      config: { rateLimit: { max: 300, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { db, now: clock, payments: provider } = app.deps;
      const now = clock();
      const payload = (typeof request.body === 'object' && request.body !== null ? request.body : {}) as Record<string, unknown>;
      const checkoutId = typeof payload.id === 'string' && payload.id.length <= 200 ? payload.id : null;
      const eventType = typeof payload.event_type === 'string' ? payload.event_type.slice(0, 100) : 'unknown';
      const dedupeKey = checkoutId ? `sumup:${eventType}:${checkoutId}` : `sumup:invalid:${sha256Hex(JSON.stringify(payload))}`;

      // Nur die dokumentierten Felder speichern: Der Inhalt ist unsigniert und von außen frei
      // wählbar (keine Kartendaten, keine beliebigen Daten im Protokoll, R-ZAHL-10).
      const stored = { event_type: eventType, id: checkoutId };
      const [event] = await db
        .insert(providerEvents)
        .values({ provider: 'sumup', eventType, providerObjectId: checkoutId, payload: stored, dedupeKey, firstReceivedAt: now, lastReceivedAt: now })
        .onConflictDoUpdate({
          target: providerEvents.dedupeKey,
          set: { receiveCount: sql`${providerEvents.receiveCount} + 1`, lastReceivedAt: now },
        })
        .returning({ id: providerEvents.id });

      let result: string;
      if (!checkoutId) {
        result = 'invalid_payload';
      } else {
        const [local] = await db.select({ id: checkouts.id }).from(checkouts).where(eq(checkouts.providerCheckoutId, checkoutId));
        if (!local) result = 'unknown_checkout';
        else if (!provider) result = 'no_provider_configured';
        else {
          try {
            const processed = await processCheckout({ db, provider, now: clock }, local.id);
            result = processed.detail ? `${processed.outcome}:${processed.detail}` : processed.outcome;
          } catch (err) {
            request.log.error({ err: err instanceof Error ? err.message : String(err) }, 'Webhook-Verarbeitung fehlgeschlagen');
            result = 'error';
          }
        }
      }
      await db.update(providerEvents).set({ processedAt: clock(), result: result.slice(0, 200) }).where(eq(providerEvents.id, event!.id));
      return reply.code(204).send();
    },
  );
}
