/**
 * Dokumente (R-DOK): Anlage (intern), Versionen, Veröffentlichen nur mit Kundenbezug,
 * rechtegeprüfter Download. Interne Dokumente werden nie automatisch freigegeben.
 */
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { API_PREFIX, CreateDocumentRequestSchema, DocumentSchema, IdSchema, type DocumentDto } from '@werkstatt/contracts';
import { canViewDocument, hasPermission, type Actor } from '@werkstatt/domain';
import type { DbOrTx } from '../db/index';
import { customers, documentVersions, documents, files, vehicles, workOrders } from '../db/schema/index';
import { audit, auditContextFrom } from '../lib/audit';
import { unprocessable } from '../lib/errors';
import { IdParamsSchema, ensure, ensureFound, requireActor } from '../lib/http';
import { contentDisposition } from '../storage/fileSignature';
import { loadAttachableFile, toFileRef } from './files';
import { activeAssignmentScope } from '../services/access';
import type { App } from '../types';

type DocumentRow = typeof documents.$inferSelect;

const ListQuerySchema = z.object({
  workOrderId: IdSchema.optional(),
  vehicleId: IdSchema.optional(),
  customerId: IdSchema.optional(),
  kind: z.enum(['offer', 'invoice', 'intake_protocol', 'report', 'other']).optional(),
});

const AddVersionSchema = z.object({ fileId: IdSchema, note: z.string().trim().max(500).nullable().optional() });

export async function toDocumentDtos(db: DbOrTx, rows: DocumentRow[]): Promise<DocumentDto[]> {
  if (rows.length === 0) return [];
  const versions = await db
    .select({ v: documentVersions, f: files })
    .from(documentVersions)
    .innerJoin(files, eq(files.id, documentVersions.fileId))
    .where(inArray(documentVersions.documentId, rows.map((r) => r.id)))
    .orderBy(asc(documentVersions.versionNo));
  return rows.map((d) => {
    const own = versions.filter((x) => x.v.documentId === d.id);
    const current = own.find((x) => x.v.id === d.currentVersionId) ?? own[own.length - 1]!;
    return {
      id: d.id,
      kind: d.kind,
      title: d.title,
      customerId: d.customerId,
      vehicleId: d.vehicleId,
      workOrderId: d.workOrderId,
      visibility: d.visibility,
      publishedAt: d.publishedAt ? d.publishedAt.toISOString() : null,
      currentVersion: { id: current.v.id, versionNo: current.v.versionNo, file: toFileRef(current.f), createdAt: current.v.createdAt.toISOString() },
      versionCount: own.length,
      downloadUrl: `${API_PREFIX}/documents/${d.id}/download`,
      createdAt: d.createdAt.toISOString(),
    };
  });
}

type AssignmentScope = { workOrderIds: Set<string>; vehicleIds: Set<string> } | null;

function accessInput(d: DocumentRow, scope: AssignmentScope = null) {
  return {
    customerId: d.customerId,
    visibility: d.visibility,
    publishedAt: d.publishedAt ? d.publishedAt.toISOString() : null,
    kind: d.kind,
    // Mechaniker: nur Dokumente aktiver, zugewiesener Aufträge bzw. deren Fahrzeuge
    actorAssignedViaActiveWorkOrder: scope
      ? (d.workOrderId !== null && scope.workOrderIds.has(d.workOrderId)) || (d.vehicleId !== null && scope.vehicleIds.has(d.vehicleId))
      : undefined,
  };
}

/** Zuweisungsbereich nur für Mechaniker (andere Rollen brauchen ihn nicht). */
async function scopeFor(db: DbOrTx, actor: Actor): Promise<AssignmentScope> {
  return actor.role === 'mechanic' ? activeAssignmentScope(db, actor.userId) : null;
}

async function loadVisibleDocument(db: DbOrTx, actor: Actor, id: string): Promise<DocumentRow> {
  const [row] = await db.select().from(documents).where(and(eq(documents.id, id), isNull(documents.deletedAt)));
  ensureFound(row);
  ensure(canViewDocument(actor, accessInput(row!, await scopeFor(db, actor))));
  return row!;
}

