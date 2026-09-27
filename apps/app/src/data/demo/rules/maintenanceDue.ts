/**
 * Fälligkeiten im Demo-Modus (R-SERV-2 bis R-SERV-4, R-KAL-1): wie in der API aus
 * @werkstatt/domain (`evaluateVehicleMaintenance`). Kombinierte Intervalle: die zuerst
 * erreichte Grenze ist maßgeblich; ohne aktuellen km-Stand keine vorgetäuschte
 * km-Fälligkeit; Schätzungen sind gekennzeichnet ("geschätzt anhand ...").
 */
import type { MaintenanceDue } from '@werkstatt/contracts';
import { evaluateVehicleMaintenance } from '@werkstatt/domain';
import type { DMaintenanceType, DOdometer, DServiceEntry } from '../model';

export function computeMaintenanceDue(
  entries: readonly DServiceEntry[],
  readings: readonly DOdometer[],
  vehicleId: string,
  today: string,
  maintenanceTypes: readonly DMaintenanceType[] = [],
): MaintenanceDue[] {
  const typeName = (id: string | null) => (id ? (maintenanceTypes.find((t) => t.id === id)?.name ?? null) : null);
  return evaluateVehicleMaintenance({
    entries: entries.filter((e) => e.vehicleId === vehicleId).map((e) => ({ ...e, maintenanceTypeName: typeName(e.maintenanceTypeId) })),
    odometerReadings: readings.filter((r) => r.vehicleId === vehicleId).map((r) => ({ valueKm: r.valueKm, recordedAt: r.recordedAt, plausibility: r.plausibility })),
    today: today.slice(0, 10),
  });
}
