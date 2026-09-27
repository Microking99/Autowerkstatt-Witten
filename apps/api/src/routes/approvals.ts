/**
 * Freigaben (R-FRG): Entwurf, Senden, neue Version nach Änderung, Zurückziehen und die
 * Kundenentscheidung, gebunden an Version und Inhalts-Hash. Mitarbeiter können nie im Namen
 * des Kunden entscheiden. Ein "Ja" im Chat ist keine Freigabe.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { ApprovalDecisionRequestSchema, ApprovalDraftInputSchema, ApprovalRequestSchema, type ApprovalDraftInput, API_ERROR_CODES } from '@werkstatt/contracts';
import {
  applyDecision,
  canViewApprovalRequest,
  createInitialVersion,
  hasPermission,
  requestStatusAfterDecision,
  reviseApproval,
  sendApproval,
  validateDecision,
  withdrawApproval,
  type Actor,
  type ApprovalContentInput,
} from '@werkstatt/domain';
import type { DbOrTx } from '../db/index';
import { approvalDecisions, approvalRequests, approvalVersions, documentVersions, documents, findings, photos, workItems, workOrders } from '../db/schema/index';
import { audit, auditContextFrom, type AuditContext } from '../lib/audit';
import { HttpError, conflict, notFound, unprocessable } from '../lib/errors';
import { IdParamsSchema, ensure, ensureFound, requireActor } from '../lib/http';
import { assignedMechanicIds, enqueueNotification, notificationTargets, serviceRecipientIds } from '../notifications/outbox';
import { loadVisibleWorkOrder, workOrderAccessInput } from '../services/access';
import { syncItemsWithVersion, toApprovalDtos, versionValues, type ApprovalRequestRow, type ApprovalVersionRow } from '../services/approvals';
import { customerUserId } from '../services/recipients';
import { reopenIfNeeded, type PendingEvents } from '../services/workOrderOps';
import type { App } from '../types';

function contentFrom(input: ApprovalDraftInput): ApprovalContentInput {
  return {
    summaryCustomer: input.summaryCustomer,
    lines: input.lines,
    scheduleChange: input.scheduleChange ?? null,
    newReadyAt: input.newReadyAt ?? null,
    photoIds: input.photoIds,
    documentVersionId: input.documentVersionId ?? null,
  };
}

/** Fotos und Dokumentversion müssen zum Auftrag gehören. */
async function validateReferences(tx: DbOrTx, workOrderId: string, input: ApprovalDraftInput): Promise<void> {
  const photoIds = [...new Set(input.photoIds)];
  if (photoIds.length > 0) {
    const rows = await tx.select({ id: photos.id }).from(photos).where(and(inArray(photos.id, photoIds), eq(photos.workOrderId, workOrderId)));
    if (rows.length !== photoIds.length) throw unprocessable(API_ERROR_CODES.invalidPhotos, 'Mindestens ein Foto gehört nicht zu diesem Auftrag.');
  }
  if (input.documentVersionId) {
    const [dv] = await tx
      .select({ workOrderId: documents.workOrderId })
      .from(documentVersions)
      .innerJoin(documents, eq(documents.id, documentVersions.documentId))
      .where(eq(documentVersions.id, input.documentVersionId));
    if (!dv || dv.workOrderId !== workOrderId) throw unprocessable(API_ERROR_CODES.invalidDocument, 'Das Dokument gehört nicht zu diesem Auftrag.');
  }
  if (input.findingId) {
    const [f] = await tx.select({ workOrderId: findings.workOrderId }).from(findings).where(eq(findings.id, input.findingId));
    if (!f || f.workOrderId !== workOrderId) throw unprocessable(API_ERROR_CODES.invalidFinding, 'Die Feststellung gehört nicht zu diesem Auftrag.');
  }
}

/** Fotos einer gesendeten Version muss der Kunde sehen können (R-FRG-2). */
async function shareVersionPhotos(tx: DbOrTx, version: ApprovalVersionRow, ctx: AuditContext, workOrderId: string): Promise<void> {
  if (version.photoIds.length === 0) return;
  const changed = await tx
    .update(photos)
    .set({ visibility: 'customer' })
    .where(and(inArray(photos.id, version.photoIds), eq(photos.visibility, 'internal')))
    .returning({ id: photos.id });
  for (const p of changed) {
    await audit(tx, ctx, { action: 'photo.visibility_changed', entityType: 'photo', entityId: p.id, data: { workOrderId, visibility: 'customer', reason: 'approval_sent' } });
  }
}

