/**
 * Termine (R-KAL): Anfrage ≠ Buchung. Bestätigen, Alternative vorschlagen, Annahme/Ablehnung
 * durch den Kunden, Absage. Konfliktprüfung (Hebebühne, Mitarbeiter, Arbeits-/Öffnungszeiten,
 * fehlende Teile) über die Geschäftslogik; bei Konflikten Speichern nur mit Begründung.
 */
import { and, asc, eq, gt, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  AppointmentInputSchema,
  AppointmentRequestInputSchema,
  AppointmentSchema,
  CancelRequestSchema,
  IdSchema,
  IsoDateTimeSchema,
  ProposeAlternativeRequestSchema,
  ResourceSchema,
  SchedulingConflictSchema,
  type Appointment,
  type AppointmentStatus,
  type SchedulingConflict,
  API_ERROR_CODES,
} from '@werkstatt/contracts';
import {
  acceptProposal,
  canTransitionAppointment,
  canViewAppointment,
  canViewVehicle,
  declineProposal,
  detectConflicts,
  hasPermission,
  proposeAlternative,
  type Actor,
} from '@werkstatt/domain';
import type { DbOrTx } from '../db/index';
import {
  appointmentAssignees,
  appointmentProposals,
  appointments,
  customers,
  partDemands,
  resources,
  staffWorkingHours,
  users,
  vehicles,
  workOrders,
} from '../db/schema/index';
import { audit, auditContextFrom } from '../lib/audit';
import { HttpError, forbidden, unprocessable } from '../lib/errors';
import { IdParamsSchema, ensure, ensureFound, requireActor } from '../lib/http';
import { enqueueNotification, notificationTargets, serviceRecipientIds } from '../notifications/outbox';
import { currentOwnerCustomerId, vehicleAccessInput } from '../services/access';
import { customerDisplayName } from '../services/customers';
import { loadSettings } from '../services/settings';
import { vehicleLabel } from '../services/vehicles';
import { customerUserId } from '../services/recipients';
import type { App } from '../types';

type AppointmentRow = typeof appointments.$inferSelect;

const ListQuerySchema = z.object({
  from: IsoDateTimeSchema.optional(),
  to: IsoDateTimeSchema.optional(),
  status: z.enum(['requested', 'proposed', 'confirmed', 'cancelled', 'completed', 'no_show']).optional(),
  resourceId: IdSchema.optional(),
  assigneeId: IdSchema.optional(),
});

const ConflictCheckSchema = z
  .object({
    id: IdSchema.nullable().optional(),
    startsAt: IsoDateTimeSchema,
    endsAt: IsoDateTimeSchema,
    resourceId: IdSchema.nullable().optional(),
    assigneeIds: z.array(IdSchema).default([]),
    workOrderId: IdSchema.nullable().optional(),
  })
  .refine((a) => a.endsAt > a.startsAt, { message: 'Ende muss nach Beginn liegen', path: ['endsAt'] });

const ConfirmSchema = z.object({ overrideConflictsReason: z.string().trim().max(500).nullable().optional() }).default({});
const DeclineSchema = z.object({ cancel: z.boolean().default(false) }).default({ cancel: false });

async function toAppointmentDtos(db: DbOrTx, rows: AppointmentRow[], actor: Actor): Promise<Appointment[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const custRows = await db.select().from(customers).where(inArray(customers.id, [...new Set(rows.map((r) => r.customerId))]));
  const vehRows = await db.select().from(vehicles).where(inArray(vehicles.id, [...new Set(rows.map((r) => r.vehicleId))]));
  const assignees = await db.select().from(appointmentAssignees).where(inArray(appointmentAssignees.appointmentId, ids));
  const proposals = await db.select().from(appointmentProposals).where(inArray(appointmentProposals.appointmentId, ids)).orderBy(asc(appointmentProposals.createdAt));
  const staff = actor.role !== 'customer';
  return rows.map((r) => {
    const customer = custRows.find((c) => c.id === r.customerId);
    const vehicle = vehRows.find((v) => v.id === r.vehicleId);
    const dto: Appointment = {
      id: r.id,
      kind: r.kind,
      status: r.status,
      customerId: r.customerId,
      customerDisplayName: customer ? customerDisplayName(customer) : '',
      vehicleId: r.vehicleId,
      vehicleLabel: vehicle ? vehicleLabel(vehicle) : '',
      workOrderId: r.workOrderId,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      requestedBy: r.requestedBy,
      customerNote: r.customerNote,
      proposals: proposals
        .filter((p) => p.appointmentId === r.id)
        .map((p) => ({ id: p.id, startsAt: p.startsAt.toISOString(), endsAt: p.endsAt.toISOString(), status: p.status, createdAt: p.createdAt.toISOString() })),
      confirmedAt: r.confirmedAt ? r.confirmedAt.toISOString() : null,
      cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null,
      cancelReason: r.cancelReason,
    };
    if (staff) {
      dto.resourceId = r.resourceId;
      dto.assigneeIds = assignees.filter((a) => a.appointmentId === r.id).map((a) => a.userId);
      dto.internalNote = r.internalNote;
    }
    return dto;
  });
}

