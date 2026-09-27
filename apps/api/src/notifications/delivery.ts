/**
 * Zustellung des Postausgangs mit Wiederholung und exponentiellem Backoff (R-ARCH-8).
 * `in_app` wird nur gespeichert (bereits beim Anlegen zugestellt), `email` und `push` gehen
 * über die konfigurierten Adapter. Mehrere Prozesse können parallel zustellen
 * (`FOR UPDATE SKIP LOCKED`).
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/index';
import { devices, notifications, users } from '../db/schema/index';
import type { Mailer, PushSender } from './channels';

export const MAX_DELIVERY_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 60 * 60_000;

export function backoffDelayMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
}

export interface DeliveryDeps {
  db: Db;
  mailer: Mailer;
  push: PushSender;
  appBaseUrl: string;
  now?: () => Date;
}

export interface DeliveryResult {
  sent: number;
  failed: number;
  retried: number;
  cancelled: number;
}

class NoTargetError extends Error {}

export async function deliverPendingNotifications(deps: DeliveryDeps, options: { limit?: number } = {}): Promise<DeliveryResult> {
  const limit = options.limit ?? 100;
  const now = deps.now ?? (() => new Date());
  const result: DeliveryResult = { sent: 0, failed: 0, retried: 0, cancelled: 0 };

  for (let i = 0; i < limit; i++) {
    const handled = await deps.db.transaction(async (tx) => {
      const current = now();
      const [row] = await tx
        .select()
        .from(notifications)
        .where(and(eq(notifications.status, 'pending'), sql`${notifications.nextAttemptAt} <= ${current}`))
        .orderBy(notifications.nextAttemptAt)
        .limit(1)
        .for('update', { skipLocked: true });
      if (!row) return false;

      try {
        if (row.channel === 'email') {
          const [user] = await tx.select({ email: users.email }).from(users).where(eq(users.id, row.userId));
          if (!user) throw new NoTargetError('Empfänger nicht gefunden');
          const link = `${deps.appBaseUrl.replace(/\/+$/, '')}${row.targetPath}`;
          await deps.mailer.send({
            to: user.email,
            subject: row.title,
            text: `${row.body}\n\nZum Vorgang (Anmeldung erforderlich): ${link}\n\nAutowerkstatt Witten`,
          });
        } else if (row.channel === 'push') {
          const list = await tx
            .select({ id: devices.id, token: devices.pushToken })
            .from(devices)
            .where(and(eq(devices.userId, row.userId), isNull(devices.disabledAt)));
          if (list.length === 0) throw new NoTargetError('Kein registriertes Gerät');
          const { invalidTokens } = await deps.push.send(
            list.map((d) => d.token),
            { title: row.title, body: row.body, path: row.targetPath },
          );
          if (invalidTokens.length > 0) {
            await tx.update(devices).set({ disabledAt: current }).where(inArray(devices.pushToken, invalidTokens));
          }
        }
        await tx.update(notifications).set({ status: 'sent', sentAt: current, attempts: row.attempts + 1, lastError: null }).where(eq(notifications.id, row.id));
        result.sent += 1;
      } catch (err) {
        const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
        if (err instanceof NoTargetError) {
          await tx.update(notifications).set({ status: 'cancelled', lastError: message, attempts: row.attempts + 1 }).where(eq(notifications.id, row.id));
          result.cancelled += 1;
          return true;
        }
        const attempts = row.attempts + 1;
        if (attempts >= MAX_DELIVERY_ATTEMPTS) {
          await tx.update(notifications).set({ status: 'failed', attempts, lastError: message }).where(eq(notifications.id, row.id));
          result.failed += 1;
        } else {
          await tx
            .update(notifications)
            .set({ attempts, lastError: message, nextAttemptAt: new Date(current.getTime() + backoffDelayMs(attempts)) })
            .where(eq(notifications.id, row.id));
          result.retried += 1;
        }
      }
      return true;
    });
    if (!handled) break;
  }
  return result;
}
