/**
 * Servicehistorie (R-SERV-1 bis R-SERV-8, AGENTS.md Regel 5 und 8).
 *
 * Serviceeinträge entstehen ausschließlich beim fachlichen Abschluss eines Auftrags
 * (Übergang work_completed → completed), und zwar genau einmal je erledigter
 * Wartungsposition. Nie aus Angebot, Freigabe, Rechnung oder Zahlung. Abgelehnte oder
 * nicht durchgeführte Positionen erscheinen nie. Korrekturen erzeugen eine neue Revision.
 *
 * Platzhalter für @werkstatt/domain; reine Funktionen.
 */
import { ApiError, ERROR_CODES } from '../../errors';
import type { DMaintenanceType, DServiceEntry, DWorkItem, DWorkOrder } from '../model';
import { itemIsExecutable } from './access';

export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Alle ausführbaren Positionen sind erledigt oder als nicht durchgeführt markiert. */
export function allWorkFinished(workOrderId: string, items: readonly DWorkItem[]): boolean {
  const own = items.filter((i) => i.workOrderId === workOrderId);
  const open = own.filter(
    (i) =>
      (itemIsExecutable(i) && i.executionStatus !== 'done' && i.executionStatus !== 'not_done') ||
      i.authorization === 'pending_approval',
  );
  return own.length > 0 && open.length === 0;
}

export function isServiceRelevant(item: DWorkItem): boolean {
  return item.maintenanceTypeId !== null && item.executionStatus === 'done' && itemIsExecutable(item);
}

export interface CompletionArgs {
  workOrder: DWorkOrder;
  items: readonly DWorkItem[];
  existingEntries: readonly DServiceEntry[];
  maintenanceTypes: readonly DMaintenanceType[];
  workshopName: string;
  reviewerId: string;
  now: string;
  /** km-Stand aus der Abschlussprüfung, falls an der Position keiner erfasst ist */
  odometerKm: number | null;
  newId: () => string;
}

/**
 * Fachlicher Abschluss: setzt den Auftrag auf "completed" und erzeugt die Serviceeinträge.
 * Ein erneuter Aufruf ist ein Konflikt und erzeugt keine weiteren Einträge.
 */
export function completeReview(args: CompletionArgs): { workOrder: DWorkOrder; entries: DServiceEntry[] } {
  const { workOrder } = args;
  if (workOrder.status === 'completed' || workOrder.status === 'picked_up') {
    throw ApiError.conflict(ERROR_CODES.conflict, 'Der Auftrag ist bereits fachlich abgeschlossen.');
  }
  if (workOrder.status !== 'work_completed' || !allWorkFinished(workOrder.id, args.items)) {
    throw ApiError.conflict(ERROR_CODES.conflict, 'Es sind noch Arbeiten offen oder Freigaben ausstehend.');
  }
  const entries = createEntriesForCompletedItems(args);
  return {
    workOrder: {
      ...workOrder,
      status: 'completed',
      completionReviewedAt: args.now,
      completionReviewedBy: args.reviewerId,
      updatedAt: args.now,
    },
    entries,
  };
}

/** Genau ein Ursprungseintrag je Position (Unique-Index work_item_id WHERE revision_of_id IS NULL). */
export function createEntriesForCompletedItems(args: CompletionArgs): DServiceEntry[] {
  const already = new Set(args.existingEntries.filter((e) => e.revisionOfId === null && e.workItemId).map((e) => e.workItemId));
  const created: DServiceEntry[] = [];
  for (const item of args.items) {
    if (item.workOrderId !== args.workOrder.id || !isServiceRelevant(item) || already.has(item.id)) continue;
    const type = args.maintenanceTypes.find((t) => t.id === item.maintenanceTypeId);
    const performedOn = (item.doneAt ?? args.now).slice(0, 10);
    const odometerKm = item.doneOdometerKm ?? args.odometerKm;
    const intervalKm = item.intervalKm ?? type?.defaultIntervalKm ?? null;
    const intervalMonths = item.intervalMonths ?? type?.defaultIntervalMonths ?? null;
    created.push({
      id: args.newId(),
      vehicleId: args.workOrder.vehicleId,
      workOrderId: args.workOrder.id,
      workItemId: item.id,
      maintenanceTypeId: item.maintenanceTypeId,
      performedOn,
      odometerKm,
      title: type?.name ?? item.title,
      details: item.resultNotes ?? item.description,
      workshopName: args.workshopName,
      intervalKm,
      intervalMonths,
      nextDueDate: intervalMonths ? addMonths(performedOn, intervalMonths) : null,
      // Ohne km-Stand keine vorgetäuschte km-Fälligkeit (R-SERV-4)
      nextDueKm: intervalKm && odometerKm !== null ? odometerKm + intervalKm : null,
      status: 'valid',
      revisionOfId: null,
      revisionNo: 1,
      correctionReason: null,
      source: 'work_completion',
      createdBy: args.reviewerId,
      createdAt: args.now,
    });
    already.add(item.id);
  }
  return created;
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

/** Korrektur als neue Revision; der bisherige Eintrag wird "superseded", nichts wird überschrieben. */
export function correctEntry(
  entry: DServiceEntry,
  input: CorrectionInput,
  args: { newId: string; userId: string; now: string },
): { previous: DServiceEntry; revision: DServiceEntry } {
  if (entry.status !== 'valid') {
    throw ApiError.conflict(ERROR_CODES.conflict, 'Nur der aktuelle Stand eines Eintrags kann korrigiert werden.');
  }
  if (!input.reason.trim()) throw ApiError.validation('Eine Begründung ist Pflicht.');
  const performedOn = input.performedOn ?? entry.performedOn;
  const odometerKm = input.odometerKm !== undefined ? input.odometerKm : entry.odometerKm;
  const intervalKm = input.intervalKm !== undefined ? input.intervalKm : entry.intervalKm;
  const intervalMonths = input.intervalMonths !== undefined ? input.intervalMonths : entry.intervalMonths;
  const revision: DServiceEntry = {
    ...entry,
    id: args.newId,
    performedOn,
    odometerKm,
    title: input.title ?? entry.title,
    details: input.details !== undefined ? input.details : entry.details,
    intervalKm,
    intervalMonths,
    nextDueDate: intervalMonths ? addMonths(performedOn, intervalMonths) : null,
    nextDueKm: intervalKm && odometerKm !== null ? odometerKm + intervalKm : null,
    status: input.void ? 'voided' : 'valid',
    revisionOfId: entry.id,
    revisionNo: entry.revisionNo + 1,
    correctionReason: input.reason.trim(),
    createdBy: args.userId,
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
