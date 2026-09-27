/**
 * Gemeinsame Abläufe rund um Aufträge: automatische Weiterschaltung des Arbeitsstatus über die
 * Geschäftslogik, Zeitabschnitte, Echtzeit-Ereignisse nach dem Speichern.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { WorkOrderStatus } from '@werkstatt/contracts';
import { allExecutableItemsFinished, canTransitionWorkOrder, type Actor } from '@werkstatt/domain';
import type { DbOrTx } from '../db/index';
import { intakes, timeEntries, workItems, workOrders } from '../db/schema/index';
import { audit, type AuditContext } from '../lib/audit';
import type { RealtimeEvent } from '../realtime/hub';
import { intakeContentHash } from './intake';

/** Nach dem Commit zu veröffentlichende Ereignisse. */
export type PendingEvents = RealtimeEvent[];

export async function setWorkOrderStatus(
  tx: DbOrTx,
  input: { workOrderId: string; from: WorkOrderStatus; to: WorkOrderStatus; ctx: AuditContext; events: PendingEvents; extra?: Partial<typeof workOrders.$inferInsert>; reason?: string | null },
): Promise<void> {
  await tx
    .update(workOrders)
    .set({ status: input.to, ...(input.extra ?? {}) })
    .where(eq(workOrders.id, input.workOrderId));
  await audit(tx, input.ctx, {
    action: 'work_order.status_changed',
    entityType: 'work_order',
    entityId: input.workOrderId,
    data: { from: input.from, to: input.to, workOrderId: input.workOrderId, ...(input.reason ? { reason: input.reason } : {}) },
  });
  input.events.push({ type: 'work_order.status_changed', workOrderId: input.workOrderId, status: input.to });
}

/**
 * Schaltet den Arbeitsstatus nach Änderungen an Positionen weiter, soweit die Geschäftslogik
 * den Übergang für die handelnde Person erlaubt:
 * - `open` → `in_progress`, sobald eine Position läuft oder erledigt ist,
 * - `in_progress` → `work_completed`, wenn alle ausführbaren Positionen erledigt sind,
 * - `work_completed` → `in_progress`, wenn wieder eine ausführbare Position offen ist.
 */
export async function autoAdvanceWorkOrder(tx: DbOrTx, workOrderId: string, actor: Actor, ctx: AuditContext, events: PendingEvents): Promise<void> {
  const [wo] = await tx.select().from(workOrders).where(eq(workOrders.id, workOrderId));
  if (!wo) return;
  const items = await tx
    .select({ authorization: workItems.authorization, executionStatus: workItems.executionStatus })
    .from(workItems)
    .where(eq(workItems.workOrderId, workOrderId));
  const executable = items.filter((i) => i.authorization === 'agreed' || i.authorization === 'approved');
  const tryTransition = async (from: WorkOrderStatus, to: WorkOrderStatus) => {
    const check = canTransitionWorkOrder(from, to, { items, permissions: actor.permissions });
    if (check.allowed) await setWorkOrderStatus(tx, { workOrderId, from, to, ctx, events });
    return check.allowed;
  };
  let status = wo.status;
  if (status === 'open' && executable.some((i) => i.executionStatus !== 'planned')) {
    if (await tryTransition('open', 'in_progress')) status = 'in_progress';
  }
  if (status === 'in_progress' && executable.length > 0 && allExecutableItemsFinished(items)) {
    await tryTransition('in_progress', 'work_completed');
  } else if (status === 'work_completed' && !allExecutableItemsFinished(items)) {
    await tryTransition('work_completed', 'in_progress');
  }
}

/** Status-Rückkehr ohne Rechteprüfung der Person (z. B. nach Kundenfreigabe einer Zusatzarbeit). */
export async function reopenIfNeeded(tx: DbOrTx, workOrderId: string, ctx: AuditContext, events: PendingEvents): Promise<void> {
  const [wo] = await tx.select().from(workOrders).where(eq(workOrders.id, workOrderId));
  if (!wo || wo.status !== 'work_completed') return;
  const items = await tx
    .select({ authorization: workItems.authorization, executionStatus: workItems.executionStatus })
    .from(workItems)
    .where(eq(workItems.workOrderId, workOrderId));
  // Übergang laut Geschäftslogik zulässig? (Rechte: Systemvorgang wie "workOrders.write")
  const check = canTransitionWorkOrder('work_completed', 'in_progress', { items, permissions: new Set(['workOrders.write']) });
  if (check.allowed) await setWorkOrderStatus(tx, { workOrderId, from: 'work_completed', to: 'in_progress', ctx, events });
}

export async function openTimeEntry(tx: DbOrTx, workItemId: string, userId: string, at: Date): Promise<void> {
  await tx.insert(timeEntries).values({ workItemId, userId, startedAt: at, source: 'timer' });
}

export async function closeTimeEntries(tx: DbOrTx, workItemId: string, at: Date): Promise<void> {
  await tx
    .update(timeEntries)
    .set({ endedAt: at })
    .where(and(eq(timeEntries.workItemId, workItemId), isNull(timeEntries.endedAt)));
}

/**
 * Hat sich der bestätigungsrelevante Inhalt der Annahme geändert, gilt die frühere
 * Bestätigung nicht mehr (sie bleibt im Audit-Protokoll nachvollziehbar).
 */
export async function invalidateIntakeConfirmationIfChanged(tx: DbOrTx, workOrderId: string, ctx: AuditContext): Promise<void> {
  const [intake] = await tx.select().from(intakes).where(eq(intakes.workOrderId, workOrderId));
  if (!intake || !intake.confirmedAt || !intake.contentHash) return;
  const items = await tx.select().from(workItems).where(eq(workItems.workOrderId, workOrderId));
  const current = intakeContentHash(intake, items);
  if (current === intake.contentHash) return;
  await tx
    .update(intakes)
    .set({ confirmedAt: null, confirmationMethod: 'none', confirmedByUserId: null, contentHash: null })
    .where(eq(intakes.id, intake.id));
  await audit(tx, ctx, {
    action: 'intake.saved',
    entityType: 'work_order',
    entityId: workOrderId,
    data: { workOrderId, confirmationInvalidated: true, previousHash: intake.contentHash },
  });
}
