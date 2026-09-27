/**
 * Aufträge (R-AUF), Fahrzeugannahme (R-ANN), Mechanikeransicht (R-MECH): Positionen,
 * Zeiten, Teile, Feststellungen, Fotos, Verlauf. Arbeitsstatus-Übergänge, Ausführungsregeln
 * und Feldfilter kommen aus der Geschäftslogik; jede Antwort enthält die drei getrennten Status.
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  CompleteReviewRequestSchema,
  ConfirmIntakeRequestSchema,
  CreateWorkOrderRequestSchema,
  FindingInputSchema,
  FindingSchema,
  FinishWorkItemRequestSchema,
  IdSchema,
  IntakeInputSchema,
  IntakeSchema,
  NotDoneWorkItemRequestSchema,
  PageSchema,
  PartUsedInputSchema,
  PhotoSchema,
  SetVisibilityRequestSchema,
  TimelineEntrySchema,
  UpdateWorkOrderRequestSchema,
  WorkItemInputSchema,
  WorkItemSchema,
  WorkOrderDetailSchema,
  WorkOrderSummarySchema,
  WorkOrderTransitionRequestSchema,
  AttachPhotoRequestSchema,
  API_PREFIX,
  type Finding,
  type Photo,
} from '@werkstatt/contracts';
import {
  berlinDateOf,
  canExecuteWorkItem,
  canTransitionWorkOrder,
  canViewWorkOrder,
  deriveServiceEntries,
  finishItem,
  hasPermission,
  markNotDone,
  pauseItem,
  startItem,
  type Actor,
  type WorkItemTransitionResult,
} from '@werkstatt/domain';
import type { DbOrTx } from '../db/index';
import {
  auditLog,
  customers,
  files,
  findings,
  intakes,
  maintenanceTypes,
  partsUsed,
  photos,
  serviceEntries,
  users,
  workItems,
  workOrderAssignees,
  workOrders,
} from '../db/schema/index';
import { audit, auditContextFrom } from '../lib/audit';
import { HttpError, conflict, forbidden, notFound, unprocessable } from '../lib/errors';
import { IdParamsSchema, PageQuerySchema, decodeCursor, ensure, ensureFound, page, requireActor } from '../lib/http';
import { enqueueNotification, notificationTargets, serviceRecipientIds } from '../notifications/outbox';
import { contentDisposition } from '../storage/fileSignature';
import { currentOwnerCustomerId, loadVisibleWorkOrder, workOrderListCondition, type WorkOrderRow } from '../services/access';
import { nextOrderNumber } from '../services/customers';
import { customerUserId } from '../services/recipients';
import { loadSettings } from '../services/settings';
import { toTimelineEntry } from '../services/timeline';
import {
  buildWorkOrderDetail,
  buildWorkOrderSummaries,
  intakeForActor,
  loadItemsWithMinutes,
  toIntakeDto,
  userNames,
  workItemForActor,
} from '../services/workOrders';
import {
  autoAdvanceWorkOrder,
  closeTimeEntries,
  invalidateIntakeConfirmationIfChanged,
  openTimeEntry,
  setWorkOrderStatus,
  type PendingEvents,
} from '../services/workOrderOps';
import { loadAttachableFile } from './files';
import { recordOdometer } from './vehicles';
import type { App } from '../types';

type ItemRow = typeof workItems.$inferSelect;
type FindingRow = typeof findings.$inferSelect;
type PhotoRow = typeof photos.$inferSelect;

const ListQuerySchema = PageQuerySchema.extend({
  work: z.enum(['draft', 'open', 'in_progress', 'work_completed', 'completed', 'picked_up', 'cancelled', 'active']).optional(),
  approval: z.enum(['none', 'pending', 'decided']).optional(),
  payment: z.enum(['no_invoice', 'open', 'partially_paid', 'paid', 'partially_refunded', 'refunded', 'cancelled']).optional(),
  assigneeId: IdSchema.optional(),
  readyForPickup: z.enum(['true', 'false']).optional(),
  customerId: IdSchema.optional(),
  vehicleId: IdSchema.optional(),
  q: z.string().trim().max(100).optional(),
});

const AssigneesSchema = z.object({ assigneeIds: z.array(IdSchema).max(20) });
const WorkItemUpdateSchema = WorkItemInputSchema.partial();
const ItemParamsSchema = IdParamsSchema;

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

function photoDto(p: PhotoRow): Photo {
  return {
    id: p.id,
    workOrderId: p.workOrderId,
    fileId: p.fileId,
    context: p.context,
    findingId: p.findingId,
    visibility: p.visibility,
    caption: p.caption,
    takenAt: p.takenAt.toISOString(),
    contentUrl: `${API_PREFIX}/photos/${p.id}/content`,
  };
}

async function findingDtos(db: DbOrTx, rows: FindingRow[]): Promise<Finding[]> {
  if (rows.length === 0) return [];
  const names = await userNames(db, rows.map((r) => r.reportedBy));
  const photoRows = await db
    .select({ id: photos.id, findingId: photos.findingId })
    .from(photos)
    .where(inArray(photos.findingId, rows.map((r) => r.id)));
  return rows.map((r) => ({
    id: r.id,
    workOrderId: r.workOrderId,
    workItemId: r.workItemId,
    description: r.description,
    severity: r.severity,
    status: r.status,
    reportedBy: { userId: r.reportedBy, displayName: names.get(r.reportedBy) ?? '' },
    dictated: r.dictated,
    photoIds: photoRows.filter((p) => p.findingId === r.id).map((p) => p.id),
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Staff-Sicht auf Auftrag erzwingen (Kunden: 404). */
function ensureStaff(actor: Actor): void {
  if (actor.role === 'customer') throw notFound();
}

async function assertAssignableStaff(db: DbOrTx, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, unique), inArray(users.role, ['admin', 'service', 'mechanic']), inArray(users.status, ['active', 'invited'])));
  if (rows.length !== unique.length) throw unprocessable('invalid_assignee', 'Mindestens ein zugewiesener Mitarbeiter ist unbekannt oder deaktiviert.');
}

function transitionError(result: WorkItemTransitionResult & { ok: false }): HttpError {
  return new HttpError(409, result.error.code.toLowerCase(), result.error.message);
}

