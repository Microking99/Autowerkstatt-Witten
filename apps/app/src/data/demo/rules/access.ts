/**
 * Objektregeln (docs/rollen-und-rechte.md, Abschnitt 3): woran ein Kunde oder Mechaniker
 * Zugriff hat. Fremdes und Nicht-Vorhandenes wird für Kunden identisch als 404 behandelt.
 * Die Ausführbarkeit kommt aus @werkstatt/domain (`isExecutableAuthorization`); die übrigen
 * Prüfungen bilden die Objektregeln der API auf den Demo-Zustand ab.
 */
import { isExecutableAuthorization } from '@werkstatt/domain';
import type {
  DApprovalRequest,
  DAppointment,
  DDocument,
  DInvoice,
  DOwnership,
  DServiceEntry,
  DWorkItem,
  DWorkOrder,
} from '../model';

/** Aktueller Halter (ended_at IS NULL) oder null. */
export function currentOwnerId(ownerships: readonly DOwnership[], vehicleId: string): string | null {
  return ownerships.find((o) => o.vehicleId === vehicleId && o.endedAt === null)?.customerId ?? null;
}

export function customerCanSeeVehicle(customerId: string, vehicleId: string, ownerships: readonly DOwnership[]): boolean {
  return currentOwnerId(ownerships, vehicleId) === customerId;
}

/** Aufträge gehören dem Kunden, nicht dem Fahrzeug (bleiben nach Halterwechsel beim Vorbesitzer). */
export function customerCanSeeWorkOrder(customerId: string, workOrder: DWorkOrder): boolean {
  return workOrder.customerId === customerId && workOrder.status !== 'draft';
}

export function customerCanSeeApproval(customerId: string, request: DApprovalRequest, workOrder: DWorkOrder): boolean {
  return customerCanSeeWorkOrder(customerId, workOrder) && request.workOrderId === workOrder.id && request.status !== 'draft';
}

/** Nur veröffentlichte Kundendokumente mit passender customer_id; interne nie. */
export function customerCanSeeDocument(customerId: string, document: DDocument): boolean {
  return (
    document.deletedAt === null &&
    document.visibility === 'customer' &&
    document.publishedAt !== null &&
    document.customerId === customerId
  );
}

export function customerCanSeeInvoice(customerId: string, invoice: DInvoice): boolean {
  return invoice.customerId === customerId && invoice.status !== 'draft';
}

export function customerCanSeeAppointment(customerId: string, appointment: DAppointment): boolean {
  return appointment.customerId === customerId;
}

/** Servicehistorie gehört zum Fahrzeug: sichtbar für den aktuellen Halter. */
export function customerCanSeeServiceEntry(
  customerId: string,
  entry: DServiceEntry,
  ownerships: readonly DOwnership[],
): boolean {
  return customerCanSeeVehicle(customerId, entry.vehicleId, ownerships);
}

/**
 * Technische Sicht auf einen Serviceeintrag für einen Kunden: Stammt der Eintrag aus einem
 * Auftrag eines anderen (früheren) Halters, wird der Auftragsbezug ausgeblendet.
 */
export function serviceEntryWorkOrderRefForCustomer(
  customerId: string,
  entry: DServiceEntry,
  workOrders: readonly DWorkOrder[],
): string | null {
  if (!entry.workOrderId) return null;
  const wo = workOrders.find((w) => w.id === entry.workOrderId);
  return wo && wo.customerId === customerId ? wo.id : null;
}

/** Mechaniker sieht Aufträge nur bei Zuweisung (Auftrag oder Position) oder mit workOrders.read. */
export function mechanicCanSeeWorkOrder(
  userId: string,
  workOrder: DWorkOrder,
  items: readonly DWorkItem[],
  hasReadAll: boolean,
): boolean {
  if (hasReadAll) return true;
  if (workOrder.assigneeIds.includes(userId)) return true;
  return items.some((i) => i.workOrderId === workOrder.id && i.assignedTo === userId);
}

/** Ausführung nur für vereinbarte oder vom Kunden freigegebene Positionen. */
export function itemIsExecutable(item: DWorkItem): boolean {
  return isExecutableAuthorization(item.authorization);
}
