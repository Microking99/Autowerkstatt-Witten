/**
 * Fahrzeuge (R-FZG), km-Historie, Halterwechsel, QR-Serviceheft, Servicehistorie mit
 * Korrekturen, Fälligkeiten und Freigaben für Dritte (R-SERV, R-QR).
 */
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import QRCode from 'qrcode';
import { z } from 'zod';
import {
  MaintenanceDueSchema,
  OdometerInputSchema,
  OdometerReadingSchema,
  OwnershipSchema,
  OwnershipTransferRequestSchema,
  PageSchema,
  QrPublicViewRequestSchema,
  ServiceEntryCorrectionRequestSchema,
  ServiceEntrySchema,
  VehicleDetailSchema,
  VehicleInputSchema,
  VehicleShareSchema,
  VehicleSummarySchema,
  CreateVehicleShareRequestSchema,
  routes,
  type OdometerReading,
  type VehicleShare,
} from '@werkstatt/contracts';
import {
  berlinDateOf,
  canCorrectServiceEntry,
  canManageVehicleShares,
  canViewServiceHistory,
  canViewVehicle,
  checkOdometerPlausibility,
  createCorrection,
  evaluateVehicleMaintenance,
  hasPermission,
  licensePlateSearchKey,
  normalizeLicensePlate,
  planOwnershipTransfer,
  type Actor,
} from '@werkstatt/domain';
import type { DbOrTx } from '../db/index';
import {
  customers,
  odometerReadings,
  serviceEntries,
  vehicleOwnerships,
  vehicleShares,
  vehicles,
  workItems,
  workOrderAssignees,
  workOrders,
} from '../db/schema/index';
import { audit, auditContextFrom } from '../lib/audit';
import { randomToken, sha256Hex } from '../lib/crypto';
import { conflict, forbidden, unprocessable } from '../lib/errors';
import { IdParamsSchema, PageQuerySchema, decodeCursor, ensure, ensureFound, page, requireActor } from '../lib/http';
import { vehicleAccessInput } from '../services/access';
import { customerDisplayName } from '../services/customers';
import { loadServiceEntries, serviceEntryDtos, toServiceEntryRecords } from '../services/serviceEntries';
import { loadSettings } from '../services/settings';
import { toVehicleDetail, toVehicleSummary, vehicleExtras, type VehicleRow } from '../services/vehicles';
import type { App } from '../types';

const ListQuerySchema = PageQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  customerId: z.string().uuid().optional(),
  archived: z.enum(['true', 'false']).optional(),
});

const VehicleUpdateSchema = VehicleInputSchema.omit({ ownerCustomerId: true }).partial();

type OdometerRow = typeof odometerReadings.$inferSelect;
type ShareRow = typeof vehicleShares.$inferSelect;

function toOdometerDto(r: OdometerRow): OdometerReading {
  return {
    id: r.id,
    vehicleId: r.vehicleId,
    valueKm: r.valueKm,
    recordedAt: r.recordedAt.toISOString(),
    source: r.source,
    workOrderId: r.workOrderId,
    plausibility: r.plausibility,
  };
}

function toShareDto(r: ShareRow, shareUrl: string | null): VehicleShare {
  return {
    id: r.id,
    vehicleId: r.vehicleId,
    label: r.label,
    includeVin: r.includeVin,
    serviceEntryIds: r.serviceEntryIds,
    expiresAt: r.expiresAt.toISOString(),
    revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
    accessCount: r.accessCount,
    lastAccessedAt: r.lastAccessedAt ? r.lastAccessedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    shareUrl,
  };
}

async function loadVehicle(db: DbOrTx, id: string): Promise<VehicleRow | null> {
  const [row] = await db.select().from(vehicles).where(eq(vehicles.id, id));
  return row ?? null;
}

/** Fahrzeug laden und Sichtrecht prüfen. */
async function loadVisibleVehicle(db: DbOrTx, actor: Actor, id: string) {
  const vehicle = await loadVehicle(db, id);
  if (!vehicle) {
    ensureFound(null);
  }
  const access = await vehicleAccessInput(db, actor, id);
  ensure(canViewVehicle(actor, access));
  return { vehicle: vehicle!, access };
}

