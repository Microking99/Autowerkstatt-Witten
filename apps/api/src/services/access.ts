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

/**
 * Aufträge, deren Zuweisung einem Mitarbeiter ohne Leserecht Zugriff auf Fahrzeugakte,
 * Servicehistorie und interne Dokumente gibt: nur laufende Aufträge. Nach fachlichem Abschluss,
 * Abholung oder Stornierung endet dieser Zugriff (Review, Frage 3).
 */
const ACTIVE_ASSIGNMENT_STATUSES = sql`('draft', 'open', 'in_progress', 'work_completed')`;

/** SQL: IDs der aktiven Aufträge, denen der Mitarbeiter (oder einer ihrer Positionen) zugewiesen ist. */
function activeAssignedWorkOrderIds(userId: string): SQL {
  return sql`SELECT wo.id FROM ${workOrders} wo
    WHERE wo.status IN ${ACTIVE_ASSIGNMENT_STATUSES} AND (
      EXISTS (SELECT 1 FROM ${workOrderAssignees} a WHERE a.work_order_id = wo.id AND a.user_id = ${userId})
      OR EXISTS (SELECT 1 FROM ${workItems} i WHERE i.work_order_id = wo.id AND i.assigned_to = ${userId})
    )`;
}

/** Ist der Mitarbeiter einem aktiven Auftrag (oder einer Position) zu diesem Fahrzeug zugewiesen? */
export async function isAssignedViaWorkOrder(db: DbOrTx, userId: string, vehicleId: string): Promise<boolean> {
  const rows = await db.execute<{ one: number }>(sql`
    SELECT 1 AS one FROM ${workOrders} w
    WHERE w.vehicle_id = ${vehicleId} AND w.id IN (${activeAssignedWorkOrderIds(userId)}) LIMIT 1`);
  return rows.rows.length > 0;
}

/** Aktive zugewiesene Aufträge und deren Fahrzeuge eines Mitarbeiters (für Dokumentrechte). */
export async function activeAssignmentScope(db: DbOrTx, userId: string): Promise<{ workOrderIds: Set<string>; vehicleIds: Set<string> }> {
  const rows = await db.execute<{ id: string; vehicle_id: string }>(sql`
    SELECT w.id, w.vehicle_id FROM ${workOrders} w WHERE w.id IN (${activeAssignedWorkOrderIds(userId)})`);
  return {
    workOrderIds: new Set(rows.rows.map((r) => r.id)),
    vehicleIds: new Set(rows.rows.map((r) => r.vehicle_id)),
  };
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
