/**
 * Hintergrundlauf "Wartung bald fällig": benachrichtigt den aktuellen Halter (mit aktivem
 * Kundenkonto) je fälliger Wartung höchstens einmal je Serviceeintrag und Fälligkeit.
 * Die Bewertung (zuerst erreichte Grenze, Schätzung gekennzeichnet) kommt aus der
 * Geschäftslogik (`evaluateVehicleMaintenance`).
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { berlinDateOf, evaluateVehicleMaintenance } from '@werkstatt/domain';
import type { Db } from '../db/index';
import { odometerReadings, serviceEntries, vehicleOwnerships, vehicles } from '../db/schema/index';
import { enqueueNotification, notificationTargets } from '../notifications/outbox';
import { customerUserId } from './recipients';
import { toServiceEntryRecords } from './serviceEntries';

export async function notifyMaintenanceDue(deps: { db: Db; now: () => Date }): Promise<{ notified: number }> {
  const { db } = deps;
  const now = deps.now();
  const owned = await db
    .select({ vehicleId: vehicleOwnerships.vehicleId, customerId: vehicleOwnerships.customerId })
    .from(vehicleOwnerships)
    .innerJoin(vehicles, eq(vehicles.id, vehicleOwnerships.vehicleId))
    .where(and(isNull(vehicleOwnerships.endedAt), isNull(vehicles.archivedAt)));
  if (owned.length === 0) return { notified: 0 };
  const ids = owned.map((o) => o.vehicleId);
  const entries = await toServiceEntryRecords(db, await db.select().from(serviceEntries).where(inArray(serviceEntries.vehicleId, ids)));
  const readings = await db.select().from(odometerReadings).where(inArray(odometerReadings.vehicleId, ids));
  const today = berlinDateOf(now);
  let notified = 0;
  for (const { vehicleId, customerId } of owned) {
    const due = evaluateVehicleMaintenance({
      entries: entries.filter((e) => e.vehicleId === vehicleId),
      odometerReadings: readings.filter((r) => r.vehicleId === vehicleId).map((r) => ({ valueKm: r.valueKm, recordedAt: r.recordedAt.toISOString(), plausibility: r.plausibility })),
      today,
    }).filter((d) => d.state === 'due_soon' || d.state === 'overdue');
    if (due.length === 0) continue;
    const userId = await customerUserId(db, customerId);
    if (!userId) continue;
    for (const d of due) {
      await enqueueNotification(
        db,
        {
          eventType: 'maintenance.due_soon',
          title: d.state === 'overdue' ? 'Wartung fällig' : 'Wartung bald fällig',
          body: `${d.title}: bitte einen Termin vereinbaren.`,
          recipients: [{ userId, targetPath: notificationTargets.maintenanceForCustomer(vehicleId) }],
          // einmal je Eintrag und Grenze (auch der Halter ist Teil des Schlüssels)
          dedupeKey: `maintenance.due_soon:${d.lastServiceEntryId}:${d.dueDate ?? ''}:${d.dueKm ?? ''}:${customerId}`,
        },
        now,
      );
      notified += 1;
    }
  }
  return { notified };
}