/** Neuen km-Stand mit Plausibilitätsprüfung (Geschäftslogik) speichern; nie überschreiben. */
export async function recordOdometer(
  db: DbOrTx,
  input: { vehicleId: string; valueKm: number; recordedAt: Date; source: OdometerRow['source']; workOrderId?: string | null; recordedBy: string | null },
): Promise<OdometerRow> {
  const previous = await db.select().from(odometerReadings).where(eq(odometerReadings.vehicleId, input.vehicleId));
  const plausibility = checkOdometerPlausibility(
    previous.map((p) => ({ valueKm: p.valueKm, recordedAt: p.recordedAt.toISOString(), plausibility: p.plausibility })),
    input.valueKm,
    input.recordedAt,
  );
  const [row] = await db
    .insert(odometerReadings)
    .values({
      vehicleId: input.vehicleId,
      valueKm: input.valueKm,
      recordedAt: input.recordedAt,
      source: input.source,
      workOrderId: input.workOrderId ?? null,
      recordedBy: input.recordedBy,
      plausibility,
    })
    .returning();
  return row!;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

export async function vehicleRoutes(app: App): Promise<void> {
  const appBase = () => app.deps.config.APP_BASE_URL;

  app.get('/vehicles', { schema: { querystring: ListQuerySchema, response: { 200: PageSchema(VehicleSummarySchema) } } }, async (request) => {
    const actor = requireActor(request);
    const { db } = app.deps;
    const q = request.query;
    const conditions: (SQL | undefined)[] = [];
    if (actor.role === 'customer') {
      // nur Fahrzeuge im aktuellen Halterzeitraum des Kunden
      conditions.push(
        actor.customerId
          ? sql`EXISTS (SELECT 1 FROM ${vehicleOwnerships} o WHERE o.vehicle_id = ${vehicles.id} AND o.ended_at IS NULL AND o.customer_id = ${actor.customerId})`
          : sql`false`,
      );
    } else {
      if (!actor.accountActive) ensureFound(null);
      if (!actor.permissions.has('vehicles.read')) {
        conditions.push(sql`EXISTS (SELECT 1 FROM ${workOrders} wo WHERE wo.vehicle_id = ${vehicles.id} AND (
          EXISTS (SELECT 1 FROM ${workOrderAssignees} a WHERE a.work_order_id = wo.id AND a.user_id = ${actor.userId})
          OR EXISTS (SELECT 1 FROM ${workItems} i WHERE i.work_order_id = wo.id AND i.assigned_to = ${actor.userId})))`);
      }
      if (q.archived !== 'true') conditions.push(isNull(vehicles.archivedAt));
      if (q.customerId) {
        conditions.push(
          sql`EXISTS (SELECT 1 FROM ${vehicleOwnerships} o WHERE o.vehicle_id = ${vehicles.id} AND o.ended_at IS NULL AND o.customer_id = ${q.customerId})`,
        );
      }
    }
    if (q.q) {
      const key = licensePlateSearchKey(q.q);
      const like = `%${q.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      conditions.push(
        or(
          key.length > 0 ? sql`${vehicles.licensePlateNormalized} LIKE ${`%${key}%`}` : undefined,
          ilike(vehicles.vin, like),
          ilike(vehicles.make, like),
          ilike(vehicles.model, like),
        ),
      );
    }
    const offset = decodeCursor(q.cursor);
    const rows = await db
      .select()
      .from(vehicles)
      .where(and(...conditions))
      .orderBy(asc(vehicles.licensePlateNormalized))
      .limit(q.limit + 1)
      .offset(offset);
    const extras = await vehicleExtras(db, rows.map((r) => r.id));
    return page(
      rows.map((r) => toVehicleSummary(r, extras.get(r.id)!, actor)),
      offset,
      q.limit,
    );
  });

  app.post('/vehicles', { schema: { body: VehicleInputSchema, response: { 201: VehicleDetailSchema } } }, async (request, reply) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'vehicles.write'));
    const { db, now: clock } = app.deps;
    const now = clock();
    const { ownerCustomerId, ...input } = request.body;
    const vehicle = await db.transaction(async (tx) => {
      const [owner] = await tx.select().from(customers).where(eq(customers.id, ownerCustomerId));
      if (!owner || owner.archivedAt) throw unprocessable('owner_invalid', 'Der Halter wurde nicht gefunden oder ist archiviert.');
      if (input.vin) {
        const [dup] = await tx.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.vin, input.vin));
        if (dup) throw conflict('vin_taken', 'Ein Fahrzeug mit dieser FIN ist bereits angelegt.');
      }
      const plate = normalizeLicensePlate(input.licensePlate);
      const [row] = await tx
        .insert(vehicles)
        .values({ ...input, licensePlate: plate, licensePlateNormalized: licensePlateSearchKey(plate), qrToken: randomToken(24) })
        .returning();
      await tx.insert(vehicleOwnerships).values({ vehicleId: row!.id, customerId: owner.id, startedAt: now, createdBy: actor.userId });
      await audit(tx, auditContextFrom(request), { action: 'vehicle.created', entityType: 'vehicle', entityId: row!.id, data: { ownerCustomerId: owner.id } });
      return row!;
    });
    const extras = await vehicleExtras(db, [vehicle.id]);
    return reply.code(201).send(toVehicleDetail(vehicle, extras.get(vehicle.id)!, actor, appBase()));
  });

  app.get('/vehicles/:id', { schema: { params: IdParamsSchema, response: { 200: VehicleDetailSchema } } }, async (request) => {
    const actor = requireActor(request);
    const { db } = app.deps;
    const { vehicle } = await loadVisibleVehicle(db, actor, request.params.id);
    const extras = await vehicleExtras(db, [vehicle.id]);
    return toVehicleDetail(vehicle, extras.get(vehicle.id)!, actor, appBase());
  });

  app.patch('/vehicles/:id', { schema: { params: IdParamsSchema, body: VehicleUpdateSchema, response: { 200: VehicleDetailSchema } } }, async (request) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'vehicles.write'));
    const { db } = app.deps;
    const updated = await db.transaction(async (tx) => {
      ensureFound(await loadVehicle(tx, request.params.id));
      const patch: Partial<typeof vehicles.$inferInsert> = { ...request.body };
      if (request.body.licensePlate) {
        patch.licensePlate = normalizeLicensePlate(request.body.licensePlate);
        patch.licensePlateNormalized = licensePlateSearchKey(patch.licensePlate);
      }
      if (request.body.vin) {
        const [dup] = await tx
          .select({ id: vehicles.id })
          .from(vehicles)
          .where(and(eq(vehicles.vin, request.body.vin), ne(vehicles.id, request.params.id)));
        if (dup) throw conflict('vin_taken', 'Ein Fahrzeug mit dieser FIN ist bereits angelegt.');
      }
      const [row] = await tx.update(vehicles).set(patch).where(eq(vehicles.id, request.params.id)).returning();
      await audit(tx, auditContextFrom(request), { action: 'vehicle.updated', entityType: 'vehicle', entityId: row!.id, data: { fields: Object.keys(request.body) } });
      return row!;
    });
    const extras = await vehicleExtras(db, [updated.id]);
    return toVehicleDetail(updated, extras.get(updated.id)!, actor, appBase());
  });

  // km-Historie ---------------------------------------------------------------------------

  app.get('/vehicles/:id/odometer', { schema: { params: IdParamsSchema, response: { 200: z.array(OdometerReadingSchema) } } }, async (request) => {
    const actor = requireActor(request);
    const { db } = app.deps;
    await loadVisibleVehicle(db, actor, request.params.id);
    const rows = await db
      .select()
      .from(odometerReadings)
      .where(eq(odometerReadings.vehicleId, request.params.id))
      .orderBy(desc(odometerReadings.recordedAt), desc(odometerReadings.createdAt));
    return rows.map(toOdometerDto);
  });

  app.post(
    '/vehicles/:id/odometer',
    { schema: { params: IdParamsSchema, body: OdometerInputSchema, response: { 201: OdometerReadingSchema } } },
    async (request, reply) => {
      const actor = requireActor(request);
      const { db, now: clock } = app.deps;
      const now = clock();
      const { access } = await loadVisibleVehicle(db, actor, request.params.id);
      let source: OdometerRow['source'];
      if (actor.role === 'customer') {
        // nur der aktuelle Halter (bereits durch canViewVehicle sichergestellt)
        if (access.currentOwnerCustomerId !== actor.customerId) ensureFound(null);
        source = 'customer';
      } else {
        ensure(hasPermission(actor, 'vehicles.write'));
        source = 'staff';
      }
      const recordedAt = request.body.recordedAt ? new Date(request.body.recordedAt) : now;
      if (recordedAt.getTime() > now.getTime() + 5 * 60_000) throw unprocessable('recorded_in_future', 'Der Zeitpunkt liegt in der Zukunft.');
      const row = await db.transaction(async (tx) => {
        const created = await recordOdometer(tx, { vehicleId: request.params.id, valueKm: request.body.valueKm, recordedAt, source, recordedBy: actor.userId });
        await audit(tx, auditContextFrom(request), {
          action: 'vehicle.odometer_recorded',
          entityType: 'vehicle',
          entityId: request.params.id,
          data: { valueKm: created.valueKm, source, plausibility: created.plausibility },
        });
        return created;
      });
      return reply.code(201).send(toOdometerDto(row));
    },
  );

  // Halter -------------------------------------------------------------------------------

  app.get('/vehicles/:id/ownerships', { schema: { params: IdParamsSchema, response: { 200: z.array(OwnershipSchema) } } }, async (request) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'vehicles.read'));
    const { db } = app.deps;
    ensureFound(await loadVehicle(db, request.params.id));
    const rows = await db
      .select({ o: vehicleOwnerships, c: customers })
      .from(vehicleOwnerships)
      .innerJoin(customers, eq(customers.id, vehicleOwnerships.customerId))
      .where(eq(vehicleOwnerships.vehicleId, request.params.id))
      .orderBy(asc(vehicleOwnerships.startedAt));
    return rows.map(({ o, c }) => ({
      id: o.id,
      vehicleId: o.vehicleId,
      customerId: o.customerId,
      customerDisplayName: customerDisplayName(c),
      startedAt: o.startedAt.toISOString(),
      endedAt: o.endedAt ? o.endedAt.toISOString() : null,
      note: o.note,
    }));
  });

  app.post(
    '/vehicles/:id/ownership-transfer',
    { schema: { params: IdParamsSchema, body: OwnershipTransferRequestSchema, response: { 200: VehicleDetailSchema } } },
    async (request) => {
      const actor = requireActor(request);
      ensure(hasPermission(actor, 'vehicles.transferOwnership'));
      const { db, now: clock } = app.deps;
      const now = clock();
      const updated = await db.transaction(async (tx) => {
        const [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, request.params.id)).for('update');
        ensureFound(vehicle);
        const [newOwner] = await tx.select().from(customers).where(eq(customers.id, request.body.newCustomerId));
        if (!newOwner || newOwner.archivedAt) throw unprocessable('owner_invalid', 'Der neue Halter wurde nicht gefunden oder ist archiviert.');
        const [current] = await tx
          .select()
          .from(vehicleOwnerships)
          .where(and(eq(vehicleOwnerships.vehicleId, vehicle!.id), isNull(vehicleOwnerships.endedAt)));
        let previousCustomerId: string | null = null;
        let startedAt = new Date(request.body.effectiveAt);
        if (current) {
          const plan = planOwnershipTransfer({
            current: { id: current.id, customerId: current.customerId, startedAt: current.startedAt.toISOString(), endedAt: null },
            newCustomerId: newOwner.id,
            effectiveAt: request.body.effectiveAt,
            now,
          });
          if (!plan.ok) throw unprocessable(plan.error.code.toLowerCase(), plan.error.message);
          previousCustomerId = current.customerId;
          startedAt = new Date(plan.value.startNew.startedAt);
          await tx.update(vehicleOwnerships).set({ endedAt: new Date(plan.value.endCurrent.endedAt) }).where(eq(vehicleOwnerships.id, current.id));
          // Entscheidungen des bisherigen Halters enden mit dem Wechsel
          await tx
            .update(vehicleShares)
            .set({ revokedAt: now })
            .where(and(eq(vehicleShares.vehicleId, vehicle!.id), isNull(vehicleShares.revokedAt)));
          await tx.update(vehicles).set({ qrPublicViewEnabled: false }).where(eq(vehicles.id, vehicle!.id));
        }
        await tx.insert(vehicleOwnerships).values({
          vehicleId: vehicle!.id,
          customerId: newOwner.id,
          startedAt,
          createdBy: actor.userId,
          note: request.body.note ?? null,
        });
        await audit(tx, auditContextFrom(request), {
          action: 'vehicle.ownership_transferred',
          entityType: 'vehicle',
          entityId: vehicle!.id,
          data: { fromCustomerId: previousCustomerId, toCustomerId: newOwner.id, effectiveAt: startedAt.toISOString() },
        });
        const [fresh] = await tx.select().from(vehicles).where(eq(vehicles.id, vehicle!.id));
        return fresh!;
      });
      const extras = await vehicleExtras(db, [updated.id]);
      return toVehicleDetail(updated, extras.get(updated.id)!, actor, appBase());
    },
  );

  // QR-Serviceheft ------------------------------------------------------------------------

  app.put(
    '/vehicles/:id/qr-public-view',
    { schema: { params: IdParamsSchema, body: QrPublicViewRequestSchema, response: { 200: VehicleDetailSchema } } },
    async (request) => {
      const actor = requireActor(request);
      const { db } = app.deps;
      const { access } = await loadVisibleVehicle(db, actor, request.params.id);
      ensure(canManageVehicleShares(actor, access));
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx.update(vehicles).set({ qrPublicViewEnabled: request.body.enabled }).where(eq(vehicles.id, request.params.id)).returning();
        await audit(tx, auditContextFrom(request), { action: 'vehicle.qr_public_view_changed', entityType: 'vehicle', entityId: row!.id, data: { enabled: request.body.enabled } });
        return row!;
      });
      const extras = await vehicleExtras(db, [updated.id]);
      return toVehicleDetail(updated, extras.get(updated.id)!, actor, appBase());
    },
  );

  app.post('/vehicles/:id/qr/rotate', { schema: { params: IdParamsSchema, response: { 200: VehicleDetailSchema } } }, async (request) => {
    const actor = requireActor(request);
    ensure(hasPermission(actor, 'vehicles.write'));
    const { db } = app.deps;
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(vehicles).set({ qrToken: randomToken(24) }).where(eq(vehicles.id, request.params.id)).returning();
      ensureFound(row);
      await audit(tx, auditContextFrom(request), { action: 'vehicle.qr_rotated', entityType: 'vehicle', entityId: row!.id });
      return row!;
    });
    const extras = await vehicleExtras(db, [updated.id]);
    return toVehicleDetail(updated, extras.get(updated.id)!, actor, appBase());
  });

  app.get('/vehicles/:id/qr/sticker.svg', { schema: { params: IdParamsSchema } }, async (request, reply) => {
    const actor = requireActor(request);
    const { db } = app.deps;
    const { vehicle, access } = await loadVisibleVehicle(db, actor, request.params.id);
    const isOwner = actor.role === 'customer' && access.currentOwnerCustomerId === actor.customerId;
    if (!isOwner && !(actor.role !== 'customer' && actor.permissions.has('vehicles.read'))) throw forbidden();
    const settings = await loadSettings(db);
    const url = `${appBase().replace(/\/+$/, '')}${routes.qr(vehicle.qrToken)}`;
    const qr = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 0 });
    const inner = qr.replace(/<\?xml[^>]*>/, '').replace('<svg ', '<svg x="30" y="30" width="240" height="240" ');
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="350" viewBox="0 0 300 350" role="img" aria-label="QR-Serviceheft">` +
      `<rect width="300" height="350" fill="#ffffff"/>${inner}` +
      `<text x="150" y="298" text-anchor="middle" font-family="sans-serif" font-size="18" font-weight="bold" fill="#111111">Digitales Serviceheft</text>` +
      `<text x="150" y="324" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#333333">${escapeXml(settings.name)}</text>` +
      `</svg>`;
    return reply
      .type('image/svg+xml; charset=utf-8')
      .header('content-disposition', `inline; filename="qr-serviceheft.svg"`)
      .send(svg);
  });

  // Servicehistorie ------------------------------------------------------------------------

  app.get('/vehicles/:id/service-entries', { schema: { params: IdParamsSchema, response: { 200: z.array(ServiceEntrySchema) } } }, async (request) => {
    const actor = requireActor(request);
    const { db } = app.deps;
    ensureFound(await loadVehicle(db, request.params.id));
    const access = await vehicleAccessInput(db, actor, request.params.id);
    ensure(canViewServiceHistory(actor, access));
    let rows = await loadServiceEntries(db, request.params.id);
    if (actor.role === 'customer') rows = rows.filter((r) => r.status !== 'superseded');
    return serviceEntryDtos(db, rows.reverse(), actor);
  });

  app.get('/service-entries/:id', { schema: { params: IdParamsSchema, response: { 200: ServiceEntrySchema } } }, async (request) => {
    const actor = requireActor(request);
    const { db } = app.deps;
    const [row] = await db.select().from(serviceEntries).where(eq(serviceEntries.id, request.params.id));
    ensureFound(row);
    const access = await vehicleAccessInput(db, actor, row!.vehicleId);
    ensure(canViewServiceHistory(actor, access));
    const [dto] = await serviceEntryDtos(db, [row!], actor);
    return dto!;
  });

  app.post(
    '/service-entries/:id/corrections',
    { schema: { params: IdParamsSchema, body: ServiceEntryCorrectionRequestSchema, response: { 201: ServiceEntrySchema } } },
    async (request, reply) => {
      const actor = requireActor(request);
      ensure(canCorrectServiceEntry(actor));
      const { db, now: clock } = app.deps;
      const now = clock();
      const created = await db.transaction(async (tx) => {
        const [row] = await tx.select().from(serviceEntries).where(eq(serviceEntries.id, request.params.id)).for('update');
        ensureFound(row);
        const [record] = await toServiceEntryRecords(tx, [row!]);
        const result = createCorrection(record!, request.body, actor, now);
        if (!result.ok) {
          if (result.error.code === 'MISSING_PERMISSION') throw forbidden(result.error.message);
          throw unprocessable(result.error.code.toLowerCase(), result.error.message);
        }
        const e = result.value.newEntry;
        await tx.update(serviceEntries).set({ status: 'superseded' }).where(eq(serviceEntries.id, row!.id));
        const [inserted] = await tx
          .insert(serviceEntries)
          .values({
            vehicleId: e.vehicleId,
            workOrderId: row!.workOrderId,
            workItemId: row!.workItemId,
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
            status: e.status,
            revisionOfId: row!.id,
            revisionNo: e.revisionNo,
            correctionReason: e.correctionReason,
            source: 'work_completion',
            createdBy: actor.userId,
          })
          .returning();
        await audit(tx, auditContextFrom(request), {
          action: 'service_entry.corrected',
          entityType: 'service_entry',
          entityId: inserted!.id,
          data: { revisionOfId: row!.id, revisionNo: e.revisionNo, reason: e.correctionReason, voided: e.status === 'voided', vehicleId: e.vehicleId, workOrderId: row!.workOrderId },
        });
        return inserted!;
      });
      const [dto] = await serviceEntryDtos(db, [created], actor);
      return reply.code(201).send(dto!);
    },
  );

  // Fälligkeiten ----------------------------------------------------------------------------

  app.get('/vehicles/:id/maintenance-due', { schema: { params: IdParamsSchema, response: { 200: z.array(MaintenanceDueSchema) } } }, async (request) => {
    const actor = requireActor(request);
    const { db, now } = app.deps;
    ensureFound(await loadVehicle(db, request.params.id));
    ensure(canViewServiceHistory(actor, await vehicleAccessInput(db, actor, request.params.id)));
    const entries = await toServiceEntryRecords(db, await loadServiceEntries(db, request.params.id));
    const readings = await db.select().from(odometerReadings).where(eq(odometerReadings.vehicleId, request.params.id));
    return evaluateVehicleMaintenance({
      entries,
      odometerReadings: readings.map((r) => ({ valueKm: r.valueKm, recordedAt: r.recordedAt.toISOString(), plausibility: r.plausibility })),
      today: berlinDateOf(now()),
    });
  });

  app.get(
    '/maintenance-due',
    { schema: { querystring: z.object({ all: z.enum(['true', 'false']).optional() }), response: { 200: z.array(MaintenanceDueSchema) } } },
    async (request) => {
      const actor = requireActor(request);
      ensure(hasPermission(actor, 'serviceHistory.read'));
      const { db, now } = app.deps;
      const activeVehicles = await db.select({ id: vehicles.id }).from(vehicles).where(isNull(vehicles.archivedAt));
      const ids = activeVehicles.map((v) => v.id);
      if (ids.length === 0) return [];
      const allEntries = await toServiceEntryRecords(db, await db.select().from(serviceEntries).where(inArray(serviceEntries.vehicleId, ids)));
      const allReadings = await db.select().from(odometerReadings).where(inArray(odometerReadings.vehicleId, ids));
      const today = berlinDateOf(now());
      const result = [];
      for (const id of new Set(allEntries.map((e) => e.vehicleId))) {
        const due = evaluateVehicleMaintenance({
          entries: allEntries.filter((e) => e.vehicleId === id),
          odometerReadings: allReadings
            .filter((r) => r.vehicleId === id)
            .map((r) => ({ valueKm: r.valueKm, recordedAt: r.recordedAt.toISOString(), plausibility: r.plausibility })),
          today,
        });
        result.push(...due.filter((d) => request.query.all === 'true' || d.state === 'overdue' || d.state === 'due_soon'));
      }
      const rank = { overdue: 0, due_soon: 1, unknown: 2, ok: 3 } as const;
      return result.sort((a, b) => rank[a.state] - rank[b.state] || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
    },
  );

  // Freigaben für Dritte ------------------------------------------------------------------

  app.get('/vehicles/:id/shares', { schema: { params: IdParamsSchema, response: { 200: z.array(VehicleShareSchema) } } }, async (request) => {
    const actor = requireActor(request);
    const { db } = app.deps;
    const { access } = await loadVisibleVehicle(db, actor, request.params.id);
    ensure(canManageVehicleShares(actor, access));
    const rows = await db
      .select()
      .from(vehicleShares)
      .where(and(eq(vehicleShares.vehicleId, request.params.id), eq(vehicleShares.customerId, actor.customerId!)))
      .orderBy(desc(vehicleShares.createdAt));
    return rows.map((r) => toShareDto(r, null));
  });

  app.post(
    '/vehicles/:id/shares',
    { schema: { params: IdParamsSchema, body: CreateVehicleShareRequestSchema, response: { 201: VehicleShareSchema } } },
    async (request, reply) => {
      const actor = requireActor(request);
      const { db, now: clock } = app.deps;
      const now = clock();
      const { access } = await loadVisibleVehicle(db, actor, request.params.id);
      ensure(canManageVehicleShares(actor, access));
      const expiresAt = new Date(request.body.expiresAt);
      if (expiresAt.getTime() <= now.getTime()) throw unprocessable('expires_in_past', 'Das Ablaufdatum muss in der Zukunft liegen.');
      if (expiresAt.getTime() > now.getTime() + 366 * 86_400_000) throw unprocessable('expires_too_late', 'Freigaben gelten höchstens ein Jahr.');
      const ids = [...new Set(request.body.serviceEntryIds)];
      const entries = await db
        .select({ id: serviceEntries.id, status: serviceEntries.status })
        .from(serviceEntries)
        .where(and(eq(serviceEntries.vehicleId, request.params.id), inArray(serviceEntries.id, ids)));
      if (entries.length !== ids.length || entries.some((e) => e.status !== 'valid')) {
        throw unprocessable('invalid_entries', 'Nur gültige Serviceeinträge dieses Fahrzeugs können freigegeben werden.');
      }
      const token = randomToken(32);
      const row = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(vehicleShares)
          .values({
            vehicleId: request.params.id,
            customerId: actor.customerId!,
            createdByUserId: actor.userId,
            tokenHash: sha256Hex(token),
            label: request.body.label,
            includeVin: request.body.includeVin,
            serviceEntryIds: ids,
            expiresAt,
          })
          .returning();
        await audit(tx, auditContextFrom(request), {
          action: 'vehicle_share.created',
          entityType: 'vehicle_share',
          entityId: created!.id,
          data: { vehicleId: request.params.id, entryCount: ids.length, includeVin: request.body.includeVin, expiresAt: expiresAt.toISOString() },
        });
        return created!;
      });
      const shareUrl = `${appBase().replace(/\/+$/, '')}${routes.share(token)}`;
      return reply.code(201).send(toShareDto(row, shareUrl));
    },
  );

  app.post('/shares/:id/revoke', { schema: { params: IdParamsSchema, response: { 200: VehicleShareSchema } } }, async (request) => {
    const actor = requireActor(request);
    const { db, now } = app.deps;
    const [share] = await db.select().from(vehicleShares).where(eq(vehicleShares.id, request.params.id));
    ensureFound(share);
    const access = await vehicleAccessInput(db, actor, share!.vehicleId);
    ensure(canManageVehicleShares(actor, access));
    if (share!.customerId !== actor.customerId) ensureFound(null);
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(vehicleShares)
        .set({ revokedAt: share!.revokedAt ?? now() })
        .where(eq(vehicleShares.id, share!.id))
        .returning();
      await audit(tx, auditContextFrom(request), { action: 'vehicle_share.revoked', entityType: 'vehicle_share', entityId: share!.id, data: { vehicleId: share!.vehicleId } });
      return row!;
    });
    return toShareDto(updated, null);
  });
}