async function notifyCustomerOfVersion(tx: DbOrTx, request: ApprovalRequestRow, customerId: string, versionId: string, isNewVersion: boolean, now: Date): Promise<void> {
  const userId = await customerUserId(tx, customerId);
  if (!userId) return;
  await enqueueNotification(
    tx,
    {
      eventType: 'approval.requested',
      title: isNewVersion ? 'Geänderte Freigabeanfrage' : 'Neue Freigabeanfrage',
      body: isNewVersion
        ? 'Die Werkstatt hat eine Freigabeanfrage geändert. Bitte prüfen und neu entscheiden.'
        : 'Die Werkstatt bittet um Ihre Entscheidung zu Ihrem Auftrag.',
      recipients: [{ userId, targetPath: notificationTargets.approvalRequestedForCustomer(request.workOrderId, request.id) }],
      dedupeKey: `approval.requested:${versionId}`,
    },
    now,
  );
}

async function loadRequest(tx: DbOrTx, id: string, forUpdate = false): Promise<ApprovalRequestRow> {
  const q = tx.select().from(approvalRequests).where(eq(approvalRequests.id, id));
  const [row] = forUpdate ? await q.for('update') : await q;
  return ensureFound(row);
}

async function currentVersionOf(tx: DbOrTx, request: ApprovalRequestRow): Promise<ApprovalVersionRow> {
  const [v] = await tx.select().from(approvalVersions).where(eq(approvalVersions.id, request.currentVersionId!));
  return v!;
}

function versionState(v: ApprovalVersionRow) {
  return { id: v.id, versionNo: v.versionNo, contentHash: v.contentHash, sentAt: v.sentAt ? v.sentAt.toISOString() : null, supersededAt: v.supersededAt ? v.supersededAt.toISOString() : null };
}

/** Anfrage sehen (Kunde: nicht Entwurf; Mechaniker: nie, Preise). */
async function ensureVisible(tx: DbOrTx, actor: Actor, request: ApprovalRequestRow): Promise<void> {
  const [wo] = await tx.select().from(workOrders).where(eq(workOrders.id, request.workOrderId));
  ensure(canViewApprovalRequest(actor, { workOrder: await workOrderAccessInput(tx, wo!), status: request.status }));
}

