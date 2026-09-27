import { asc, eq, inArray } from 'drizzle-orm';
import type { ServiceEntry } from '@werkstatt/contracts';
import { serviceEntryForActor, type Actor, type ServiceEntryRecord } from '@werkstatt/domain';
import type { DbOrTx } from '../db/index';
import { maintenanceTypes, serviceEntries, workOrders } from '../db/schema/index';

export type ServiceEntryRow = typeof serviceEntries.$inferSelect;

export async function loadServiceEntries(db: DbOrTx, vehicleId: string): Promise<ServiceEntryRow[]> {
  return db
    .select()
    .from(serviceEntries)
    .where(eq(serviceEntries.vehicleId, vehicleId))
    .orderBy(asc(serviceEntries.performedOn), asc(serviceEntries.revisionNo), asc(serviceEntries.createdAt));
}

async function typeNames(db: DbOrTx, rows: ServiceEntryRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.maintenanceTypeId).filter((x): x is string => !!x))];
  if (ids.length === 0) return new Map();
  const types = await db.select({ id: maintenanceTypes.id, name: maintenanceTypes.name }).from(maintenanceTypes).where(inArray(maintenanceTypes.id, ids));
  return new Map(types.map((t) => [t.id, t.name]));
}

export function toServiceEntryDto(row: ServiceEntryRow, typeName: string | null): ServiceEntry {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    workOrderId: row.workOrderId,
    maintenanceTypeId: row.maintenanceTypeId,
    maintenanceTypeName: typeName,
    performedOn: row.performedOn,
    odometerKm: row.odometerKm,
    title: row.title,
    details: row.details,
    workshopName: row.workshopName,
    intervalKm: row.intervalKm,
    intervalMonths: row.intervalMonths,
    nextDueDate: row.nextDueDate,
    nextDueKm: row.nextDueKm,
    status: row.status,
    revisionNo: row.revisionNo,
    revisionOfId: row.revisionOfId,
    correctionReason: row.correctionReason,
    createdAt: row.createdAt.toISOString(),
  };
}

/** DTOs mit Feldfilter: Kunden sehen den Auftragsbezug nur bei eigenen Aufträgen. */
export async function serviceEntryDtos(db: DbOrTx, rows: ServiceEntryRow[], actor: Actor): Promise<ServiceEntry[]> {
  const names = await typeNames(db, rows);
  const woIds = [...new Set(rows.map((r) => r.workOrderId))];
  const owners = woIds.length > 0 ? await db.select({ id: workOrders.id, customerId: workOrders.customerId }).from(workOrders).where(inArray(workOrders.id, woIds)) : [];
  return rows.map((r) =>
    serviceEntryForActor(
      toServiceEntryDto(r, r.maintenanceTypeId ? (names.get(r.maintenanceTypeId) ?? null) : null),
      { workOrderCustomerId: owners.find((o) => o.id === r.workOrderId)?.customerId ?? null },
      actor,
    ),
  );
}

export async function toServiceEntryRecords(db: DbOrTx, rows: ServiceEntryRow[]): Promise<ServiceEntryRecord[]> {
  const names = await typeNames(db, rows);
  return rows.map((r) => ({
    id: r.id,
    vehicleId: r.vehicleId,
    workOrderId: r.workOrderId,
    workItemId: r.workItemId,
    maintenanceTypeId: r.maintenanceTypeId,
    maintenanceTypeName: r.maintenanceTypeId ? (names.get(r.maintenanceTypeId) ?? null) : null,
    performedOn: r.performedOn,
    odometerKm: r.odometerKm,
    title: r.title,
    details: r.details,
    workshopName: r.workshopName,
    intervalKm: r.intervalKm,
    intervalMonths: r.intervalMonths,
    nextDueDate: r.nextDueDate,
    nextDueKm: r.nextDueKm,
    status: r.status,
    revisionOfId: r.revisionOfId,
    revisionNo: r.revisionNo,
    correctionReason: r.correctionReason,
    createdAt: r.createdAt.toISOString(),
  }));
}
