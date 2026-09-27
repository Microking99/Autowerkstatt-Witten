/**
 * Benachrichtigungen als Postausgang (Outbox): Die Zeilen entstehen im selben
 * Transaktionsschritt wie das auslösende Ereignis und werden danach zugestellt
 * (`deliverPendingNotifications`). Inhalte: nur Titel/Kurztext und Zielpfad, nie sensible
 * Daten, Beträge, Namen Dritter oder Tokens.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { routes, type NotificationEvent } from '@werkstatt/contracts';
import type { DbOrTx } from '../db/index';
import { notificationPreferences, notifications, users, workOrderAssignees, workItems, workshopSettings } from '../db/schema/index';

export interface NotificationRecipient {
  userId: string;
  targetPath: string;
}

export interface NotificationSpec {
  eventType: NotificationEvent;
  title: string;
  body: string;
  recipients: NotificationRecipient[];
  /** Eindeutiger Schlüssel des Ereignisses; je Empfänger und Kanal ergänzt */
  dedupeKey: string;
}

const DEFAULT_CHANNELS: Record<'push' | 'email', boolean> = { push: true, email: true };

/** Legt die Benachrichtigungen im laufenden Transaktionsschritt an (in-app sofort sichtbar). */
export async function enqueueNotification(tx: DbOrTx, spec: NotificationSpec, now: Date = new Date()): Promise<void> {
  const uniqueRecipients = new Map<string, NotificationRecipient>();
  for (const r of spec.recipients) if (!uniqueRecipients.has(r.userId)) uniqueRecipients.set(r.userId, r);
  if (uniqueRecipients.size === 0) return;

  const ids = [...uniqueRecipients.keys()];
  const active = await tx.select({ id: users.id }).from(users).where(and(inArray(users.id, ids), eq(users.status, 'active')));
  const activeIds = new Set(active.map((u) => u.id));
  if (activeIds.size === 0) return;

  const prefs = await tx
    .select()
    .from(notificationPreferences)
    .where(and(inArray(notificationPreferences.userId, [...activeIds]), eq(notificationPreferences.eventType, spec.eventType)));
  const [settings] = await tx.select({ defaults: workshopSettings.notificationDefaults }).from(workshopSettings).limit(1);
  const workshopDefault = settings?.defaults?.[spec.eventType] ?? {};

  const rows: (typeof notifications.$inferInsert)[] = [];
  for (const userId of activeIds) {
    const r = uniqueRecipients.get(userId)!;
    const base = { userId, eventType: spec.eventType, title: spec.title, body: spec.body, targetPath: r.targetPath };
    rows.push({ ...base, channel: 'in_app', status: 'sent', sentAt: now, dedupeKey: `${spec.dedupeKey}:${userId}:in_app` });
    for (const channel of ['push', 'email'] as const) {
      const pref = prefs.find((p) => p.userId === userId && p.channel === channel);
      const enabled = pref ? pref.enabled : (workshopDefault[channel] ?? DEFAULT_CHANNELS[channel]);
      if (enabled) rows.push({ ...base, channel, status: 'pending', nextAttemptAt: now, dedupeKey: `${spec.dedupeKey}:${userId}:${channel}` });
    }
  }
  await tx.insert(notifications).values(rows).onConflictDoNothing({ target: notifications.dedupeKey });
}

/** Aktive Mitarbeiter von Sekretariat/Service und Inhaber (Empfänger "Service"). */
export async function serviceRecipientIds(tx: DbOrTx): Promise<string[]> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.role, ['admin', 'service']), eq(users.status, 'active')));
  return rows.map((r) => r.id);
}

/** Dem Auftrag oder einer Position zugewiesene Mitarbeiter mit Rolle Mechaniker. */
export async function assignedMechanicIds(tx: DbOrTx, workOrderId: string): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    SELECT u.id FROM ${users} u
    WHERE u.role = 'mechanic' AND u.status = 'active' AND (
      u.id IN (SELECT ${workOrderAssignees.userId} FROM ${workOrderAssignees} WHERE ${workOrderAssignees.workOrderId} = ${workOrderId})
      OR u.id IN (SELECT ${workItems.assignedTo} FROM ${workItems} WHERE ${workItems.workOrderId} = ${workOrderId} AND ${workItems.assignedTo} IS NOT NULL)
    )`);
  return rows.rows.map((r) => r.id);
}

/**
 * Zielpfade je Ereignis exakt nach docs/ansichten-und-routen.md Abschnitt 6
 * (über `routes` aus packages/contracts).
 */
export const notificationTargets = {
  approvalRequestedForCustomer: (workOrderId: string, requestId: string) => routes.customer.approval(workOrderId, requestId),
  approvalDecidedForService: (workOrderId: string, requestId: string) => routes.workshop.approval(workOrderId, requestId),
  approvalDecidedForMechanic: (workOrderId: string) => routes.mechanic.workOrder(workOrderId),
  messageForCustomer: (workOrderId: string) => routes.customer.chat(workOrderId),
  messageForStaff: (workOrderId: string) => routes.workshop.workOrderTab(workOrderId, 'chat'),
  invoiceForCustomer: (invoiceId: string) => routes.customer.invoice(invoiceId),
  invoiceForService: (invoiceId: string) => routes.workshop.invoice(invoiceId),
  appointmentForCustomer: (appointmentId: string) => routes.customer.appointment(appointmentId),
  appointmentForService: (appointmentId: string) => routes.workshop.appointment(appointmentId),
  readyForPickupForCustomer: (workOrderId: string) => routes.customer.workOrder(workOrderId),
  findingForService: (workOrderId: string) => routes.workshop.workOrderTab(workOrderId, 'arbeiten'),
  maintenanceForCustomer: (vehicleId: string) => routes.customer.vehicle(vehicleId),
} as const;