export async function approvalRoutes(app: App): Promise<void> {
  const publish = (events: PendingEvents) => events.forEach((e) => app.deps.realtime.publish(e));

  const respond = async (db: DbOrTx, actor: Actor, id: string) => {
    const request = await loadRequest(db, id);
    const [dto] = await toApprovalDtos(db, [request], actor);
    return dto!;
  };

  app.get('/work-orders/:id/approvals', { schema: { params: IdParamsSchema, response: { 200: z.array(ApprovalRequestSchema) } } }, async (request) => {
    const actor = requireActor(request);
    const { db } = app.deps;
    const { access } = await loadVisibleWorkOrder(db, actor, request.params.id);
    const rows = await db.select().from(approvalRequests).where(eq(approvalRequests.workOrderId, request.params.id)).orderBy(asc(approvalRequests.createdAt));
    // Sichtbarkeit je Anfrage (Kunden keine Entwürfe; Mechaniker gar nicht)
    ensure(canViewApprovalRequest(actor, { workOrder: access, status: 'pending_customer' }));
    const visible = rows.filter((r) => canViewApprovalRequest(actor, { workOrder: access, status: r.status }).allowed);
    return toApprovalDtos(db, visible, actor);
  });

  app.post(
    '/work-orders/:id/approvals',
    { schema: { params: IdParamsSchema, body: ApprovalDraftInputSchema, response: { 201: ApprovalRequestSchema } } },
    async (request, reply) => {
      const actor = requireActor(request);
      ensure(hasPermission(actor, 'approvals.request'));
      const { db, now: clock } = app.deps;
      const now = clock();
      const body = request.body;
      const id = await db.transaction(async (tx) => {
        const { wo } = await loadVisibleWorkOrder(tx, actor, request.params.id);
        if (!['draft', 'open', 'in_progress', 'work_completed'].includes(wo.status)) {
          throw conflict(API_ERROR_CODES.workOrderClosed, 'Zu einem abgeschlossenen Auftrag können keine Freigaben angefragt werden.');
        }
        await validateReferences(tx, wo.id, body);
        let version;
        try {
          version = createInitialVersion(contentFrom(body), now);
        } catch (err) {
          throw unprocessable(API_ERROR_CODES.invalidContent, err instanceof Error ? err.message : 'Ungültiger Inhalt.');
        }
        const [created] = await tx
          .insert(approvalRequests)
          .values({ workOrderId: wo.id, kind: body.kind, title: body.title, status: 'draft', findingId: body.findingId ?? null, createdBy: actor.userId })
          .returning();
        const [v] = await tx.insert(approvalVersions).values(versionValues(created!.id, version, actor.userId)).returning();
        await tx.update(approvalRequests).set({ currentVersionId: v!.id }).where(eq(approvalRequests.id, created!.id));
        if (body.findingId) await tx.update(findings).set({ status: 'converted' }).where(eq(findings.id, body.findingId));
        await audit(tx, auditContextFrom(request), {
          action: 'approval.created',
          entityType: 'approval_request',
          entityId: created!.id,
          data: { workOrderId: wo.id, versionNo: 1, contentHash: v!.contentHash },
        });
        return created!.id;
      });
      return reply.code(201).send(await respond(db, actor, id));
    },
  );

  app.get('/approvals/:id', { schema: { params: IdParamsSchema, response: { 200: ApprovalRequestSchema } } }, async (request) => {
    const actor = requireActor(request);
    const { db } = app.deps;
    const row = await loadRequest(db, request.params.id);
    await ensureVisible(db, actor, row);
    return respond(db, actor, row.id);
  });

  app.put('/approvals/:id', { schema: { params: IdParamsSchema, body: ApprovalDraftInputSchema, response: { 200: ApprovalRequestSchema } } }, async (request) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'approvals.request'));
    const { db, now: clock } = app.deps;
    const now = clock();
    const body = request.body;
    const events: PendingEvents = [];
    const id = await db.transaction(async (tx) => {
      const row = await loadRequest(tx, request.params.id, true);
      const { wo } = await loadVisibleWorkOrder(tx, actor, row.workOrderId);
      await validateReferences(tx, wo.id, body);
      const current = await currentVersionOf(tx, row);
      let outcome;
      try {
        outcome = reviseApproval({ id: row.id, status: row.status }, versionState(current), contentFrom(body), now);
      } catch (err) {
        throw unprocessable(API_ERROR_CODES.invalidContent, err instanceof Error ? err.message : 'Ungültiger Inhalt.');
      }
      if (!outcome.ok) throw new HttpError(409, outcome.error.code.toLowerCase(), outcome.error.message);
      const result = outcome.value;
      const ctx = auditContextFrom(request);
      if (row.title !== body.title) await tx.update(approvalRequests).set({ title: body.title }).where(eq(approvalRequests.id, row.id));
      if (result.kind === 'draft_updated') {
        const values = versionValues(row.id, result.version, actor.userId);
        await tx.update(approvalVersions).set({ ...values, sentAt: null }).where(eq(approvalVersions.id, current.id));
        await audit(tx, ctx, { action: 'approval.revised', entityType: 'approval_request', entityId: row.id, data: { workOrderId: wo.id, draft: true, contentHash: result.version.contentHash } });
      } else if (result.kind === 'new_version') {
        await tx.update(approvalVersions).set({ supersededAt: new Date(result.supersede.supersededAt) }).where(eq(approvalVersions.id, result.supersede.versionId));
        const [v] = await tx.insert(approvalVersions).values(versionValues(row.id, result.newVersion, actor.userId)).returning();
        const [updated] = await tx
          .update(approvalRequests)
          .set({ currentVersionId: v!.id, status: result.requestStatus })
          .where(eq(approvalRequests.id, row.id))
          .returning();
        await syncItemsWithVersion(tx, { request: updated!, lines: v!.items, newVersion: true, now });
        await shareVersionPhotos(tx, v!, ctx, wo.id);
        await audit(tx, ctx, {
          action: 'approval.version_sent',
          entityType: 'approval_request',
          entityId: row.id,
          data: { workOrderId: wo.id, versionNo: v!.versionNo, contentHash: v!.contentHash, supersededVersionId: result.supersede.versionId, totalGrossCents: v!.totalGrossCents },
        });
        await notifyCustomerOfVersion(tx, updated!, wo.customerId, v!.id, true, now);
        events.push({ type: 'approval.updated', workOrderId: wo.id, approvalRequestId: row.id });
      }
      return row.id;
    });
    publish(events);
    return respond(db, actor, id);
  });

  app.post('/approvals/:id/send', { schema: { params: IdParamsSchema, response: { 200: ApprovalRequestSchema } } }, async (request) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'approvals.request'));
    const { db, now: clock } = app.deps;
    const now = clock();
    const events: PendingEvents = [];
    const id = await db.transaction(async (tx) => {
      const row = await loadRequest(tx, request.params.id, true);
      const { wo } = await loadVisibleWorkOrder(tx, actor, row.workOrderId);
      const current = await currentVersionOf(tx, row);
      const result = sendApproval({ id: row.id, status: row.status }, versionState(current), now);
      if (!result.ok) throw new HttpError(409, result.error.code.toLowerCase(), result.error.message);
      const [v] = await tx.update(approvalVersions).set({ sentAt: new Date(result.value.sentAt) }).where(eq(approvalVersions.id, current.id)).returning();
      const [updated] = await tx.update(approvalRequests).set({ status: result.value.requestStatus }).where(eq(approvalRequests.id, row.id)).returning();
      await syncItemsWithVersion(tx, { request: updated!, lines: v!.items, newVersion: false, now });
      const ctx = auditContextFrom(request);
      await shareVersionPhotos(tx, v!, ctx, wo.id);
      await audit(tx, ctx, {
        action: 'approval.sent',
        entityType: 'approval_request',
        entityId: row.id,
        data: { workOrderId: wo.id, versionNo: v!.versionNo, contentHash: v!.contentHash, totalGrossCents: v!.totalGrossCents },
      });
      await notifyCustomerOfVersion(tx, updated!, wo.customerId, v!.id, false, now);
      events.push({ type: 'approval.updated', workOrderId: wo.id, approvalRequestId: row.id });
      return row.id;
    });
    publish(events);
    return respond(db, actor, id);
  });

  app.post('/approvals/:id/withdraw', { schema: { params: IdParamsSchema, response: { 200: ApprovalRequestSchema } } }, async (request) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'approvals.request'));
    const { db } = app.deps;
    const events: PendingEvents = [];
    const id = await db.transaction(async (tx) => {
      const row = await loadRequest(tx, request.params.id, true);
      const { wo } = await loadVisibleWorkOrder(tx, actor, row.workOrderId);
      const items = await tx.select().from(workItems).where(eq(workItems.approvalRequestId, row.id));
      const result = withdrawApproval(
        { id: row.id, status: row.status },
        items.map((i) => ({ id: i.id, approvalRequestId: i.approvalRequestId, authorization: i.authorization })),
      );
      if (!result.ok) throw new HttpError(409, result.error.code.toLowerCase(), result.error.message);
      await tx.update(approvalRequests).set({ status: 'withdrawn' }).where(eq(approvalRequests.id, row.id));
      for (const c of result.value.changes) await tx.update(workItems).set({ authorization: c.to }).where(eq(workItems.id, c.itemId));
      await audit(tx, auditContextFrom(request), { action: 'approval.withdrawn', entityType: 'approval_request', entityId: row.id, data: { workOrderId: wo.id } });
      events.push({ type: 'approval.updated', workOrderId: wo.id, approvalRequestId: row.id });
      return row.id;
    });
    publish(events);
    return respond(db, actor, id);
  });

  app.post(
    '/approvals/:id/decision',
    { schema: { params: IdParamsSchema, body: ApprovalDecisionRequestSchema, response: { 200: ApprovalRequestSchema } } },
    async (request) => {
      const actor = requireActor(request);
      const { db, now: clock } = app.deps;
      const now = clock();
      const body = request.body;
      const events: PendingEvents = [];
      const id = await db.transaction(async (tx) => {
        const row = await loadRequest(tx, request.params.id, true);
        const [wo] = await tx.select().from(workOrders).where(eq(workOrders.id, row.workOrderId));
        const access = await workOrderAccessInput(tx, wo!);
        // Kunden sehen fremde Anfragen und Entwürfe nicht (404)
        const view = canViewApprovalRequest(actor, { workOrder: access, status: row.status });
        if (!view.allowed && view.notFound) throw notFound();
        const current = await currentVersionOf(tx, row);
        const [existingDecision] = await tx.select({ id: approvalDecisions.id }).from(approvalDecisions).where(eq(approvalDecisions.versionId, current.id));
        const check = validateDecision({
          request: { id: row.id, status: row.status, currentVersionId: row.currentVersionId! },
          currentVersion: { id: current.id, contentHash: current.contentHash, sentAt: current.sentAt?.toISOString() ?? null, supersededAt: current.supersededAt?.toISOString() ?? null },
          submittedVersionId: body.versionId,
          submittedHash: body.contentHash,
          actor,
          workOrderCustomerId: wo!.customerId,
          alreadyDecided: !!existingDecision,
        });
        if (!check.ok) {
          if (check.code === 'NOT_CUSTOMER') {
            if (check.notFound) throw notFound();
            throw new HttpError(403, API_ERROR_CODES.notCustomer, check.message);
          }
          throw new HttpError(409, check.code.toLowerCase(), check.message);
        }
        const ua = request.headers['user-agent'];
        const inserted = await tx
          .insert(approvalDecisions)
          .values({
            versionId: check.versionId,
            decision: body.decision,
            decidedByUserId: actor.userId,
            customerId: wo!.customerId,
            decidedAt: now,
            contentHash: check.contentHash,
            channel: body.channel,
            comment: body.comment ?? null,
            ip: request.ip,
            userAgent: typeof ua === 'string' ? ua.slice(0, 300) : null,
          })
          .onConflictDoNothing()
          .returning({ id: approvalDecisions.id });
        if (!inserted[0]) throw new HttpError(409, API_ERROR_CODES.alreadyDecided, 'Zu dieser Fassung liegt bereits eine Entscheidung vor.');
        await tx.update(approvalRequests).set({ status: requestStatusAfterDecision(body.decision) }).where(eq(approvalRequests.id, row.id));
        const items = await tx.select().from(workItems).where(eq(workItems.workOrderId, row.workOrderId));
        const { changes } = applyDecision(
          items.map((i) => ({ id: i.id, approvalRequestId: i.approvalRequestId, authorization: i.authorization, approvedVersionId: i.approvedVersionId })),
          row.id,
          body.decision,
          check.versionId,
        );
        for (const c of changes) {
          await tx
            .update(workItems)
            .set({ authorization: c.to, approvedVersionId: c.to === 'approved' ? check.versionId : null })
            .where(eq(workItems.id, c.itemId));
        }
        const ctx = auditContextFrom(request);
        await audit(tx, ctx, {
          action: 'approval.decided',
          entityType: 'approval_request',
          entityId: row.id,
          data: {
            workOrderId: row.workOrderId,
            decision: body.decision,
            versionId: check.versionId,
            versionNo: current.versionNo,
            contentHash: check.contentHash,
            totalGrossCents: current.totalGrossCents,
            lines: current.items.map((l) => l.title),
            channel: body.channel,
            itemIds: changes.map((c) => c.itemId),
          },
        });
        if (body.decision === 'approved') await reopenIfNeeded(tx, row.workOrderId, ctx, events);
        const service = await serviceRecipientIds(tx);
        const mechanics = await assignedMechanicIds(tx, row.workOrderId);
        await enqueueNotification(
          tx,
          {
            eventType: 'approval.decided',
            title: body.decision === 'approved' ? 'Kunde hat freigegeben' : 'Kunde hat abgelehnt',
            body: `Entscheidung zu Auftrag ${wo!.orderNumber} eingegangen.`,
            recipients: [
              ...service.map((userId) => ({ userId, targetPath: notificationTargets.approvalDecidedForService(row.workOrderId, row.id) })),
              ...mechanics.map((userId) => ({ userId, targetPath: notificationTargets.approvalDecidedForMechanic(row.workOrderId) })),
            ],
            dedupeKey: `approval.decided:${check.versionId}`,
          },
          now,
        );
        events.push({ type: 'approval.updated', workOrderId: row.workOrderId, approvalRequestId: row.id });
        return row.id;
      });
      publish(events);
      return respond(db, actor, id);
    },
  );
}
