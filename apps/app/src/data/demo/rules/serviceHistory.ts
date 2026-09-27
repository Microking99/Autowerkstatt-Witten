/**
 * Servicehistorie im Demo-Modus (R-SERV-1 bis R-SERV-8, AGENTS.md Regel 5 und 8).
 *
 * Wie in der API aus @werkstatt/domain: Serviceeinträge entstehen ausschließlich beim
 * fachlichen Abschluss (`canTransitionWorkOrder` → `completed`, dann
 * `deriveServiceEntries`), genau einmal je erledigter, autorisierter Wartungsposition; nie aus
 * Angebot, Freigabe, Rechnung oder Zahlung. Korrekturen erzeugen eine neue Revision
 * (`createCorrection`).
 */
import { apiCodeFromDomain, type Permission } from '@werkstatt/contracts';
import { addMonths as domainAddMonths, allExecutableItemsFinished, berlinDateOf, canTransitionWorkOrder, createCorrection, deriveServiceEntries, type Actor } from '@werkstatt/domain';
import { ApiError } from '../../errors';
import type { DMaintenanceType, DServiceEntry, DWorkItem, DWorkOrder } from '../model';

export function addMonths(isoDate: string, months: number): string {
  return domainAddMonths(isoDate.slice(0, 10), months);
}

/** Alle ausführbaren Positionen sind erledigt oder als nicht durchgeführt markiert. */
export function allWorkFinished(workOrderId: string, items: readonly DWorkItem[]): boolean {
  const own = items.filter((i) => i.workOrderId === workOrderId);
  return own.length > 0 && allExecutableItemsFinished(own);
}

export interface CompletionArgs {
  workOrder: DWorkOrder;
  items: readonly DWorkItem[];
  existingEntries: readonly DServiceEntry[];
  maintenanceTypes: readonly DMaintenanceType[];
  workshopName: string;
  reviewerId: string;
  permissions: ReadonlySet<Permission>;
  now: string;
  /** km-Stand aus der Abschlussprüfung, falls an der Position keiner erfasst ist */
  odometerKm: number | null;
  newId: () => string;
}

/**
 * Fachlicher Abschluss: Auftrag → `completed` und Serviceeinträge erzeugen. Ein erneuter
 * Aufruf (bereits abgeschlossen) erzeugt keine weiteren Einträge (wie die API: idempotent).
 */
export function completeReview(args: CompletionArgs): { workOrder: DWorkOrder; entries: DServiceEntry[] } {
  const { workOrder } = args;
  const own = args.items.filter((i) => i.workOrderId === workOrder.id);
  const already = workOrder.status === 'completed' || workOrder.status === 'picked_up';
  if (!already) {
    const check = canTransitionWorkOrder(workOrder.status, 'completed', { items: own, permissions: args.permissions });
    if (!check.allowed) {
      if (check.code === 'MISSING_PERMISSION') throw ApiError.forbidden(check.message);
      throw ApiError.conflict(apiCodeFromDomain(check.code), check.message);
    }
  }
  const reviewedAt = already ? (workOrder.completionReviewedAt ?? args.now) : args.now;
  const existingForItems = args.existingEntries.filter((e) => e.revisionOfId === null && e.workItemId).map((e) => e.workItemId!);
  const { entries } = deriveServiceEntries({
    workOrder: { id: workOrder.id, vehicleId: workOrder.vehicleId, status: 'completed' },
    items: own,
    maintenanceTypes: args.maintenanceTypes,
    performedOn: berlinDateOf(reviewedAt),
    odometerKm: args.odometerKm,
    workshopName: args.workshopName,
    existingEntriesForItems: existingForItems,
    createdBy: args.reviewerId,
    now: new Date(args.now),
  });
  const created: DServiceEntry[] = entries.map((e) => ({
    id: args.newId(),
    vehicleId: e.vehicleId,
    workOrderId: e.workOrderId,
    workItemId: e.workItemId,
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
    status: 'valid',
    revisionOfId: null,
    revisionNo: 1,
    correctionReason: null,
    source: 'work_completion',
    createdBy: args.reviewerId,
    createdAt: args.now,
  }));
  return {
    workOrder: already
      ? workOrder
      : { ...workOrder, status: 'completed', completionReviewedAt: args.now, completionReviewedBy: args.reviewerId, updatedAt: args.now },
    entries: created,
  };
}

export interface CorrectionInput {
  performedOn?: string;
  odometerKm?: number | null;
  title?: string;
  details?: string | null;
  intervalKm?: number | null;
  intervalMonths?: number | null;
  void?: boolean;
  reason: string;
}

/** Korrektur als neue Revision (Domain `createCorrection`); der bisherige Eintrag wird ersetzt. */
export function correctEntry(
  entry: DServiceEntry,
  input: CorrectionInput,
  args: { newId: string; actor: Actor; maintenanceTypeName: string | null; now: string },
): { previous: DServiceEntry; revision: DServiceEntry } {
  const result = createCorrection({ ...entry, maintenanceTypeName: args.maintenanceTypeName }, input, args.actor, new Date(args.now));
  if (!result.ok) {
    if (result.error.code === 'MISSING_PERMISSION') throw ApiError.forbidden(result.error.message);
    throw ApiError.unprocessable(apiCodeFromDomain(result.error.code), result.error.message);
  }
  const e = result.value.newEntry;
  const revision: DServiceEntry = {
    ...entry,
    id: args.newId,
    performedOn: e.performedOn,
    odometerKm: e.odometerKm,
    title: e.title,
    details: e.details,
    intervalKm: e.intervalKm,
    intervalMonths: e.intervalMonths,
    nextDueDate: e.nextDueDate,
    nextDueKm: e.nextDueKm,
    status: e.status,
    revisionOfId: entry.id,
    revisionNo: e.revisionNo,
    correctionReason: e.correctionReason,
    createdBy: args.actor.userId,
    createdAt: args.now,
  };
  return { previous: { ...entry, status: 'superseded' }, revision };
}

/** Sichtbare Historie: nur gültige Stände, neueste zuerst. */
export function visibleEntries(entries: readonly DServiceEntry[], vehicleId: string): DServiceEntry[] {
  return entries
    .filter((e) => e.vehicleId === vehicleId && e.status === 'valid')
    .sort((a, b) => (a.performedOn < b.performedOn ? 1 : a.performedOn > b.performedOn ? -1 : 0));
}

