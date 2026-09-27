/**
 * Lädt die minimalen Felder, die die Objektregeln der Geschäftslogik brauchen
 * (packages/domain/src/permissions/objectRules.ts), und SQL-Bedingungen für serverseitig
 * gefilterte Listen.
 */
import { and, eq, isNotNull, isNull, ne, sql, type SQL } from 'drizzle-orm';
import type { Actor, VehicleAccessInput, WorkOrderAccessInput } from '@werkstatt/domain';
import type { DbOrTx } from '../db/index';
import { vehicleOwnerships, workItems, workOrderAssignees, workOrders } from '../db/schema/index';
import { ensure, ensureFound } from '../lib/http';
import { canViewWorkOrder } from '@werkstatt/domain';

export type WorkOrderRow = typeof workOrders.$inferSelect;

export async function workOrderAccessInput(db: DbOrTx, wo: Pick<WorkOrderRow, 'id' | 'customerId' | 'status'>): Promise<WorkOrderAccessInput> {
  const assignees = await db.select({ userId: workOrderAssignees.userId }).from(workOrderAssignees).where(eq(workOrderAssignees.workOrderId, wo.id));
  const itemAssignees = await db
    .selectDistinct({ userId: workItems.assignedTo })
    .from(workItems)
    .where(and(eq(workItems.workOrderId, wo.id), isNotNull(workItems.assignedTo)));
  return {
    customerId: wo.customerId,
    assigneeUserIds: assignees.map((a) => a.userId),
    itemAssigneeUserIds: itemAssignees.map((a) => a.userId!).filter(Boolean),
    // Kunden sehen Aufträge im Status draft nicht (Objektregel der Geschäftslogik)
    status: wo.status,
  };
}

export async function loadWorkOrder(db: DbOrTx, id: string): Promise<{ wo: WorkOrderRow; access: WorkOrderAccessInput } | null> {
  const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, id));
  if (!wo) return null;
  return { wo, access: await workOrderAccessInput(db, wo) };
}

/** Auftrag laden und Sichtrecht prüfen (404 für Kunden, 403 für Mitarbeiter). */
export async function loadVisibleWorkOrder(db: DbOrTx, actor: Actor, id: string): Promise<{ wo: WorkOrderRow; access: WorkOrderAccessInput }> {
  const loaded = ensureFound(await loadWorkOrder(db, id));
  ensure(canViewWorkOrder(actor, loaded.access));
  return loaded;
}

export async function currentOwnerCustomerId(db: DbOrTx, vehicleId: string): Promise<string | null> {
  const [row] = await db
    .select({ customerId: vehicleOwnerships.customerId })
    .from(vehicleOwnerships)
    .where(and(eq(vehicleOwnerships.vehicleId, vehicleId), isNull(vehicleOwnerships.endedAt)));
  return row?.customerId ?? null;
}

/** Ist der Mitarbeiter einem Auftrag (oder einer Position) zu diesem Fahrzeug zugewiesen? */
export async function isAssignedViaWorkOrder(db: DbOrTx, userId: string, vehicleId: string): Promise<boolean> {
  const rows = await db.execute<{ one: number }>(sql`
    SELECT 1 AS one FROM ${workOrders} wo
    WHERE wo.vehicle_id = ${vehicleId} AND (
      EXISTS (SELECT 1 FROM ${workOrderAssignees} a WHERE a.work_order_id = wo.id AND a.user_id = ${userId})
      OR EXISTS (SELECT 1 FROM ${workItems} i WHERE i.work_order_id = wo.id AND i.assigned_to = ${userId})
    ) LIMIT 1`);
  return rows.rows.length > 0;
}

export async function vehicleAccessInput(db: DbOrTx, actor: Actor, vehicleId: string): Promise<VehicleAccessInput> {
  return {
    currentOwnerCustomerId: await currentOwnerCustomerId(db, vehicleId),
    actorAssignedViaWorkOrder: actor.role === 'customer' ? false : await isAssignedViaWorkOrder(db, actor.userId, vehicleId),
  };
}

/**
 * SQL-Bedingung für Auftragslisten: Kunde nur eigene; Mitarbeiter ohne workOrders.read nur
 * zugewiesene. `alias` ist der Tabellenname bzw. Alias von work_orders in der Abfrage.
 */
export function workOrderListCondition(actor: Actor): SQL | undefined {
  if (actor.role === 'customer') {
    return actor.customerId ? and(eq(workOrders.customerId, actor.customerId), ne(workOrders.status, 'draft')) : sql`false`;
  }
  if (actor.permissions.has('workOrders.read')) return undefined;
  return sql`(
    EXISTS (SELECT 1 FROM ${workOrderAssignees} a WHERE a.work_order_id = ${workOrders.id} AND a.user_id = ${actor.userId})
    OR EXISTS (SELECT 1 FROM ${workItems} i WHERE i.work_order_id = ${workOrders.id} AND i.assigned_to = ${actor.userId})
  )`;
}