async function toDto(db: DbOrTx, row: AppointmentRow, actor: Actor): Promise<Appointment> {
  const [dto] = await toAppointmentDtos(db, [row], actor);
  return dto!;
}

async function loadVisibleAppointment(db: DbOrTx, actor: Actor, id: string, forUpdate = false): Promise<AppointmentRow> {
  const query = db.select().from(appointments).where(eq(appointments.id, id));
  const [row] = forUpdate ? await query.for('update') : await query;
  ensureFound(row);
  const assignees = await db.select({ userId: appointmentAssignees.userId }).from(appointmentAssignees).where(eq(appointmentAssignees.appointmentId, id));
  ensure(canViewAppointment(actor, { customerId: row!.customerId, assigneeUserIds: assignees.map((a) => a.userId) }));
  return row!;
}

/** Konflikte über die Geschäftslogik ermitteln (Datenbeschaffung hier, Regeln in packages/domain). */
export async function findConflicts(
  db: DbOrTx,
  candidate: { id?: string | null; startsAt: string; endsAt: string; resourceId?: string | null; assigneeIds: string[]; workOrderId?: string | null },
): Promise<SchedulingConflict[]> {
  const start = new Date(candidate.startsAt);
  const end = new Date(candidate.endsAt);
  const overlapping = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.status, 'confirmed'), lt(appointments.startsAt, end), gt(appointments.endsAt, start)));
  const overlapAssignees =
    overlapping.length > 0
      ? await db.select().from(appointmentAssignees).where(inArray(appointmentAssignees.appointmentId, overlapping.map((o) => o.id)))
      : [];
  const hours =
    candidate.assigneeIds.length > 0 ? await db.select().from(staffWorkingHours).where(inArray(staffWorkingHours.userId, candidate.assigneeIds)) : [];
  const settings = await loadSettings(db);
  const parts = candidate.workOrderId ? await db.select().from(partDemands).where(eq(partDemands.workOrderId, candidate.workOrderId)) : [];
  const resourceRows = await db.select({ id: resources.id, name: resources.name }).from(resources);
  const staffRows =
    candidate.assigneeIds.length > 0 ? await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, candidate.assigneeIds)) : [];
  return detectConflicts({
    candidate: {
      id: candidate.id ?? null,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      resourceId: candidate.resourceId ?? null,
      assigneeIds: candidate.assigneeIds,
      workOrderId: candidate.workOrderId ?? null,
    },
    existing: overlapping.map((o) => ({
      id: o.id,
      status: o.status,
      startsAt: o.startsAt.toISOString(),
      endsAt: o.endsAt.toISOString(),
      resourceId: o.resourceId,
      assigneeIds: overlapAssignees.filter((a) => a.appointmentId === o.id).map((a) => a.userId),
    })),
    workingHours: hours.map((h) => ({ userId: h.userId, weekday: h.weekday, startTime: h.startTime, endTime: h.endTime })),
    openingHours: settings.openingHours,
    partDemands: parts.map((p) => ({
      workOrderId: p.workOrderId,
      description: p.description,
      status: p.status,
      expectedAt: p.expectedAt ? p.expectedAt.toISOString() : null,
    })),
    resourceNames: Object.fromEntries(resourceRows.map((r) => [r.id, r.name])),
    staffNames: Object.fromEntries(staffRows.map((s) => [s.id, s.name])),
  });
}

function conflictError(conflicts: SchedulingConflict[]): HttpError {
  return new HttpError(409, API_ERROR_CODES.schedulingConflicts, 'Es gibt Planungskonflikte. Speichern ist nur mit Begründung möglich.', conflicts);
}

