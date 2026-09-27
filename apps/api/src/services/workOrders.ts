/**
 * Aufträge: Listen- und Detailansicht mit drei getrennten Status (Arbeit, Freigabe, Zahlung),
 * Feldfilter je Rolle über die Geschäftslogik (`redactWorkOrderForActor`).
 */
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Intake, WorkItem, WorkOrderDetail, WorkOrderSummary } from '@werkstatt/contracts';
import {
  berlinDateOf,
  canViewMessages,
  computeStatusTriple,
  redactWorkOrderForActor,
  trackedMinutes,
  type Actor,
  type WorkOrderAccessInput,
} from '@werkstatt/domain';
import type { DbOrTx } from '../db/index';
import {
  appointments,
  approvalRequests,
  conversationReads,
  customers,
  intakes,
  invoices,
  messages,
  timeEntries,
  users,
  vehicles,
  workItems,
  workOrderAssignees,
  workOrders,
} from '../db/schema/index';
import { customerDisplayName } from './customers';
import { vehicleLabel } from './vehicles';
import { loadInvoiceBundles } from './invoices';
import { intakeContentHash } from './intake';

export type WorkOrderRow = typeof workOrders.$inferSelect;
export type WorkItemRow = typeof workItems.$inferSelect;
export type IntakeRow = typeof intakes.$inferSelect;

export async function userNames(db: DbOrTx, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r.displayName]));
}

export function toWorkItemDto(item: WorkItemRow, names: Map<string, string>, minutes: number): WorkItem {
  return {
    id: item.id,
    workOrderId: item.workOrderId,
    position: item.position,
    kind: item.kind,
    title: item.title,
    description: item.description,
    maintenanceTypeId: item.maintenanceTypeId,
    intervalKm: item.intervalKm,
    intervalMonths: item.intervalMonths,
    quantity: item.quantity,
    unit: item.unit,
    unitPriceCents: item.unitPriceCents,
    vatRateBp: item.vatRateBp,
    origin: item.origin,
    authorization: item.authorization,
    executionStatus: item.executionStatus,
    approvalRequestId: item.approvalRequestId,
    assignedTo: item.assignedTo ? { userId: item.assignedTo, displayName: names.get(item.assignedTo) ?? '' } : null,
    doneAt: item.doneAt ? item.doneAt.toISOString() : null,
    doneOdometerKm: item.doneOdometerKm,
    resultNotes: item.resultNotes,
    trackedMinutes: minutes,
  };
}

/** Position für die Rolle: Mechaniker ohne Preise (gleiche Regel wie im Auftrag). */
export function workItemForActor(item: WorkItem, actor: Actor): WorkItem {
  if (actor.role !== 'mechanic') return item;
  const { unitPriceCents: _p, ...rest } = item;
  return rest;
}

export function toIntakeDto(row: IntakeRow, items: readonly WorkItemRow[]): Intake {
  return {
    id: row.id,
    workOrderId: row.workOrderId,
    odometerKm: row.odometerKm,
    fuelLevel: row.fuelLevel,
    customerComplaint: row.customerComplaint,
    damages: row.damages,
    agreedServices: row.agreedServices,
    costLimitCents: row.costLimitCents,
    notesInternal: row.notesInternal,
    notesCustomer: row.notesCustomer,
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    confirmationMethod: row.confirmationMethod,
    contentHash: intakeContentHash(row, items),
  };
}

/** Intake für die Rolle (Kunde ohne interne Hinweise, Mechaniker ohne Kostenrahmen). */
export function intakeForActor(intake: Intake, actor: Actor): Intake {
  if (actor.role === 'customer') {
    const { notesInternal: _n, ...rest } = intake;
    return rest;
  }
  if (actor.role === 'mechanic') {
    const { costLimitCents: _c, ...rest } = intake;
    return rest;
  }
  return intake;
}

async function unreadCounts(db: DbOrTx, actor: Actor, woIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (woIds.length === 0) return map;
  const rows = await db.execute<{ work_order_id: string; n: number }>(sql`
    SELECT m.work_order_id, count(*)::int AS n
    FROM ${messages} m
    LEFT JOIN ${conversationReads} r ON r.work_order_id = m.work_order_id AND r.user_id = ${actor.userId}
    WHERE m.work_order_id IN (${sql.join(
      woIds.map((id) => sql`${id}`),
      sql`, `,
    )})
      AND m.deleted_at IS NULL
      AND m.author_user_id <> ${actor.userId}
      AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
    GROUP BY m.work_order_id`);
  for (const r of rows.rows) map.set(r.work_order_id, r.n);
  return map;
}

