/**
 * Öffentliche Zugänge ohne Anmeldung (R-QR): QR-Code und Fahrzeugfreigabe für Dritte.
 * Der QR-Code ist kein Generalschlüssel: ohne Berechtigung nur Hinweis bzw. die vom Halter
 * ausdrücklich freigegebene Kurzansicht; nie Namen, Kennzeichen, Preise, Rechnungen,
 * Dokumente, Nachrichten oder Aufträge.
 */
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PublicVehicleViewSchema, QrResolutionSchema, routes, type QrResolution } from '@werkstatt/contracts';
import { canViewVehicle, publicViewFromQr, publicViewFromShare, type Actor, type PublicEntrySource } from '@werkstatt/domain';
import type { DbOrTx } from '../db/index';
import { maintenanceTypes, serviceEntries, vehicleShares, vehicles, workItems, workOrderAssignees, workOrders } from '../db/schema/index';
import { SYSTEM_AUDIT_CONTEXT, audit } from '../lib/audit';
import { sha256Hex } from '../lib/crypto';
import { HttpError, notFound } from '../lib/errors';
import { vehicleAccessInput } from '../services/access';
import { loadSettings } from '../services/settings';
import type { App } from '../types';

const TokenParamsSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{16,200}$/) });

async function publicEntries(db: DbOrTx, vehicleId: string): Promise<PublicEntrySource[]> {
  const rows = await db
    .select({ e: serviceEntries, typeName: maintenanceTypes.name })
    .from(serviceEntries)
    .leftJoin(maintenanceTypes, eq(maintenanceTypes.id, serviceEntries.maintenanceTypeId))
    .where(eq(serviceEntries.vehicleId, vehicleId));
  return rows.map(({ e, typeName }) => ({
    id: e.id,
    vehicleId: e.vehicleId,
    status: e.status,
    revisionOfId: e.revisionOfId,
    performedOn: e.performedOn,
    odometerKm: e.odometerKm,
    title: e.title,
    details: e.details,
    workshopName: e.workshopName,
    nextDueDate: e.nextDueDate,
    nextDueKm: e.nextDueKm,
    maintenanceTypeName: typeName ?? null,
    revisionNo: e.revisionNo,
  }));
}

/** Zielansicht für angemeldete, berechtigte Personen je Rolle. */
async function authorizedTarget(db: DbOrTx, actor: Actor, vehicleId: string): Promise<string> {
  if (actor.role === 'customer') return routes.customer.vehicle(vehicleId);
  if (actor.role === 'admin' || actor.role === 'service') return routes.workshop.vehicle(vehicleId);
  const [assigned] = await db
    .select({ id: workOrders.id })
    .from(workOrders)
    .where(
      and(
        eq(workOrders.vehicleId, vehicleId),
        inArray(workOrders.status, ['open', 'in_progress', 'work_completed']),
        or(
          sql`EXISTS (SELECT 1 FROM ${workOrderAssignees} a WHERE a.work_order_id = ${workOrders.id} AND a.user_id = ${actor.userId})`,
          sql`EXISTS (SELECT 1 FROM ${workItems} i WHERE i.work_order_id = ${workOrders.id} AND i.assigned_to = ${actor.userId})`,
        ),
      ),
    )
    .orderBy(desc(workOrders.updatedAt))
    .limit(1);
  return assigned ? routes.mechanic.workOrder(assigned.id) : routes.mechanic.home();
}

export async function publicRoutes(app: App): Promise<void> {
  app.get(
    '/public/qr/:token',
    { schema: { params: TokenParamsSchema, response: { 200: QrResolutionSchema } }, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request): Promise<QrResolution> => {
      const { db } = app.deps;
      const [vehicle] = await db
        .select()
        .from(vehicles)
        .where(and(eq(vehicles.qrToken, request.params.token), isNull(vehicles.archivedAt)));
      if (!vehicle) throw notFound('Code nicht gefunden.');
      const settings = await loadSettings(db);
      // Mit Sitzung: normale Rechteprüfung, dann direkt zur vollständigen Ansicht
      if (request.actor) {
        const decision = canViewVehicle(request.actor, await vehicleAccessInput(db, request.actor, vehicle.id));
        if (decision.allowed) {
          return { mode: 'authorized', vehicleId: vehicle.id, targetPath: await authorizedTarget(db, request.actor, vehicle.id) };
        }
      }
      const view = publicViewFromQr(
        { id: vehicle.id, make: vehicle.make, model: vehicle.model, variant: vehicle.variant, vin: vehicle.vin, qrPublicViewEnabled: vehicle.qrPublicViewEnabled },
        await publicEntries(db, vehicle.id),
        { workshopName: settings.name },
      );
      if (view) return { mode: 'public', view };
      return { mode: 'login_required', workshopName: settings.name };
    },
  );

  app.get(
    '/public/shares/:token',
    { schema: { params: TokenParamsSchema, response: { 200: PublicVehicleViewSchema } }, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const { db, now: clock } = app.deps;
      const now = clock();
      const [share] = await db.select().from(vehicleShares).where(eq(vehicleShares.tokenHash, sha256Hex(request.params.token)));
      if (!share) throw notFound('Freigabe nicht gefunden.');
      if (share.revokedAt) throw new HttpError(410, 'share_revoked', 'Diese Freigabe wurde vom Halter widerrufen.');
      if (share.expiresAt.getTime() <= now.getTime()) throw new HttpError(410, 'share_expired', 'Diese Freigabe ist abgelaufen.');
      const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, share.vehicleId));
      if (!vehicle) throw notFound('Freigabe nicht gefunden.');
      const settings = await loadSettings(db);
      const view = publicViewFromShare(
        { id: vehicle.id, make: vehicle.make, model: vehicle.model, variant: vehicle.variant, vin: vehicle.vin, qrPublicViewEnabled: vehicle.qrPublicViewEnabled },
        await publicEntries(db, vehicle.id),
        { includeVin: share.includeVin, serviceEntryIds: share.serviceEntryIds, expiresAt: share.expiresAt.toISOString(), revokedAt: null },
        { now, workshopName: settings.name },
      );
      if (!view) throw new HttpError(410, 'share_expired', 'Diese Freigabe ist nicht mehr gültig.');
      await db.transaction(async (tx) => {
        await tx
          .update(vehicleShares)
          .set({ accessCount: sql`${vehicleShares.accessCount} + 1`, lastAccessedAt: now })
          .where(eq(vehicleShares.id, share.id));
        await audit(tx, { ...SYSTEM_AUDIT_CONTEXT, ip: request.ip, requestId: request.id }, { action: 'vehicle_share.accessed', entityType: 'vehicle_share', entityId: share.id, data: { vehicleId: vehicle.id } });
      });
      return view;
    },
  );
}