function ensureTransition(appointment: AppointmentRow, to: AppointmentStatus, actor: Actor): void {
  const result = canTransitionAppointment({ status: appointment.status, customerId: appointment.customerId }, to, actor);
  if (result.ok) return;
  if (result.error.code === 'NOT_OWN_APPOINTMENT') ensureFound(null);
  if (result.error.code === 'MISSING_PERMISSION' || result.error.code === 'ACCOUNT_INACTIVE' || result.error.code === 'NOT_ALLOWED_FOR_ROLE') {
    throw forbidden(result.error.message);
  }
  throw new HttpError(409, result.error.code.toLowerCase(), result.error.message);
}

export async function appointmentRoutes(app: App): Promise<void> {
  app.get('/appointments', { schema: { querystring: ListQuerySchema, response: { 200: z.array(AppointmentSchema) } } }, async (request) => {
    const actor = requireActor(request);
    const { db } = app.deps;
    const q = request.query;
    const conditions: (SQL | undefined)[] = [];
    if (actor.role === 'customer') {
      conditions.push(actor.customerId ? eq(appointments.customerId, actor.customerId) : sql`false`);
    } else if (!actor.permissions.has('appointments.read')) {
      conditions.push(sql`EXISTS (SELECT 1 FROM ${appointmentAssignees} a WHERE a.appointment_id = ${appointments.id} AND a.user_id = ${actor.userId})`);
    }
    if (q.from) conditions.push(gt(appointments.endsAt, new Date(q.from)));
    if (q.to) conditions.push(lt(appointments.startsAt, new Date(q.to)));
    if (q.status) conditions.push(eq(appointments.status, q.status));
    if (q.resourceId && actor.role !== 'customer') conditions.push(eq(appointments.resourceId, q.resourceId));
    if (q.assigneeId && actor.role !== 'customer') {
      conditions.push(sql`EXISTS (SELECT 1 FROM ${appointmentAssignees} a WHERE a.appointment_id = ${appointments.id} AND a.user_id = ${q.assigneeId})`);
    }
    const rows = await db.select().from(appointments).where(and(...conditions)).orderBy(asc(appointments.startsAt)).limit(500);
    return toAppointmentDtos(db, rows, actor);
  });

  app.post('/appointments', { schema: { body: AppointmentInputSchema, response: { 201: AppointmentSchema } } }, async (request, reply) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'appointments.write'));
    const { db, now: clock } = app.deps;
    const now = clock();
    const body = request.body;
    const row = await db.transaction(async (tx) => {
      if ((await currentOwnerCustomerId(tx, body.vehicleId)) !== body.customerId) {
        throw unprocessable(API_ERROR_CODES.vehicleNotOwnedByCustomer, 'Das Fahrzeug gehört nicht (mehr) zu diesem Kunden.');
      }
      if (body.workOrderId) {
        const [wo] = await tx.select({ customerId: workOrders.customerId }).from(workOrders).where(eq(workOrders.id, body.workOrderId));
        if (!wo || wo.customerId !== body.customerId) throw unprocessable(API_ERROR_CODES.workOrderMismatch, 'Der Auftrag gehört nicht zu diesem Kunden.');
      }
      const conflicts = await findConflicts(tx, { ...body, assigneeIds: body.assigneeIds });
      const reason = body.overrideConflictsReason?.trim() || null;
      if (conflicts.length > 0 && !reason) throw conflictError(conflicts);
      const [created] = await tx
        .insert(appointments)
        .values({
          kind: body.kind,
          status: 'confirmed',
          customerId: body.customerId,
          vehicleId: body.vehicleId,
          workOrderId: body.workOrderId ?? null,
          startsAt: new Date(body.startsAt),
          endsAt: new Date(body.endsAt),
          resourceId: body.resourceId ?? null,
          requestedBy: 'staff',
          customerNote: body.customerNote ?? null,
          internalNote: body.internalNote ?? null,
          conflictOverrideReason: conflicts.length > 0 ? reason : null,
          confirmedAt: now,
          confirmedBy: actor.userId,
          createdBy: actor.userId,
        })
        .returning();
      if (body.assigneeIds.length > 0) {
        await tx.insert(appointmentAssignees).values([...new Set(body.assigneeIds)].map((userId) => ({ appointmentId: created!.id, userId })));
      }
      await audit(tx, auditContextFrom(request), {
        action: 'appointment.created',
        entityType: 'appointment',
        entityId: created!.id,
        data: { conflicts: conflicts.map((c) => c.kind), overrideReason: conflicts.length > 0 ? reason : null, workOrderId: body.workOrderId ?? null },
      });
      const customerUser = await customerUserId(tx, body.customerId);
      if (customerUser) {
        await enqueueNotification(
          tx,
          {
            eventType: 'appointment.confirmed',
            title: 'Termin bestätigt',
            body: 'Die Werkstatt hat einen Termin für Sie eingetragen.',
            recipients: [{ userId: customerUser, targetPath: notificationTargets.appointmentForCustomer(created!.id) }],
            dedupeKey: `appointment.confirmed:${created!.id}:${now.getTime()}`,
          },
          now,
        );
      }
      return created!;
    });
    return reply.code(201).send(await toDto(db, row, actor));
  });

  app.post('/appointments/requests', { schema: { body: AppointmentRequestInputSchema, response: { 201: AppointmentSchema } } }, async (request, reply) => {
    const actor = requireActor(request);
    if (actor.role !== 'customer') throw forbidden('Terminanfragen stellen Kunden; die Werkstatt legt Termine direkt an.');
    const { db, now: clock } = app.deps;
    const now = clock();
    const body = request.body;
    ensure(canViewVehicle(actor, await vehicleAccessInput(db, actor, body.vehicleId)));
    const row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(appointments)
        .values({
          kind: body.kind,
          status: 'requested',
          customerId: actor.customerId!,
          vehicleId: body.vehicleId,
          startsAt: new Date(body.preferredStart),
          endsAt: new Date(body.preferredEnd),
          requestedBy: 'customer',
          customerNote: body.customerNote ?? null,
          createdBy: actor.userId,
        })
        .returning();
      await audit(tx, auditContextFrom(request), { action: 'appointment.requested', entityType: 'appointment', entityId: created!.id });
      await enqueueNotification(
        tx,
        {
          eventType: 'appointment.requested',
          title: 'Neue Terminanfrage',
          body: 'Ein Kunde hat einen Termin angefragt.',
          recipients: (await serviceRecipientIds(tx)).map((userId) => ({ userId, targetPath: notificationTargets.appointmentForService(created!.id) })),
          dedupeKey: `appointment.requested:${created!.id}`,
        },
        now,
      );
      return created!;
    });
    return reply.code(201).send(await toDto(db, row, actor));
  });

  app.post('/appointments/conflicts', { schema: { body: ConflictCheckSchema, response: { 200: z.array(SchedulingConflictSchema) } } }, async (request) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'appointments.write'));
    return findConflicts(app.deps.db, request.body);
  });

  app.get('/appointments/:id', { schema: { params: IdParamsSchema, response: { 200: AppointmentSchema } } }, async (request) => {
    const actor = requireActor(request);
    const { db } = app.deps;
    return toDto(db, await loadVisibleAppointment(db, actor, request.params.id), actor);
  });

  app.post('/appointments/:id/confirm', { schema: { params: IdParamsSchema, body: ConfirmSchema, response: { 200: AppointmentSchema } } }, async (request) => {
    const actor = requireActor(request);
    const { db, now: clock } = app.deps;
    const now = clock();
    const row = await db.transaction(async (tx) => {
      const appt = await loadVisibleAppointment(tx, actor, request.params.id, true);
      ensureTransition(appt, 'confirmed', actor);
      const assignees = await tx.select({ userId: appointmentAssignees.userId }).from(appointmentAssignees).where(eq(appointmentAssignees.appointmentId, appt.id));
      const conflicts = await findConflicts(tx, {
        id: appt.id,
        startsAt: appt.startsAt.toISOString(),
        endsAt: appt.endsAt.toISOString(),
        resourceId: appt.resourceId,
        assigneeIds: assignees.map((a) => a.userId),
        workOrderId: appt.workOrderId,
      });
      const reason = request.body?.overrideConflictsReason?.trim() || null;
      if (conflicts.length > 0 && !reason) throw conflictError(conflicts);
      const [updated] = await tx
        .update(appointments)
        .set({ status: 'confirmed', confirmedAt: now, confirmedBy: actor.userId, conflictOverrideReason: conflicts.length > 0 ? reason : appt.conflictOverrideReason })
        .where(eq(appointments.id, appt.id))
        .returning();
      await audit(tx, auditContextFrom(request), { action: 'appointment.confirmed', entityType: 'appointment', entityId: appt.id, data: { conflicts: conflicts.map((c) => c.kind) } });
      const customerUser = await customerUserId(tx, appt.customerId);
      if (customerUser) {
        await enqueueNotification(
          tx,
          {
            eventType: 'appointment.confirmed',
            title: 'Termin bestätigt',
            body: 'Die Werkstatt hat Ihren Termin bestätigt.',
            recipients: [{ userId: customerUser, targetPath: notificationTargets.appointmentForCustomer(appt.id) }],
            dedupeKey: `appointment.confirmed:${appt.id}:${now.getTime()}`,
          },
          now,
        );
      }
      return updated!;
    });
    return toDto(db, row, actor);
  });

  app.post(
    '/appointments/:id/proposals',
    { schema: { params: IdParamsSchema, body: ProposeAlternativeRequestSchema, response: { 200: AppointmentSchema } } },
    async (request) => {
      const actor = requireActor(request);
      const { db, now: clock } = app.deps;
      const now = clock();
      const row = await db.transaction(async (tx) => {
        const appt = await loadVisibleAppointment(tx, actor, request.params.id, true);
        if (appt.status === 'requested') ensureTransition(appt, 'proposed', actor);
        else ensure(hasPermission(actor, 'appointments.write'));
        const proposals = await tx.select().from(appointmentProposals).where(eq(appointmentProposals.appointmentId, appt.id));
        const result = proposeAlternative(
          { status: appt.status, proposals: proposals.map((p) => ({ id: p.id, startsAt: p.startsAt.toISOString(), endsAt: p.endsAt.toISOString(), status: p.status })) },
          { startsAt: request.body.startsAt, endsAt: request.body.endsAt },
        );
        if (!result.ok) throw new HttpError(409, result.error.code.toLowerCase(), result.error.message);
        if (result.value.supersededProposalIds.length > 0) {
          await tx.update(appointmentProposals).set({ status: 'superseded' }).where(inArray(appointmentProposals.id, result.value.supersededProposalIds));
        }
        await tx.insert(appointmentProposals).values({
          appointmentId: appt.id,
          startsAt: new Date(result.value.newProposal.startsAt),
          endsAt: new Date(result.value.newProposal.endsAt),
          status: 'open',
          message: request.body.message ?? null,
          proposedBy: actor.userId,
        });
        const [updated] = await tx.update(appointments).set({ status: 'proposed' }).where(eq(appointments.id, appt.id)).returning();
        await audit(tx, auditContextFrom(request), { action: 'appointment.proposed', entityType: 'appointment', entityId: appt.id });
        const customerUser = await customerUserId(tx, appt.customerId);
        if (customerUser) {
          await enqueueNotification(
            tx,
            {
              eventType: 'appointment.proposed',
              title: 'Terminvorschlag der Werkstatt',
              body: 'Die Werkstatt schlägt Ihnen einen anderen Termin vor.',
              recipients: [{ userId: customerUser, targetPath: notificationTargets.appointmentForCustomer(appt.id) }],
              dedupeKey: `appointment.proposed:${appt.id}:${now.getTime()}`,
            },
            now,
          );
        }
        return updated!;
      });
      return toDto(db, row, actor);
    },
  );

  const ProposalParamsSchema = z.object({ id: z.string().uuid(), proposalId: z.string().uuid() });

  app.post('/appointments/:id/proposals/:proposalId/accept', { schema: { params: ProposalParamsSchema, response: { 200: AppointmentSchema } } }, async (request) => {
    const actor = requireActor(request);
    const { db, now: clock } = app.deps;
    const now = clock();
    const row = await db.transaction(async (tx) => {
      const appt = await loadVisibleAppointment(tx, actor, request.params.id, true);
      ensureTransition(appt, 'confirmed', actor);
      const proposals = await tx.select().from(appointmentProposals).where(eq(appointmentProposals.appointmentId, appt.id));
      const result = acceptProposal(
        { status: appt.status, proposals: proposals.map((p) => ({ id: p.id, startsAt: p.startsAt.toISOString(), endsAt: p.endsAt.toISOString(), status: p.status })) },
        request.params.proposalId,
        now,
      );
      if (!result.ok) throw new HttpError(409, result.error.code.toLowerCase(), result.error.message);
      await tx.update(appointmentProposals).set({ status: 'accepted', respondedAt: now }).where(eq(appointmentProposals.id, result.value.acceptedProposalId));
      if (result.value.supersededProposalIds.length > 0) {
        await tx.update(appointmentProposals).set({ status: 'superseded' }).where(inArray(appointmentProposals.id, result.value.supersededProposalIds));
      }
      const [updated] = await tx
        .update(appointments)
        .set({ status: 'confirmed', startsAt: new Date(result.value.startsAt), endsAt: new Date(result.value.endsAt), confirmedAt: now, confirmedBy: actor.userId })
        .where(eq(appointments.id, appt.id))
        .returning();
      await audit(tx, auditContextFrom(request), { action: 'appointment.proposal_accepted', entityType: 'appointment', entityId: appt.id, data: { proposalId: request.params.proposalId } });
      return updated!;
    });
    return toDto(db, row, actor);
  });

  app.post(
    '/appointments/:id/proposals/:proposalId/decline',
    { schema: { params: ProposalParamsSchema, body: DeclineSchema, response: { 200: AppointmentSchema } } },
    async (request) => {
      const actor = requireActor(request);
      const { db, now: clock } = app.deps;
      const now = clock();
      const cancel = request.body?.cancel ?? false;
      const row = await db.transaction(async (tx) => {
        const appt = await loadVisibleAppointment(tx, actor, request.params.id, true);
        ensureTransition(appt, cancel ? 'cancelled' : 'requested', actor);
        const proposals = await tx.select().from(appointmentProposals).where(eq(appointmentProposals.appointmentId, appt.id));
        const result = declineProposal(
          { status: appt.status, proposals: proposals.map((p) => ({ id: p.id, startsAt: p.startsAt.toISOString(), endsAt: p.endsAt.toISOString(), status: p.status })) },
          request.params.proposalId,
          { cancel },
        );
        if (!result.ok) throw new HttpError(409, result.error.code.toLowerCase(), result.error.message);
        await tx.update(appointmentProposals).set({ status: 'declined', respondedAt: now }).where(eq(appointmentProposals.id, result.value.declinedProposalId));
        const [updated] = await tx
          .update(appointments)
          .set(
            result.value.status === 'cancelled'
              ? { status: 'cancelled', cancelledAt: now, cancelledBy: actor.userId, cancelReason: 'Vorschlag abgelehnt' }
              : { status: 'requested' },
          )
          .where(eq(appointments.id, appt.id))
          .returning();
        await audit(tx, auditContextFrom(request), { action: 'appointment.proposal_declined', entityType: 'appointment', entityId: appt.id, data: { proposalId: request.params.proposalId, cancel } });
        await enqueueNotification(
          tx,
          {
            eventType: 'appointment.requested',
            title: 'Terminvorschlag abgelehnt',
            body: 'Ein Kunde hat einen Terminvorschlag abgelehnt.',
            recipients: (await serviceRecipientIds(tx)).map((userId) => ({ userId, targetPath: notificationTargets.appointmentForService(appt.id) })),
            dedupeKey: `appointment.declined:${result.value.declinedProposalId}`,
          },
          now,
        );
        return updated!;
      });
      return toDto(db, row, actor);
    },
  );

  app.post('/appointments/:id/cancel', { schema: { params: IdParamsSchema, body: CancelRequestSchema, response: { 200: AppointmentSchema } } }, async (request) => {
    const actor = requireActor(request);
    const { db, now: clock } = app.deps;
    const now = clock();
    const row = await db.transaction(async (tx) => {
      const appt = await loadVisibleAppointment(tx, actor, request.params.id, true);
      ensureTransition(appt, 'cancelled', actor);
      const [updated] = await tx
        .update(appointments)
        .set({ status: 'cancelled', cancelledAt: now, cancelledBy: actor.userId, cancelReason: request.body.reason })
        .where(eq(appointments.id, appt.id))
        .returning();
      await audit(tx, auditContextFrom(request), { action: 'appointment.cancelled', entityType: 'appointment', entityId: appt.id });
      return updated!;
    });
    return toDto(db, row, actor);
  });

  app.get('/resources', { schema: { response: { 200: z.array(ResourceSchema) } } }, async (request) => {
    const actor = requireActor(request);
    if (actor.role === 'customer') throw forbidden();
    const rows = await app.deps.db.select().from(resources).orderBy(asc(resources.name));
    return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, active: r.active }));
  });
}