/** Legt ein Dokument mit Version 1 an (auch für Rechnungs-PDFs genutzt). */
export async function createDocument(
  tx: DbOrTx,
  input: { kind: DocumentRow['kind']; title: string; fileId: string; customerId: string | null; vehicleId: string | null; workOrderId: string | null; createdBy: string },
): Promise<DocumentRow> {
  const [doc] = await tx
    .insert(documents)
    .values({
      kind: input.kind,
      title: input.title,
      customerId: input.customerId,
      vehicleId: input.vehicleId,
      workOrderId: input.workOrderId,
      visibility: 'internal',
      createdBy: input.createdBy,
    })
    .returning();
  const [v] = await tx.insert(documentVersions).values({ documentId: doc!.id, versionNo: 1, fileId: input.fileId, createdBy: input.createdBy }).returning();
  const [updated] = await tx.update(documents).set({ currentVersionId: v!.id }).where(eq(documents.id, doc!.id)).returning();
  return updated!;
}

export async function documentRoutes(app: App): Promise<void> {
  app.get('/documents', { schema: { querystring: ListQuerySchema, response: { 200: z.array(DocumentSchema) } } }, async (request) => {
    const actor = requireActor(request);
    const { db } = app.deps;
    const q = request.query;
    const conditions: (SQL | undefined)[] = [isNull(documents.deletedAt)];
    if (actor.role === 'customer') {
      // nur veröffentlichte Kundendokumente des eigenen Kundendatensatzes
      if (!actor.customerId) return [];
      conditions.push(eq(documents.customerId, actor.customerId), eq(documents.visibility, 'customer'), sql`${documents.publishedAt} IS NOT NULL`);
    } else if (actor.role === 'mechanic') {
      conditions.push(sql`${documents.kind} NOT IN ('offer', 'invoice')`);
    }
    if (q.workOrderId) conditions.push(eq(documents.workOrderId, q.workOrderId));
    if (q.vehicleId) conditions.push(eq(documents.vehicleId, q.vehicleId));
    if (q.customerId) conditions.push(eq(documents.customerId, q.customerId));
    if (q.kind) conditions.push(eq(documents.kind, q.kind));
    const rows = await db.select().from(documents).where(and(...conditions)).orderBy(desc(documents.createdAt)).limit(500);
    // Objektregel zusätzlich je Dokument (Geschäftslogik)
    const scope = await scopeFor(db, actor);
    return toDocumentDtos(
      db,
      rows.filter((d) => canViewDocument(actor, accessInput(d, scope)).allowed),
    );
  });

  app.post('/documents', { schema: { body: CreateDocumentRequestSchema, response: { 201: DocumentSchema } } }, async (request, reply) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'documents.write'));
    const { db } = app.deps;
    const body = request.body;
    const doc = await db.transaction(async (tx) => {
      const file = await loadAttachableFile(tx, actor, body.fileId);
      let customerId = body.customerId ?? null;
      let vehicleId = body.vehicleId ?? null;
      if (body.workOrderId) {
        const [wo] = await tx.select().from(workOrders).where(eq(workOrders.id, body.workOrderId));
        if (!wo) throw unprocessable('invalid_work_order', 'Auftrag nicht gefunden.');
        if (customerId && customerId !== wo.customerId) throw unprocessable('customer_mismatch', 'Kunde und Auftrag passen nicht zusammen.');
        // Dokumente eines Auftrags gehören dem Auftraggeber (bleibt nach Halterwechsel beim Kunden)
        customerId = wo.customerId;
        vehicleId = vehicleId ?? wo.vehicleId;
      }
      if (customerId) {
        const [c] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId));
        if (!c) throw unprocessable('invalid_customer', 'Kunde nicht gefunden.');
      }
      if (vehicleId) {
        const [v] = await tx.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, vehicleId));
        if (!v) throw unprocessable('invalid_vehicle', 'Fahrzeug nicht gefunden.');
      }
      const created = await createDocument(tx, {
        kind: body.kind,
        title: body.title,
        fileId: file.id,
        customerId,
        vehicleId,
        workOrderId: body.workOrderId ?? null,
        createdBy: actor.userId,
      });
      await audit(tx, auditContextFrom(request), { action: 'document.created', entityType: 'document', entityId: created.id, data: { workOrderId: created.workOrderId, kind: created.kind } });
      return created;
    });
    const [dto] = await toDocumentDtos(db, [doc]);
    return reply.code(201).send(dto!);
  });

  app.post('/documents/:id/versions', { schema: { params: IdParamsSchema, body: AddVersionSchema, response: { 201: DocumentSchema } } }, async (request, reply) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'documents.write'));
    const { db } = app.deps;
    const doc = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(documents).where(and(eq(documents.id, request.params.id), isNull(documents.deletedAt))).for('update');
      ensureFound(current);
      ensure(canViewDocument(actor, accessInput(current!, await scopeFor(tx, actor))));
      const file = await loadAttachableFile(tx, actor, request.body.fileId);
      const [max] = await tx.select({ n: sql<number>`coalesce(max(${documentVersions.versionNo}), 0)::int` }).from(documentVersions).where(eq(documentVersions.documentId, current!.id));
      const [v] = await tx
        .insert(documentVersions)
        .values({ documentId: current!.id, versionNo: (max?.n ?? 0) + 1, fileId: file.id, note: request.body.note ?? null, createdBy: actor.userId })
        .returning();
      const [updated] = await tx.update(documents).set({ currentVersionId: v!.id }).where(eq(documents.id, current!.id)).returning();
      await audit(tx, auditContextFrom(request), { action: 'document.version_added', entityType: 'document', entityId: current!.id, data: { workOrderId: current!.workOrderId, versionNo: v!.versionNo } });
      return updated!;
    });
    const [dto] = await toDocumentDtos(db, [doc]);
    return reply.code(201).send(dto!);
  });

  const setPublication = async (request: Parameters<typeof auditContextFrom>[0] & { params: { id: string } }, publish: boolean) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'documents.publish'));
    const { db, now } = app.deps;
    const doc = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(documents).where(and(eq(documents.id, request.params.id), isNull(documents.deletedAt))).for('update');
      ensureFound(current);
      if (publish && !current!.customerId) {
        throw unprocessable('customer_required', 'Nur Dokumente mit Kundenbezug können veröffentlicht werden.');
      }
      const [updated] = await tx
        .update(documents)
        .set(publish ? { visibility: 'customer', publishedAt: now(), publishedBy: actor.userId } : { visibility: 'internal', publishedAt: null, publishedBy: null })
        .where(eq(documents.id, current!.id))
        .returning();
      await audit(tx, auditContextFrom(request), {
        action: publish ? 'document.published' : 'document.unpublished',
        entityType: 'document',
        entityId: current!.id,
        data: { workOrderId: current!.workOrderId, customerId: current!.customerId },
      });
      return updated!;
    });
    const [dto] = await toDocumentDtos(db, [doc]);
    return dto!;
  };

  app.post('/documents/:id/publish', { schema: { params: IdParamsSchema, response: { 200: DocumentSchema } } }, (request) => setPublication(request, true));
  app.post('/documents/:id/unpublish', { schema: { params: IdParamsSchema, response: { 200: DocumentSchema } } }, (request) => setPublication(request, false));

  app.get('/documents/:id/download', { schema: { params: IdParamsSchema } }, async (request, reply) => {
    const actor = requireActor(request);
    const { db, storage } = app.deps;
    const doc = await loadVisibleDocument(db, actor, request.params.id);
    const [row] = await db
      .select({ f: files })
      .from(documentVersions)
      .innerJoin(files, eq(files.id, documentVersions.fileId))
      .where(eq(documentVersions.id, doc.currentVersionId!));
    ensureFound(row);
    const stream = await storage.read(row!.f.storageKey);
    return reply
      .type(row!.f.mimeType)
      .header('content-disposition', contentDisposition('attachment', row!.f.originalName))
      .header('x-content-type-options', 'nosniff')
      .send(stream);
  });
}
