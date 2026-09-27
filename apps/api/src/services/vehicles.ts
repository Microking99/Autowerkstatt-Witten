import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { routes, type VehicleDetail, type VehicleSummary } from '@werkstatt/contracts';
import type { Actor } from '@werkstatt/domain';
import type { DbOrTx } from '../db/index';
import { customers, odometerReadings, vehicleOwnerships, vehicles } from '../db/schema/index';
import { customerDisplayName } from './customers';

export type VehicleRow = typeof vehicles.$inferSelect;

export function vehicleLabel(v: Pick<VehicleRow, 'make' | 'model' | 'licensePlate'>): string {
  return `${v.make} ${v.model} (${v.licensePlate})`;
}

interface VehicleExtras {
  owner: { customerId: string; displayName: string } | null;
  lastOdometer: { valueKm: number; recordedAt: Date } | null;
}

export async function vehicleExtras(db: DbOrTx, ids: string[]): Promise<Map<string, VehicleExtras>> {
  const map = new Map<string, VehicleExtras>();
  for (const id of ids) map.set(id, { owner: null, lastOdometer: null });
  if (ids.length === 0) return map;
  const owners = await db
    .select({ vehicleId: vehicleOwnerships.vehicleId, customer: customers })
    .from(vehicleOwnerships)
    .innerJoin(customers, eq(customers.id, vehicleOwnerships.customerId))
    .where(and(inArray(vehicleOwnerships.vehicleId, ids), isNull(vehicleOwnerships.endedAt)));
  for (const o of owners) map.get(o.vehicleId)!.owner = { customerId: o.customer.id, displayName: customerDisplayName(o.customer) };
  const readings = await db
    .selectDistinctOn([odometerReadings.vehicleId], {
      vehicleId: odometerReadings.vehicleId,
      valueKm: odometerReadings.valueKm,
      recordedAt: odometerReadings.recordedAt,
    })
    .from(odometerReadings)
    .where(and(inArray(odometerReadings.vehicleId, ids), eq(odometerReadings.plausibility, 'ok')))
    .orderBy(odometerReadings.vehicleId, desc(odometerReadings.recordedAt), desc(odometerReadings.createdAt));
  for (const r of readings) map.get(r.vehicleId)!.lastOdometer = { valueKm: r.valueKm, recordedAt: r.recordedAt };
  return map;
}

export function toVehicleSummary(v: VehicleRow, extras: VehicleExtras, actor: Actor): VehicleSummary {
  const summary: VehicleSummary = {
    id: v.id,
    licensePlate: v.licensePlate,
    make: v.make,
    model: v.model,
    variant: v.variant,
    vin: v.vin,
    lastOdometerKm: extras.lastOdometer?.valueKm ?? null,
    lastOdometerAt: extras.lastOdometer ? extras.lastOdometer.recordedAt.toISOString() : null,
    isTestData: v.isTestData,
  };
  // Haltername nur für Mitarbeiter mit Kundensicht; der Kunde kennt sich selbst
  if (actor.role !== 'customer' && (actor.permissions.has('customers.read') || actor.permissions.has('vehicles.read'))) {
    summary.currentOwner = extras.owner;
  }
  return summary;
}

export function toVehicleDetail(v: VehicleRow, extras: VehicleExtras, actor: Actor, appBaseUrl: string): VehicleDetail {
  const isOwner = actor.role === 'customer' && extras.owner?.customerId === actor.customerId;
  const staffWithRead = actor.role !== 'customer' && actor.permissions.has('vehicles.read');
  const detail: VehicleDetail = {
    ...toVehicleSummary(v, extras, actor),
    hsn: v.hsn,
    tsn: v.tsn,
    firstRegistration: v.firstRegistration,
    fuelType: v.fuelType,
    color: v.color,
    qrPublicViewEnabled: v.qrPublicViewEnabled,
    createdAt: v.createdAt.toISOString(),
  };
  if (actor.role !== 'customer') detail.notesInternal = v.notesInternal;
  if (isOwner || staffWithRead) detail.qrUrl = `${appBaseUrl.replace(/\/+$/, '')}${routes.qr(v.qrToken)}`;
  return detail;
}