export async function buildWorkOrderSummaries(db: DbOrTx, actor: Actor, rows: WorkOrderRow[], now: Date): Promise<WorkOrderSummary[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const custRows = await db.select().from(customers).where(inArray(customers.id, [...new Set(rows.map((r) => r.customerId))]));
  const vehRows = await db.select().from(vehicles).where(inArray(vehicles.id, [...new Set(rows.map((r) => r.vehicleId))]));
  const assignees = await db.select().from(workOrderAssignees).where(inArray(workOrderAssignees.workOrderId, ids));
  const itemAssignees = await db
    .selectDistinct({ workOrderId: workItems.workOrderId, userId: workItems.assignedTo })
    .from(workItems)
    .where(and(inArray(workItems.workOrderId, ids), isNotNull(workItems.assignedTo)));
  const names = await userNames(db, assignees.map((a) => a.userId));
  const requests = await db
    .select({ workOrderId: approvalRequests.workOrderId, status: approvalRequests.status })
    .from(approvalRequests)
    .where(inArray(approvalRequests.workOrderId, ids));
  const invRows = await db.select().from(invoices).where(inArray(invoices.workOrderId, ids));
  const bundles = await loadInvoiceBundles(db, invRows);
  const unread = await unreadCounts(db, actor, ids);
  const today = berlinDateOf(now);

  return rows.map((wo) => {
    const customer = custRows.find((c) => c.id === wo.customerId);
    const vehicle = vehRows.find((v) => v.id === wo.vehicleId);
    const access: WorkOrderAccessInput = {
      customerId: wo.customerId,
      assigneeUserIds: assignees.filter((a) => a.workOrderId === wo.id).map((a) => a.userId),
      itemAssigneeUserIds: itemAssignees.filter((a) => a.workOrderId === wo.id).map((a) => a.userId!),
      status: wo.status,
    };
    const status = computeStatusTriple({
      workStatus: wo.status,
      approvalRequests: requests.filter((r) => r.workOrderId === wo.id),
      invoices: bundles
        .filter((b) => b.invoice.workOrderId === wo.id)
        .map((b) => ({
          invoice: { status: b.invoice.status, totalGrossCents: b.invoice.totalGrossCents, dueDate: b.invoice.dueDate },
          payments: b.payments.map((p) => ({ amountCents: p.amountCents })),
          refunds: b.refunds.map((r) => ({ amountCents: r.amountCents, status: r.status })),
        })),
      today,
      readyForPickupAt: wo.readyForPickupAt ? wo.readyForPickupAt.toISOString() : null,
      pickedUpAt: wo.pickedUpAt ? wo.pickedUpAt.toISOString() : null,
    });
    return {
      id: wo.id,
      orderNumber: wo.orderNumber,
      title: wo.title,
      customerId: wo.customerId,
      customerDisplayName: customer ? customerDisplayName(customer) : '',
      vehicleId: wo.vehicleId,
      vehicleLabel: vehicle ? vehicleLabel(vehicle) : '',
      licensePlate: vehicle?.licensePlate ?? '',
      status,
      plannedStart: wo.plannedStart ? wo.plannedStart.toISOString() : null,
      plannedEnd: wo.plannedEnd ? wo.plannedEnd.toISOString() : null,
      assignees: access.assigneeUserIds.map((userId) => ({ userId, displayName: names.get(userId) ?? '' })),
      unreadMessages: canViewMessages(actor, access).allowed ? (unread.get(wo.id) ?? 0) : 0,
      updatedAt: wo.updatedAt.toISOString(),
    };
  });
}

export async function loadItemsWithMinutes(db: DbOrTx, workOrderId: string, now: Date): Promise<{ rows: WorkItemRow[]; dtos: WorkItem[] }> {
  const rows = await db.select().from(workItems).where(eq(workItems.workOrderId, workOrderId)).orderBy(asc(workItems.position));
  const ids = rows.map((r) => r.id);
  const entries = ids.length > 0 ? await db.select().from(timeEntries).where(inArray(timeEntries.workItemId, ids)) : [];
  const names = await userNames(db, rows.map((r) => r.assignedTo ?? ''));
  const dtos = rows.map((r) =>
    toWorkItemDto(
      r,
      names,
      trackedMinutes(
        entries.filter((e) => e.workItemId === r.id).map((e) => ({ startedAt: e.startedAt, endedAt: e.endedAt })),
        now,
      ),
    ),
  );
  return { rows, dtos };
}

export async function buildWorkOrderDetail(db: DbOrTx, actor: Actor, wo: WorkOrderRow, now: Date): Promise<WorkOrderDetail> {
  const [summary] = await buildWorkOrderSummaries(db, actor, [wo], now);
  const { rows: itemRows, dtos } = await loadItemsWithMinutes(db, wo.id, now);
  const [intake] = await db.select().from(intakes).where(eq(intakes.workOrderId, wo.id));
  const apptRows = await db.select({ id: appointments.id }).from(appointments).where(eq(appointments.workOrderId, wo.id)).orderBy(asc(appointments.startsAt));
  const detail: WorkOrderDetail = {
    ...summary!,
    descriptionCustomer: wo.descriptionCustomer,
    notesInternal: wo.notesInternal,
    costLimitCents: wo.costLimitCents,
    items: dtos,
    intake: intake ? toIntakeDto(intake, itemRows) : null,
    appointmentIds: apptRows.map((a) => a.id),
    readyForPickupAt: wo.readyForPickupAt ? wo.readyForPickupAt.toISOString() : null,
    pickedUpAt: wo.pickedUpAt ? wo.pickedUpAt.toISOString() : null,
    completionReviewedAt: wo.completionReviewedAt ? wo.completionReviewedAt.toISOString() : null,
    createdAt: wo.createdAt.toISOString(),
  };
  return redactWorkOrderForActor(detail, actor);
}