export async function workOrderRoutes(app: App): Promise<void> {
  const publish = (events: PendingEvents) => {
    for (const e of events) app.deps.realtime.publish(e);
  };

  // Liste und Anlage -------------------------------------------------------------------------

  app.get('/work-orders', { schema: { querystring: ListQuerySchema, response: { 200: PageSchema(WorkOrderSummarySchema) } } }, async (request) => {
    const actor = requireActor(request);
    if (!actor.accountActive) throw notFound();
    const { db, now } = app.deps;
    const q = request.query;
    const conditions: (SQL | undefined)[] = [workOrderListCondition(actor)];
    if (q.work === 'active') conditions.push(inArray(workOrders.status, ['open', 'in_progress', 'work_completed']));
    else if (q.work) conditions.push(eq(workOrders.status, q.work));
    if (q.customerId) conditions.push(eq(workOrders.customerId, q.customerId));
    if (q.vehicleId) conditions.push(eq(workOrders.vehicleId, q.vehicleId));
    if (q.readyForPickup === 'true') conditions.push(and(isNotNull(workOrders.readyForPickupAt), isNull(workOrders.pickedUpAt)));
    if (q.assigneeId) {
      conditions.push(sql`(EXISTS (SELECT 1 FROM ${workOrderAssignees} a WHERE a.work_order_id = ${workOrders.id} AND a.user_id = ${q.assigneeId})
        OR EXISTS (SELECT 1 FROM ${workItems} i WHERE i.work_order_id = ${workOrders.id} AND i.assigned_to = ${q.assigneeId}))`);
    }
    if (q.q) {
      const like = `%${q.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      conditions.push(or(sql`${workOrders.orderNumber} ILIKE ${like}`, sql`${workOrders.title} ILIKE ${like}`));
    }
    const rows = await db.select().from(workOrders).where(and(...conditions)).orderBy(desc(workOrders.updatedAt)).limit(1000);
    let summaries = await buildWorkOrderSummaries(db, actor, rows, now());
    if (q.approval) summaries = summaries.filter((s) => s.status.approval === q.approval);
    if (q.payment) summaries = summaries.filter((s) => s.status.payment === q.payment);
    const offset = decodeCursor(q.cursor);
    return page(summaries.slice(offset, offset + q.limit + 1), offset, q.limit);
  });

  app.post('/work-orders', { schema: { body: CreateWorkOrderRequestSchema, response: { 201: WorkOrderDetailSchema } } }, async (request, reply) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'workOrders.write'));
    const { db, now: clock } = app.deps;
    const now = clock();
    const body = request.body;
    const events: PendingEvents = [];
    const wo = await db.transaction(async (tx) => {
      const [customer] = await tx.select().from(customers).where(eq(customers.id, body.customerId));
      if (!customer || customer.archivedAt) throw unprocessable('customer_invalid', 'Der Kunde wurde nicht gefunden oder ist archiviert.');
      if ((await currentOwnerCustomerId(tx, body.vehicleId)) !== body.customerId) {
        throw unprocessable('vehicle_not_owned_by_customer', 'Das Fahrzeug gehört nicht (mehr) zu diesem Kunden. Bitte ein Fahrzeug des Kunden wählen.');
      }
      await assertAssignableStaff(tx, [...body.assigneeIds, ...body.items.map((i) => i.assignedTo).filter((x): x is string => !!x)]);
      const [created] = await tx
        .insert(workOrders)
        .values({
          orderNumber: await nextOrderNumber(tx, now.getUTCFullYear()),
          customerId: body.customerId,
          vehicleId: body.vehicleId,
          status: 'open',
          title: body.title,
          descriptionCustomer: body.descriptionCustomer ?? null,
          notesInternal: body.notesInternal ?? null,
          costLimitCents: body.costLimitCents ?? null,
          plannedStart: body.plannedStart ? new Date(body.plannedStart) : null,
          plannedEnd: body.plannedEnd ? new Date(body.plannedEnd) : null,
          createdBy: actor.userId,
        })
        .returning();
      if (body.assigneeIds.length > 0) {
        await tx.insert(workOrderAssignees).values([...new Set(body.assigneeIds)].map((userId) => ({ workOrderId: created!.id, userId })));
      }
      if (body.items.length > 0) {
        await tx.insert(workItems).values(
          body.items.map((item, index) => ({
            workOrderId: created!.id,
            position: index + 1,
            kind: item.kind,
            title: item.title,
            description: item.description ?? null,
            maintenanceTypeId: item.maintenanceTypeId ?? null,
            intervalKm: item.intervalKm ?? null,
            intervalMonths: item.intervalMonths ?? null,
            quantity: item.quantity,
            unit: item.unit,
            unitPriceCents: item.unitPriceCents ?? null,
            vatRateBp: item.vatRateBp,
            origin: 'intake' as const,
            authorization: 'agreed' as const,
            assignedTo: item.assignedTo ?? null,
          })),
        );
      }
      await audit(tx, auditContextFrom(request), {
        action: 'work_order.created',
        entityType: 'work_order',
        entityId: created!.id,
        data: { workOrderId: created!.id, customerId: body.customerId, vehicleId: body.vehicleId, itemCount: body.items.length },
      });
      return created!;
    });
    publish(events);
    return reply.code(201).send(await buildWorkOrderDetail(db, actor, wo, now));
  });

  app.get('/work-orders/:id', { schema: { params: IdParamsSchema, response: { 200: WorkOrderDetailSchema } } }, async (request) => {
    const actor = requireActor(request);
    const { db, now } = app.deps;
    const { wo } = await loadVisibleWorkOrder(db, actor, request.params.id);
    return buildWorkOrderDetail(db, actor, wo, now());
  });

  app.patch(
    '/work-orders/:id',
    { schema: { params: IdParamsSchema, body: UpdateWorkOrderRequestSchema, response: { 200: WorkOrderDetailSchema } } },
    async (request) => {
      const actor = requireActor(request);
      ensure(hasPermission(actor, 'workOrders.write'));
      const { db, now } = app.deps;
      const body = request.body;
      const wo = await db.transaction(async (tx) => {
        const { wo: current } = await loadVisibleWorkOrder(tx, actor, request.params.id);
        if (current.status === 'cancelled' || current.status === 'picked_up') throw conflict('work_order_closed', 'Der Auftrag ist abgeschlossen und kann nicht mehr geändert werden.');
        const { assigneeIds, plannedStart, plannedEnd, ...rest } = body;
        const patch: Partial<typeof workOrders.$inferInsert> = { ...rest };
        if (plannedStart !== undefined) patch.plannedStart = plannedStart ? new Date(plannedStart) : null;
        if (plannedEnd !== undefined) patch.plannedEnd = plannedEnd ? new Date(plannedEnd) : null;
        const [updated] = await tx.update(workOrders).set(patch).where(eq(workOrders.id, current.id)).returning();
        if (assigneeIds) {
          await assertAssignableStaff(tx, assigneeIds);
          await tx.delete(workOrderAssignees).where(eq(workOrderAssignees.workOrderId, current.id));
          if (assigneeIds.length > 0) await tx.insert(workOrderAssignees).values([...new Set(assigneeIds)].map((userId) => ({ workOrderId: current.id, userId })));
        }
        await audit(tx, auditContextFrom(request), { action: 'work_order.updated', entityType: 'work_order', entityId: current.id, data: { workOrderId: current.id, fields: Object.keys(body) } });
        return updated!;
      });
      publish([{ type: 'work_order.updated', workOrderId: wo.id }]);
      return buildWorkOrderDetail(db, actor, wo, now());
    },
  );

  // Arbeitsstatus -----------------------------------------------------------------------------

  app.post(
    '/work-orders/:id/transition',
    { schema: { params: IdParamsSchema, body: WorkOrderTransitionRequestSchema, response: { 200: WorkOrderDetailSchema } } },
    async (request) => {
      const actor = requireActor(request);
      const { db, now: clock } = app.deps;
      const now = clock();
      const events: PendingEvents = [];
      const wo = await db.transaction(async (tx) => {
        const { wo: current } = await loadVisibleWorkOrder(tx, actor, request.params.id);
        ensureStaff(actor);
        const [locked] = await tx.select().from(workOrders).where(eq(workOrders.id, current.id)).for('update');
        const items = await tx.select({ authorization: workItems.authorization, executionStatus: workItems.executionStatus }).from(workItems).where(eq(workItems.workOrderId, current.id));
        const to = request.body.to;
        const check = canTransitionWorkOrder(locked!.status, to, { items, permissions: actor.permissions });
        if (!check.allowed) {
          if (check.code === 'MISSING_PERMISSION') throw forbidden(check.message);
          throw new HttpError(409, check.code.toLowerCase(), check.message);
        }
        await setWorkOrderStatus(tx, {
          workOrderId: current.id,
          from: locked!.status,
          to,
          ctx: auditContextFrom(request),
          events,
          reason: request.body.reason ?? null,
          extra: to === 'cancelled' ? { cancelledAt: now, cancelReason: request.body.reason ?? null } : undefined,
        });
        const [fresh] = await tx.select().from(workOrders).where(eq(workOrders.id, current.id));
        return fresh!;
      });
      publish(events);
      return buildWorkOrderDetail(db, actor, wo, now);
    },
  );

  app.post(
    '/work-orders/:id/complete-review',
    { schema: { params: IdParamsSchema, body: CompleteReviewRequestSchema, response: { 200: WorkOrderDetailSchema } } },
    async (request) => {
      const actor = requireActor(request);
      ensure(hasPermission(actor, 'workOrders.completeReview'));
      const { db, now: clock } = app.deps;
      const now = clock();
      const events: PendingEvents = [];
      const wo = await db.transaction(async (tx) => {
        const { wo: visible } = await loadVisibleWorkOrder(tx, actor, request.params.id);
        const [locked] = await tx.select().from(workOrders).where(eq(workOrders.id, visible.id)).for('update');
        const items = await tx.select().from(workItems).where(eq(workItems.workOrderId, visible.id));
        const ctx = auditContextFrom(request);
        const alreadyCompleted = locked!.status === 'completed' || locked!.status === 'picked_up';
        if (!alreadyCompleted) {
          const check = canTransitionWorkOrder(locked!.status, 'completed', { items, permissions: actor.permissions });
          if (!check.allowed) {
            if (check.code === 'MISSING_PERMISSION') throw forbidden(check.message);
            throw new HttpError(409, check.code.toLowerCase(), check.message);
          }
        }
        const odometerKm = request.body.odometerKm ?? null;
        if (!alreadyCompleted) {
          if (odometerKm !== null) {
            await recordOdometer(tx, {
              vehicleId: locked!.vehicleId,
              valueKm: odometerKm,
              recordedAt: now,
              source: 'work_completion',
              workOrderId: locked!.id,
              recordedBy: actor.userId,
            });
          }
          await setWorkOrderStatus(tx, {
            workOrderId: locked!.id,
            from: locked!.status,
            to: 'completed',
            ctx,
            events,
            extra: { completionReviewedAt: now, completionReviewedBy: actor.userId },
          });
          await audit(tx, ctx, { action: 'work_order.completion_reviewed', entityType: 'work_order', entityId: locked!.id, data: { workOrderId: locked!.id } });
        }
        // Serviceeinträge ausschließlich aus fachlich abgeschlossener, ausgeführter Arbeit (Geschäftslogik)
        const existing = await tx
          .select({ workItemId: serviceEntries.workItemId })
          .from(serviceEntries)
          .where(and(eq(serviceEntries.workOrderId, locked!.id), isNull(serviceEntries.revisionOfId)));
        const types = await tx.select().from(maintenanceTypes);
        const settings = await loadSettings(tx);
        const reviewedAt = alreadyCompleted ? (locked!.completionReviewedAt ?? now) : now;
        const { entries } = deriveServiceEntries({
          workOrder: { id: locked!.id, vehicleId: locked!.vehicleId, status: 'completed' },
          items: items.map((i) => ({
            id: i.id,
            workOrderId: i.workOrderId,
            title: i.title,
            description: i.description,
            maintenanceTypeId: i.maintenanceTypeId,
            intervalKm: i.intervalKm,
            intervalMonths: i.intervalMonths,
            authorization: i.authorization,
            executionStatus: i.executionStatus,
            doneOdometerKm: i.doneOdometerKm,
            resultNotes: i.resultNotes,
          })),
          maintenanceTypes: types.map((t) => ({ id: t.id, name: t.name, defaultIntervalKm: t.defaultIntervalKm, defaultIntervalMonths: t.defaultIntervalMonths })),
          performedOn: berlinDateOf(reviewedAt),
          odometerKm,
          workshopName: settings.name,
          existingEntriesForItems: existing.map((e) => e.workItemId),
          createdBy: actor.userId,
          now,
        });
        for (const e of entries) {
          const inserted = await tx
            .insert(serviceEntries)
            .values({
              vehicleId: e.vehicleId,
              workOrderId: e.workOrderId!,
              workItemId: e.workItemId!,
              maintenanceTypeId: e.maintenanceTypeId,
              performedOn: e.performedOn,
              odometerKm: e.odometerKm,
              title: e.title,
              details: e.details,
              workshopName: e.workshopName,
              intervalKm: e.intervalKm,
              intervalMonths: e.intervalMonths,
              nextDueDate: e.nextDueDate,
              nextDueKm: e.nextDueKm,
              status: 'valid',
              revisionNo: 1,
              source: 'work_completion',
              createdBy: actor.userId,
            })
            .onConflictDoNothing()
            .returning({ id: serviceEntries.id });
          if (inserted[0]) {
            await audit(tx, ctx, {
              action: 'service_entry.created',
              entityType: 'service_entry',
              entityId: inserted[0].id,
              data: { workOrderId: locked!.id, workItemId: e.workItemId, vehicleId: e.vehicleId },
            });
          }
        }
        const [fresh] = await tx.select().from(workOrders).where(eq(workOrders.id, locked!.id));
        return fresh!;
      });
      publish(events);
      return buildWorkOrderDetail(db, actor, wo, now);
    },
  );

  app.post('/work-orders/:id/ready-for-pickup', { schema: { params: IdParamsSchema, response: { 200: WorkOrderDetailSchema } } }, async (request) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'workOrders.write'));
    const { db, now: clock } = app.deps;
    const now = clock();
    const wo = await db.transaction(async (tx) => {
      const { wo: current } = await loadVisibleWorkOrder(tx, actor, request.params.id);
      if (current.status !== 'work_completed' && current.status !== 'completed') {
        throw conflict('not_ready', 'Abholbereit erst, wenn die Arbeiten erledigt sind.');
      }
      if (current.readyForPickupAt) return current;
      const [updated] = await tx.update(workOrders).set({ readyForPickupAt: now }).where(eq(workOrders.id, current.id)).returning();
      await audit(tx, auditContextFrom(request), { action: 'work_order.ready_for_pickup', entityType: 'work_order', entityId: current.id, data: { workOrderId: current.id } });
      const customerUser = await customerUserId(tx, current.customerId);
      if (customerUser) {
        await enqueueNotification(
          tx,
          {
            eventType: 'work_order.ready_for_pickup',
            title: 'Fahrzeug abholbereit',
            body: 'Ihr Fahrzeug ist abholbereit.',
            recipients: [{ userId: customerUser, targetPath: notificationTargets.readyForPickupForCustomer(current.id) }],
            dedupeKey: `work_order.ready_for_pickup:${current.id}`,
          },
          now,
        );
      }
      return updated!;
    });
    publish([{ type: 'work_order.updated', workOrderId: wo.id }]);
    return buildWorkOrderDetail(db, actor, wo, now);
  });

  app.post('/work-orders/:id/picked-up', { schema: { params: IdParamsSchema, response: { 200: WorkOrderDetailSchema } } }, async (request) => {
    const actor = requireActor(request);
    const { db, now: clock } = app.deps;
    const now = clock();
    const events: PendingEvents = [];
    const wo = await db.transaction(async (tx) => {
      const { wo: current } = await loadVisibleWorkOrder(tx, actor, request.params.id);
      ensureStaff(actor);
      const items = await tx.select({ authorization: workItems.authorization, executionStatus: workItems.executionStatus }).from(workItems).where(eq(workItems.workOrderId, current.id));
      const check = canTransitionWorkOrder(current.status, 'picked_up', { items, permissions: actor.permissions });
      if (!check.allowed) {
        if (check.code === 'MISSING_PERMISSION') throw forbidden(check.message);
        throw new HttpError(409, check.code.toLowerCase(), check.message);
      }
      await setWorkOrderStatus(tx, { workOrderId: current.id, from: current.status, to: 'picked_up', ctx: auditContextFrom(request), events, extra: { pickedUpAt: now } });
      await audit(tx, auditContextFrom(request), { action: 'work_order.picked_up', entityType: 'work_order', entityId: current.id, data: { workOrderId: current.id } });
      const [fresh] = await tx.select().from(workOrders).where(eq(workOrders.id, current.id));
      return fresh!;
    });
    publish(events);
    return buildWorkOrderDetail(db, actor, wo, now);
  });

  app.put('/work-orders/:id/assignees', { schema: { params: IdParamsSchema, body: AssigneesSchema, response: { 200: WorkOrderDetailSchema } } }, async (request) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'workOrders.write'));
    const { db, now } = app.deps;
    const wo = await db.transaction(async (tx) => {
      const { wo: current } = await loadVisibleWorkOrder(tx, actor, request.params.id);
      await assertAssignableStaff(tx, request.body.assigneeIds);
      await tx.delete(workOrderAssignees).where(eq(workOrderAssignees.workOrderId, current.id));
      const ids = [...new Set(request.body.assigneeIds)];
      if (ids.length > 0) await tx.insert(workOrderAssignees).values(ids.map((userId) => ({ workOrderId: current.id, userId })));
      await audit(tx, auditContextFrom(request), { action: 'work_order.assignees_changed', entityType: 'work_order', entityId: current.id, data: { workOrderId: current.id, assigneeIds: ids } });
      return current;
    });
    return buildWorkOrderDetail(db, actor, wo, now());
  });

  // Annahme ---------------------------------------------------------------------------------

  app.get('/work-orders/:id/intake', { schema: { params: IdParamsSchema, response: { 200: IntakeSchema } } }, async (request) => {
    const actor = requireActor(request);
    const { db } = app.deps;
    const { wo } = await loadVisibleWorkOrder(db, actor, request.params.id);
    const [intake] = await db.select().from(intakes).where(eq(intakes.workOrderId, wo.id));
    ensureFound(intake);
    const items = await db.select().from(workItems).where(eq(workItems.workOrderId, wo.id));
    return intakeForActor(toIntakeDto(intake!, items), actor);
  });

  app.put('/work-orders/:id/intake', { schema: { params: IdParamsSchema, body: IntakeInputSchema, response: { 200: IntakeSchema } } }, async (request) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'intake.write'));
    const { db, now: clock } = app.deps;
    const now = clock();
    const body = request.body;
    const result = await db.transaction(async (tx) => {
      const { wo } = await loadVisibleWorkOrder(tx, actor, request.params.id);
      if (wo.status === 'cancelled' || wo.status === 'picked_up') throw conflict('work_order_closed', 'Der Auftrag ist abgeschlossen.');
      const [existing] = await tx.select().from(intakes).where(eq(intakes.workOrderId, wo.id)).for('update');
      const values = {
        workOrderId: wo.id,
        vehicleId: wo.vehicleId,
        odometerKm: body.odometerKm,
        fuelLevel: body.fuelLevel ?? null,
        customerComplaint: body.customerComplaint,
        damages: body.damages,
        agreedServices: body.agreedServices,
        costLimitCents: body.costLimitCents ?? null,
        notesInternal: body.notesInternal ?? null,
        notesCustomer: body.notesCustomer ?? null,
      };
      const [row] = existing
        ? await tx.update(intakes).set(values).where(eq(intakes.id, existing.id)).returning()
        : await tx.insert(intakes).values(values).returning();
      if (body.odometerKm !== null && body.odometerKm !== existing?.odometerKm) {
        await recordOdometer(tx, { vehicleId: wo.vehicleId, valueKm: body.odometerKm, recordedAt: now, source: 'intake', workOrderId: wo.id, recordedBy: actor.userId });
      }
      const ctx = auditContextFrom(request);
      await audit(tx, ctx, { action: 'intake.saved', entityType: 'work_order', entityId: wo.id, data: { workOrderId: wo.id } });
      await invalidateIntakeConfirmationIfChanged(tx, wo.id, ctx);
      const [fresh] = await tx.select().from(intakes).where(eq(intakes.id, row!.id));
      const items = await tx.select().from(workItems).where(eq(workItems.workOrderId, wo.id));
      return toIntakeDto(fresh!, items);
    });
    return intakeForActor(result, actor);
  });

  app.post(
    '/work-orders/:id/intake/confirm',
    { schema: { params: IdParamsSchema, body: ConfirmIntakeRequestSchema, response: { 200: IntakeSchema } } },
    async (request) => {
      const actor = requireActor(request);
      const { db, now: clock } = app.deps;
      const now = clock();
      const result = await db.transaction(async (tx) => {
        const { wo } = await loadVisibleWorkOrder(tx, actor, request.params.id);
        if (request.body.method === 'app') {
          // Bestätigung in der App nur durch das Kundenkonto des Auftraggebers
          if (actor.role !== 'customer') throw forbidden('Die Bestätigung in der App erfolgt durch den Kunden.');
        } else {
          ensure(hasPermission(actor, 'intake.write'));
        }
        const [intake] = await tx.select().from(intakes).where(eq(intakes.workOrderId, wo.id)).for('update');
        ensureFound(intake);
        const items = await tx.select().from(workItems).where(eq(workItems.workOrderId, wo.id));
        const current = toIntakeDto(intake!, items).contentHash!;
        if (current !== request.body.contentHash.toLowerCase()) {
          throw conflict('intake_changed', 'Die Annahme wurde inzwischen geändert. Bitte die aktuelle Fassung prüfen.');
        }
        if (!(intake!.confirmedAt && intake!.contentHash === current)) {
          await tx
            .update(intakes)
            .set({ confirmedAt: now, confirmationMethod: request.body.method, confirmedByUserId: actor.userId, contentHash: current })
            .where(eq(intakes.id, intake!.id));
          await audit(tx, auditContextFrom(request), {
            action: 'intake.confirmed',
            entityType: 'work_order',
            entityId: wo.id,
            data: { workOrderId: wo.id, method: request.body.method, contentHash: current },
          });
        }
        const [fresh] = await tx.select().from(intakes).where(eq(intakes.id, intake!.id));
        return toIntakeDto(fresh!, items);
      });
      return intakeForActor(result, actor);
    },
  );

  // Positionen --------------------------------------------------------------------------------

  app.post('/work-orders/:id/items', { schema: { params: IdParamsSchema, body: WorkItemInputSchema, response: { 201: WorkItemSchema } } }, async (request, reply) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'workOrders.write'));
    const { db, now } = app.deps;
    const events: PendingEvents = [];
    const item = await db.transaction(async (tx) => {
      const { wo } = await loadVisibleWorkOrder(tx, actor, request.params.id);
      if (!['draft', 'open', 'in_progress', 'work_completed'].includes(wo.status)) {
        throw conflict('work_order_closed', 'Zu einem abgeschlossenen Auftrag können keine Positionen hinzugefügt werden.');
      }
      const [intake] = await tx.select({ confirmedAt: intakes.confirmedAt }).from(intakes).where(eq(intakes.workOrderId, wo.id));
      if (intake?.confirmedAt) {
        // R-ANN-3: Die bestätigte Annahme deckt keine späteren Zusatzarbeiten
        throw conflict('approval_required', 'Die Annahme ist bestätigt. Weitere Arbeiten bitte als Freigabeanfrage an den Kunden senden.');
      }
      const body = request.body;
      if (body.assignedTo) await assertAssignableStaff(tx, [body.assignedTo]);
      const [max] = await tx.select({ n: sql<number>`coalesce(max(${workItems.position}), 0)::int` }).from(workItems).where(eq(workItems.workOrderId, wo.id));
      const [created] = await tx
        .insert(workItems)
        .values({
          workOrderId: wo.id,
          position: (max?.n ?? 0) + 1,
          kind: body.kind,
          title: body.title,
          description: body.description ?? null,
          maintenanceTypeId: body.maintenanceTypeId ?? null,
          intervalKm: body.intervalKm ?? null,
          intervalMonths: body.intervalMonths ?? null,
          quantity: body.quantity,
          unit: body.unit,
          unitPriceCents: body.unitPriceCents ?? null,
          vatRateBp: body.vatRateBp,
          origin: 'intake',
          authorization: 'agreed',
          assignedTo: body.assignedTo ?? null,
        })
        .returning();
      const ctx = auditContextFrom(request);
      await audit(tx, ctx, { action: 'work_item.added', entityType: 'work_item', entityId: created!.id, data: { workOrderId: wo.id } });
      await autoAdvanceWorkOrder(tx, wo.id, actor, ctx, events);
      return created!;
    });
    publish([...events, { type: 'work_order.updated', workOrderId: item.workOrderId }]);
    const { dtos } = await loadItemsWithMinutes(db, item.workOrderId, now());
    return reply.code(201).send(workItemForActor(dtos.find((d) => d.id === item.id)!, actor));
  });

  app.patch('/work-items/:id', { schema: { params: ItemParamsSchema, body: WorkItemUpdateSchema, response: { 200: WorkItemSchema } } }, async (request) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'workOrders.write'));
    const { db, now } = app.deps;
    const item = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(workItems).where(eq(workItems.id, request.params.id)).for('update');
      ensureFound(current);
      await loadVisibleWorkOrder(tx, actor, current!.workOrderId);
      if (current!.approvalRequestId) {
        throw conflict('approval_bound', 'Diese Position gehört zu einer Freigabeanfrage. Änderungen bitte als neue Fassung der Anfrage senden.');
      }
      if (current!.executionStatus === 'done' || current!.executionStatus === 'not_done') {
        throw conflict('item_finished', 'Abgeschlossene Positionen können nicht mehr geändert werden.');
      }
      if (request.body.assignedTo) await assertAssignableStaff(tx, [request.body.assignedTo]);
      const [updated] = await tx.update(workItems).set(request.body).where(eq(workItems.id, current!.id)).returning();
      const ctx = auditContextFrom(request);
      await audit(tx, ctx, { action: 'work_item.updated', entityType: 'work_item', entityId: current!.id, data: { workOrderId: current!.workOrderId, fields: Object.keys(request.body) } });
      await invalidateIntakeConfirmationIfChanged(tx, current!.workOrderId, ctx);
      return updated!;
    });
    const { dtos } = await loadItemsWithMinutes(db, item.workOrderId, now());
    return workItemForActor(dtos.find((d) => d.id === item.id)!, actor);
  });

  type ExecAction = 'start' | 'pause' | 'finish' | 'not-done';

  async function executeItem(
    request: Parameters<Parameters<typeof app.post>[2]>[0] & { params: { id: string } },
    action: ExecAction,
    body: Record<string, unknown>,
  ) {
    const actor = requireActor(request);
    const { db, now: clock } = app.deps;
    const now = clock();
    const events: PendingEvents = [];
    const item = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(workItems).where(eq(workItems.id, request.params.id)).for('update');
      ensureFound(current);
      const [wo] = await tx.select().from(workOrders).where(eq(workOrders.id, current!.workOrderId));
      const { access } = await loadVisibleWorkOrder(tx, actor, current!.workOrderId);
      void access;
      ensure(canExecuteWorkItem(actor, { assignedToUserId: current!.assignedTo, authorization: current!.authorization, workOrderStatus: wo!.status }));
      const state = { authorization: current!.authorization, executionStatus: current!.executionStatus, maintenanceTypeId: current!.maintenanceTypeId };
      let result: WorkItemTransitionResult;
      if (action === 'start') result = startItem(state, { now });
      else if (action === 'pause') result = pauseItem(state, { now });
      else if (action === 'finish') {
        const hasKmKey = Object.prototype.hasOwnProperty.call(body, 'odometerKm');
        const km = (body.odometerKm as number | null | undefined) ?? null;
        result = finishItem(state, {
          now,
          odometerKm: km,
          // ausdrücklich `odometerKm: null` = km-Stand unbekannt
          odometerUnknown: hasKmKey && body.odometerKm === null,
          resultNotes: (body.resultNotes as string | null | undefined) ?? null,
        });
      } else result = markNotDone(state, { now, reason: String(body.reason ?? '') });
      if (!result.ok) throw transitionError(result);
      const t = result.value;
      const patch: Partial<typeof workItems.$inferInsert> = { executionStatus: t.executionStatus };
      if (action === 'finish') {
        patch.doneAt = t.doneAt ? new Date(t.doneAt) : now;
        patch.doneBy = actor.userId;
        patch.doneOdometerKm = t.doneOdometerKm;
        patch.resultNotes = t.resultNotes;
        if (body.intervalKm !== undefined) patch.intervalKm = body.intervalKm as number | null;
        if (body.intervalMonths !== undefined) patch.intervalMonths = body.intervalMonths as number | null;
      }
      if (action === 'not-done') {
        patch.notDoneReason = t.resultNotes;
        patch.resultNotes = t.resultNotes;
      }
      const [updated] = await tx.update(workItems).set(patch).where(eq(workItems.id, current!.id)).returning();
      if (t.timeEntry.action === 'open') await openTimeEntry(tx, current!.id, actor.userId, new Date(t.timeEntry.at));
      if (t.timeEntry.action === 'close') await closeTimeEntries(tx, current!.id, new Date(t.timeEntry.at));
      if (action === 'finish' && t.doneOdometerKm !== null) {
        await recordOdometer(tx, { vehicleId: wo!.vehicleId, valueKm: t.doneOdometerKm, recordedAt: now, source: 'work_completion', workOrderId: wo!.id, recordedBy: actor.userId });
      }
      const ctx = auditContextFrom(request);
      const auditAction = ({ start: 'work_item.started', pause: 'work_item.paused', finish: 'work_item.finished', 'not-done': 'work_item.not_done' } as const)[action];
      await audit(tx, ctx, { action: auditAction, entityType: 'work_item', entityId: current!.id, data: { workOrderId: current!.workOrderId } });
      await autoAdvanceWorkOrder(tx, current!.workOrderId, actor, ctx, events);
      return updated!;
    });
    publish([...events, { type: 'work_order.updated', workOrderId: item.workOrderId }]);
    const { dtos } = await loadItemsWithMinutes(db, item.workOrderId, now);
    return workItemForActor(dtos.find((d) => d.id === item.id)!, actor);
  }

  app.post('/work-items/:id/start', { schema: { params: ItemParamsSchema, response: { 200: WorkItemSchema } } }, (request) => executeItem(request, 'start', {}));
  app.post('/work-items/:id/pause', { schema: { params: ItemParamsSchema, response: { 200: WorkItemSchema } } }, (request) => executeItem(request, 'pause', {}));
  app.post(
    '/work-items/:id/finish',
    { schema: { params: ItemParamsSchema, body: FinishWorkItemRequestSchema, response: { 200: WorkItemSchema } } },
    (request) => executeItem(request, 'finish', (request.body ?? {}) as Record<string, unknown>),
  );
  app.post(
    '/work-items/:id/not-done',
    { schema: { params: ItemParamsSchema, body: NotDoneWorkItemRequestSchema, response: { 200: WorkItemSchema } } },
    (request) => executeItem(request, 'not-done', request.body as Record<string, unknown>),
  );

  app.post('/work-items/:id/parts', { schema: { params: ItemParamsSchema, body: PartUsedInputSchema, response: { 201: WorkItemSchema } } }, async (request, reply) => {
    const actor = requireActor(request);
    const { db, now } = app.deps;
    const item = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(workItems).where(eq(workItems.id, request.params.id));
      ensureFound(current);
      const [wo] = await tx.select().from(workOrders).where(eq(workOrders.id, current!.workOrderId));
      await loadVisibleWorkOrder(tx, actor, current!.workOrderId);
      ensure(canExecuteWorkItem(actor, { assignedToUserId: current!.assignedTo, authorization: current!.authorization, workOrderStatus: wo!.status }));
      await tx.insert(partsUsed).values({
        workItemId: current!.id,
        partNumber: request.body.partNumber ?? null,
        description: request.body.description,
        quantity: request.body.quantity,
        // Mechaniker erfassen keine Preise
        unitPriceCents: actor.role === 'mechanic' ? null : (request.body.unitPriceCents ?? null),
        recordedBy: actor.userId,
      });
      await audit(tx, auditContextFrom(request), { action: 'work_item.part_added', entityType: 'work_item', entityId: current!.id, data: { workOrderId: current!.workOrderId } });
      return current!;
    });
    const { dtos } = await loadItemsWithMinutes(db, item.workOrderId, now());
    return reply.code(201).send(workItemForActor(dtos.find((d) => d.id === item.id)!, actor));
  });

  // Feststellungen ----------------------------------------------------------------------------

  app.get('/work-orders/:id/findings', { schema: { params: IdParamsSchema, response: { 200: z.array(FindingSchema) } } }, async (request) => {
    const actor = requireActor(request);
    ensureStaff(actor);
    const { db } = app.deps;
    const { wo } = await loadVisibleWorkOrder(db, actor, request.params.id);
    const rows = await db.select().from(findings).where(eq(findings.workOrderId, wo.id)).orderBy(asc(findings.createdAt));
    return findingDtos(db, rows);
  });

  app.post('/work-orders/:id/findings', { schema: { params: IdParamsSchema, body: FindingInputSchema, response: { 201: FindingSchema, 200: FindingSchema } } }, async (request, reply) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'findings.write'));
    const { db } = app.deps;
    const body = request.body;
    const { row, created } = await db.transaction(async (tx) => {
      const { wo } = await loadVisibleWorkOrder(tx, actor, request.params.id);
      if (body.id) {
        const [existing] = await tx.select().from(findings).where(eq(findings.id, body.id));
        if (existing) {
          if (existing.workOrderId !== wo.id || existing.reportedBy !== actor.userId) throw conflict('id_in_use', 'Diese ID ist bereits vergeben.');
          return { row: existing, created: false };
        }
      }
      if (body.workItemId) {
        const [item] = await tx.select({ workOrderId: workItems.workOrderId }).from(workItems).where(eq(workItems.id, body.workItemId));
        if (!item || item.workOrderId !== wo.id) throw unprocessable('invalid_work_item', 'Die Position gehört nicht zu diesem Auftrag.');
      }
      const [inserted] = await tx
        .insert(findings)
        .values({
          ...(body.id ? { id: body.id } : {}),
          workOrderId: wo.id,
          workItemId: body.workItemId ?? null,
          description: body.description,
          severity: body.severity,
          reportedBy: actor.userId,
          dictated: body.dictated,
        })
        .returning();
      if (body.photoIds.length > 0) {
        await tx
          .update(photos)
          .set({ findingId: inserted!.id })
          .where(and(inArray(photos.id, body.photoIds), eq(photos.workOrderId, wo.id)));
      }
      await audit(tx, auditContextFrom(request), { action: 'finding.created', entityType: 'finding', entityId: inserted!.id, data: { workOrderId: wo.id, severity: body.severity } });
      return { row: inserted!, created: true };
    });
    const [dto] = await findingDtos(db, [row]);
    return reply.code(created ? 201 : 200).send(dto!);
  });

  async function changeFinding(request: { params: { id: string } } & Parameters<typeof auditContextFrom>[0], to: 'reported' | 'dismissed') {
    const actor = requireActor(request);
    if (to === 'reported') ensure(hasPermission(actor, 'findings.write'));
    else if (!(actor.permissions.has('approvals.request') || actor.permissions.has('workOrders.write'))) ensure(hasPermission(actor, 'approvals.request'));
    const { db, now: clock } = app.deps;
    const now = clock();
    const row = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(findings).where(eq(findings.id, request.params.id)).for('update');
      ensureFound(current);
      const { wo } = await loadVisibleWorkOrder(tx, actor, current!.workOrderId);
      if (current!.status === 'converted' || current!.status === 'dismissed') throw conflict('finding_closed', 'Die Feststellung ist bereits erledigt.');
      if (current!.status === to) return current!;
      const [updated] = await tx
        .update(findings)
        .set({ status: to, ...(to === 'reported' ? { reportedAt: now } : {}) })
        .where(eq(findings.id, current!.id))
        .returning();
      await audit(tx, auditContextFrom(request), {
        action: to === 'reported' ? 'finding.reported' : 'finding.dismissed',
        entityType: 'finding',
        entityId: current!.id,
        data: { workOrderId: wo.id },
      });
      if (to === 'reported') {
        await enqueueNotification(
          tx,
          {
            eventType: 'finding.reported',
            title: 'Zusatzarbeit gemeldet',
            body: `Zu Auftrag ${wo.orderNumber} wurde eine Zusatzarbeit gemeldet.`,
            recipients: (await serviceRecipientIds(tx)).map((userId) => ({ userId, targetPath: notificationTargets.findingForService(wo.id) })),
            dedupeKey: `finding.reported:${current!.id}`,
          },
          now,
        );
      }
      return updated!;
    });
    const [dto] = await findingDtos(db, [row]);
    return dto!;
  }

  app.post('/findings/:id/report', { schema: { params: IdParamsSchema, response: { 200: FindingSchema } } }, (request) => changeFinding(request, 'reported'));
  app.post('/findings/:id/dismiss', { schema: { params: IdParamsSchema, response: { 200: FindingSchema } } }, (request) => changeFinding(request, 'dismissed'));

  // Fotos -------------------------------------------------------------------------------------

  app.get('/work-orders/:id/photos', { schema: { params: IdParamsSchema, response: { 200: z.array(PhotoSchema) } } }, async (request) => {
    const actor = requireActor(request);
    const { db } = app.deps;
    const { wo } = await loadVisibleWorkOrder(db, actor, request.params.id);
    const conditions = [eq(photos.workOrderId, wo.id)];
    if (actor.role === 'customer') conditions.push(eq(photos.visibility, 'customer'));
    const rows = await db.select().from(photos).where(and(...conditions)).orderBy(asc(photos.takenAt));
    return rows.map(photoDto);
  });

  app.post('/work-orders/:id/photos', { schema: { params: IdParamsSchema, body: AttachPhotoRequestSchema, response: { 201: PhotoSchema, 200: PhotoSchema } } }, async (request, reply) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'findings.write'));
    const { db, now } = app.deps;
    const body = request.body;
    const { row, created } = await db.transaction(async (tx) => {
      const { wo } = await loadVisibleWorkOrder(tx, actor, request.params.id);
      if (body.id) {
        const [existing] = await tx.select().from(photos).where(eq(photos.id, body.id));
        if (existing) {
          if (existing.workOrderId !== wo.id || existing.fileId !== body.fileId) throw conflict('id_in_use', 'Diese ID ist bereits vergeben.');
          return { row: existing, created: false };
        }
      }
      const file = await loadAttachableFile(tx, actor, body.fileId);
      if (!IMAGE_TYPES.has(file.mimeType)) throw unprocessable('not_an_image', 'Fotos müssen Bilddateien sein (JPEG, PNG, WebP, HEIC).');
      if (body.findingId) {
        const [finding] = await tx.select({ workOrderId: findings.workOrderId }).from(findings).where(eq(findings.id, body.findingId));
        if (!finding || finding.workOrderId !== wo.id) throw unprocessable('invalid_finding', 'Die Feststellung gehört nicht zu diesem Auftrag.');
      }
      const [inserted] = await tx
        .insert(photos)
        .values({
          ...(body.id ? { id: body.id } : {}),
          fileId: file.id,
          workOrderId: wo.id,
          context: body.context,
          findingId: body.findingId ?? null,
          visibility: 'internal',
          caption: body.caption ?? null,
          takenBy: actor.userId,
          takenAt: body.takenAt ? new Date(body.takenAt) : now(),
        })
        .returning();
      await audit(tx, auditContextFrom(request), { action: 'photo.attached', entityType: 'photo', entityId: inserted!.id, data: { workOrderId: wo.id, context: body.context } });
      return { row: inserted!, created: true };
    });
    return reply.code(created ? 201 : 200).send(photoDto(row));
  });

  app.put('/photos/:id/visibility', { schema: { params: IdParamsSchema, body: SetVisibilityRequestSchema, response: { 200: PhotoSchema } } }, async (request) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'documents.publish'));
    const { db } = app.deps;
    const row = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(photos).where(eq(photos.id, request.params.id));
      ensureFound(current);
      await loadVisibleWorkOrder(tx, actor, current!.workOrderId);
      const [updated] = await tx.update(photos).set({ visibility: request.body.visibility }).where(eq(photos.id, current!.id)).returning();
      await audit(tx, auditContextFrom(request), {
        action: 'photo.visibility_changed',
        entityType: 'photo',
        entityId: current!.id,
        data: { workOrderId: current!.workOrderId, visibility: request.body.visibility },
      });
      return updated!;
    });
    return photoDto(row);
  });

  app.get('/photos/:id/content', { schema: { params: IdParamsSchema } }, async (request, reply) => {
    const actor = requireActor(request);
    const { db, storage } = app.deps;
    const [photo] = await db.select().from(photos).where(eq(photos.id, request.params.id));
    ensureFound(photo);
    const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, photo!.workOrderId));
    const { access } = await loadVisibleWorkOrder(db, actor, wo!.id);
    ensure(canViewWorkOrder(actor, access));
    // Kunden sehen nur ausdrücklich freigegebene Fotos (Standard intern)
    if (actor.role === 'customer' && photo!.visibility !== 'customer') throw notFound();
    const [file] = await db.select().from(files).where(eq(files.id, photo!.fileId));
    ensureFound(file);
    const stream = await storage.read(file!.storageKey);
    return reply
      .type(file!.mimeType)
      .header('content-disposition', contentDisposition('inline', file!.originalName))
      .header('x-content-type-options', 'nosniff')
      .send(stream);
  });

  // Verlauf -----------------------------------------------------------------------------------

  app.get('/work-orders/:id/timeline', { schema: { params: IdParamsSchema, response: { 200: z.array(TimelineEntrySchema) } } }, async (request) => {
    const actor = requireActor(request);
    ensureStaff(actor);
    const { db } = app.deps;
    const { wo } = await loadVisibleWorkOrder(db, actor, request.params.id);
    const rows = await db
      .select()
      .from(auditLog)
      .where(or(and(eq(auditLog.entityType, 'work_order'), eq(auditLog.entityId, wo.id)), sql`${auditLog.data}->>'workOrderId' = ${wo.id}`))
      .orderBy(asc(auditLog.occurredAt), asc(auditLog.id))
      .limit(1000);
    const names = await userNames(db, rows.map((r) => r.actorUserId ?? ''));
    return rows.map((r) => toTimelineEntry(r, r.actorUserId ? (names.get(r.actorUserId) ?? null) : null));
  });
}

export type { WorkOrderRow };
