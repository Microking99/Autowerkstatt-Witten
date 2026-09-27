/**
 * Serviceeinträge: Entstehung und Korrektur (R-SERV-1 bis R-SERV-8).
 *
 * Serviceeinträge entstehen AUSSCHLIESSLICH über {@link deriveServiceEntries}, und die API
 * ruft diese Funktion NUR beim Übergang des Auftrags zu `completed` (fachlicher Abschluss
 * geprüft) auf. Es gibt bewusst keine Funktion, die Einträge aus Angebot, Freigabe, Rechnung
 * oder Zahlung ableitet (R-SERV-5). Fachlicher Abschluss und Zahlung sind unabhängig (R-SERV-7).
 */
import type { MaintenanceType, ServiceEntryStatus, WorkItemAuthorization, WorkItemExecutionStatus, WorkOrderStatus } from '@werkstatt/contracts';
import { addMonths, isIsoDate, type IsoDate } from '../common/dates';
import { DomainError, fail, ok, type DomainIssue, type Result } from '../common/result';
import type { Actor } from '../permissions/actor';

/** Nächste Fälligkeit aus Durchführung und Intervall. */
export interface NextDue {
  nextDueDate: IsoDate | null;
  nextDueKm: number | null;
}

/**
 * Nächste Fälligkeit: Datum = Durchführung + Monate (Monatsende wird begrenzt, z. B.
 * 31.01. + 1 Monat = 28./29.02.); km = km-Stand bei Durchführung + km-Intervall.
 * Ohne km-Stand keine km-Fälligkeit (keine vorgetäuschte Angabe).
 */
export function computeNextDue(input: {
  performedOn: IsoDate;
  odometerKm: number | null;
  intervalKm: number | null;
  intervalMonths: number | null;
}): NextDue {
  const { performedOn, odometerKm, intervalKm, intervalMonths } = input;
  const nextDueDate = intervalMonths !== null && intervalMonths > 0 ? addMonths(performedOn, intervalMonths) : null;
  const nextDueKm = odometerKm !== null && intervalKm !== null && intervalKm > 0 ? odometerKm + intervalKm : null;
  return { nextDueDate, nextDueKm };
}

/** Position, wie sie für die Ableitung gebraucht wird. */
export interface ServiceSourceItem {
  id: string;
  workOrderId: string;
  title: string;
  description: string | null;
  maintenanceTypeId: string | null;
  intervalKm: number | null;
  intervalMonths: number | null;
  authorization: WorkItemAuthorization;
  executionStatus: WorkItemExecutionStatus;
  doneOdometerKm: number | null;
  resultNotes: string | null;
}

/** Neuer (noch nicht gespeicherter) Serviceeintrag; ID vergibt die Datenbank. */
export interface NewServiceEntry {
  vehicleId: string;
  workOrderId: string | null;
  workItemId: string | null;
  maintenanceTypeId: string | null;
  maintenanceTypeName: string | null;
  performedOn: IsoDate;
  odometerKm: number | null;
  title: string;
  details: string | null;
  workshopName: string;
  intervalKm: number | null;
  intervalMonths: number | null;
  nextDueDate: IsoDate | null;
  nextDueKm: number | null;
  status: ServiceEntryStatus;
  revisionOfId: string | null;
  revisionNo: number;
  correctionReason: string | null;
  source: 'work_completion';
  createdBy: string | null;
  createdAt: string | null;
}

export type SkipReason = 'OTHER_WORK_ORDER' | 'NO_MAINTENANCE_TYPE' | 'UNKNOWN_MAINTENANCE_TYPE' | 'NOT_AUTHORIZED' | 'NOT_DONE' | 'ALREADY_RECORDED';

/**
 * Leitet Serviceeinträge aus einem fachlich abgeschlossenen Auftrag ab.
 *
 * Nur beim Übergang zu `completed` aufrufen (`workOrder.status` muss `completed` sein).
 * Ein Eintrag entsteht nur für Positionen mit
 * - Wartungsart (`maintenanceTypeId`),
 * - `authorization ∈ {agreed, approved}` (nie `rejected`, `withdrawn`, `pending_approval`),
 * - `executionStatus = done` (nie `not_done`, nie offen),
 * - noch ohne Ursprungseintrag (`existingEntriesForItems`: IDs der Positionen, die schon einen
 *   Eintrag mit `revisionOfId = null` haben). Wiederholte Abschlussereignisse erzeugen daher
 *   nichts Neues; die Datenbank sichert das zusätzlich über einen Unique-Index ab.
 *
 * km-Stand: der beim Abschließen der Position erfasste Wert, sonst `odometerKm` des
 * Auftragsabschlusses, sonst unbekannt (`null`). Intervall: das an der Position gewählte,
 * sonst der Standard der Wartungsart.
 *
 * @throws DomainError `WORK_ORDER_NOT_COMPLETED`, wenn der Auftrag nicht `completed` ist.
 */
export function deriveServiceEntries(input: {
  workOrder: { id: string; vehicleId: string; status: WorkOrderStatus };
  items: readonly ServiceSourceItem[];
  maintenanceTypes: readonly Pick<MaintenanceType, 'id' | 'name' | 'defaultIntervalKm' | 'defaultIntervalMonths'>[];
  /** Datum des fachlichen Abschlusses (Berlin, `YYYY-MM-DD`). */
  performedOn: IsoDate;
  /** km-Stand beim Abschluss, falls erfasst. */
  odometerKm: number | null;
  workshopName: string;
  /** IDs der Positionen, die bereits einen Ursprungseintrag haben. */
  existingEntriesForItems: ReadonlySet<string> | readonly string[];
  /** Person, die den Abschluss bestätigt (für `createdBy`). */
  createdBy?: string | null;
  now?: Date;
}): { entries: NewServiceEntry[]; skipped: { itemId: string; reason: SkipReason }[] } {
  const { workOrder } = input;
  if (workOrder.status !== 'completed') {
    throw new DomainError('WORK_ORDER_NOT_COMPLETED', 'Serviceeinträge entstehen nur beim fachlichen Abschluss (Status completed).');
  }
  if (!isIsoDate(input.performedOn)) throw new DomainError('INVALID_DATE', 'Ungültiges Durchführungsdatum.');
  const existing = new Set(input.existingEntriesForItems);
  const types = new Map(input.maintenanceTypes.map((t) => [t.id, t]));
  const entries: NewServiceEntry[] = [];
  const skipped: { itemId: string; reason: SkipReason }[] = [];
  const createdAt = input.now ? input.now.toISOString() : null;

  for (const item of input.items) {
    let reason: SkipReason | null = null;
    if (item.workOrderId !== workOrder.id) reason = 'OTHER_WORK_ORDER';
    else if (item.maintenanceTypeId === null) reason = 'NO_MAINTENANCE_TYPE';
    else if (item.authorization !== 'agreed' && item.authorization !== 'approved') reason = 'NOT_AUTHORIZED';
    else if (item.executionStatus !== 'done') reason = 'NOT_DONE';
    else if (existing.has(item.id)) reason = 'ALREADY_RECORDED';
    else if (!types.has(item.maintenanceTypeId)) reason = 'UNKNOWN_MAINTENANCE_TYPE';
    if (reason !== null) {
      skipped.push({ itemId: item.id, reason });
      continue;
    }
    const type = types.get(item.maintenanceTypeId!)!;
    const odometerKm = item.doneOdometerKm ?? input.odometerKm ?? null;
    const intervalKm = item.intervalKm ?? type.defaultIntervalKm;
    const intervalMonths = item.intervalMonths ?? type.defaultIntervalMonths;
    const due = computeNextDue({ performedOn: input.performedOn, odometerKm, intervalKm, intervalMonths });
    entries.push({
      vehicleId: workOrder.vehicleId,
      workOrderId: workOrder.id,
      workItemId: item.id,
      maintenanceTypeId: type.id,
      maintenanceTypeName: type.name,
      performedOn: input.performedOn,
      odometerKm,
      title: item.title.trim(),
      details: item.resultNotes?.trim() || item.description?.trim() || null,
      workshopName: input.workshopName,
      intervalKm,
      intervalMonths,
      nextDueDate: due.nextDueDate,
      nextDueKm: due.nextDueKm,
      status: 'valid',
      revisionOfId: null,
      revisionNo: 1,
      correctionReason: null,
      source: 'work_completion',
      createdBy: input.createdBy ?? null,
      createdAt,
    });
    existing.add(item.id);
  }
  return { entries, skipped };
}

/** Gespeicherter Serviceeintrag (Felder für Korrektur und Fälligkeit). */
export interface ServiceEntryRecord {
  id: string;
  vehicleId: string;
  workOrderId: string | null;
  workItemId?: string | null;
  maintenanceTypeId: string | null;
  maintenanceTypeName: string | null;
  performedOn: IsoDate;
  odometerKm: number | null;
  title: string;
  details: string | null;
  workshopName: string;
  intervalKm: number | null;
  intervalMonths: number | null;
  nextDueDate: IsoDate | null;
  nextDueKm: number | null;
  status: ServiceEntryStatus;
  revisionOfId: string | null;
  revisionNo: number;
  correctionReason?: string | null;
  createdAt?: string;
}

/** Korrekturwunsch (entspricht `ServiceEntryCorrectionRequestSchema`). */
export interface ServiceEntryCorrection {
  performedOn?: IsoDate;
  odometerKm?: number | null;
  title?: string;
  details?: string | null;
  intervalKm?: number | null;
  intervalMonths?: number | null;
  /** `true`: Eintrag für ungültig erklären (Status `voided`), nichts wird gelöscht. */
  void?: boolean;
  /** Begründung, Pflicht. */
  reason: string;
}

export type CorrectionCode = 'MISSING_PERMISSION' | 'NOT_CURRENT' | 'REASON_REQUIRED' | 'NO_CHANGES' | 'INVALID_VALUE';

/**
 * Korrigiert einen Serviceeintrag, ohne ihn zu überschreiben (R-SERV-8):
 * Es entsteht eine neue Zeile (`revisionOfId` = korrigierter Eintrag, `revisionNo + 1`,
 * Begründung Pflicht), der bisherige Eintrag wird `superseded`. Fälligkeiten werden neu
 * berechnet. Mit `void: true` hat die neue Revision den Status `voided` (Eintrag gilt als
 * ungültig, bleibt aber nachvollziehbar erhalten; nichts wird gelöscht).
 *
 * Nur gültige (aktuelle) Einträge können korrigiert werden. Recht `serviceHistory.correct`.
 */
export function createCorrection(
  entry: ServiceEntryRecord,
  correction: ServiceEntryCorrection,
  actor: Actor,
  now: Date,
): Result<{ newEntry: NewServiceEntry; supersede: { id: string; status: 'superseded' } }, DomainIssue<CorrectionCode>> {
  if (!actor.accountActive || actor.role === 'customer' || !actor.permissions.has('serviceHistory.correct')) {
    return fail('MISSING_PERMISSION', 'Für Korrekturen der Servicehistorie fehlt die Berechtigung.');
  }
  if (entry.status !== 'valid') return fail('NOT_CURRENT', 'Nur der aktuelle, gültige Eintrag kann korrigiert werden.');
  const reason = correction.reason.trim();
  if (reason.length === 0) return fail('REASON_REQUIRED', 'Bitte eine Begründung für die Korrektur angeben.');

  const performedOn = correction.performedOn ?? entry.performedOn;
  if (!isIsoDate(performedOn)) return fail('INVALID_VALUE', 'Ungültiges Datum.');
  const odometerKm = correction.odometerKm !== undefined ? correction.odometerKm : entry.odometerKm;
  if (odometerKm !== null && (!Number.isInteger(odometerKm) || odometerKm < 0)) return fail('INVALID_VALUE', 'Ungültiger km-Stand.');
  const title = correction.title !== undefined ? correction.title.trim() : entry.title;
  if (title.length === 0) return fail('INVALID_VALUE', 'Der Titel darf nicht leer sein.');
  const details = correction.details !== undefined ? correction.details?.trim() || null : entry.details;
  const intervalKm = correction.intervalKm !== undefined ? correction.intervalKm : entry.intervalKm;
  const intervalMonths = correction.intervalMonths !== undefined ? correction.intervalMonths : entry.intervalMonths;
  const voided = correction.void === true;

  const changed =
    voided ||
    performedOn !== entry.performedOn ||
    odometerKm !== entry.odometerKm ||
    title !== entry.title ||
    details !== entry.details ||
    intervalKm !== entry.intervalKm ||
    intervalMonths !== entry.intervalMonths;
  if (!changed) return fail('NO_CHANGES', 'Die Korrektur enthält keine Änderung.');

  const due = computeNextDue({ performedOn, odometerKm, intervalKm, intervalMonths });
  return ok({
    newEntry: {
      vehicleId: entry.vehicleId,
      workOrderId: entry.workOrderId,
      workItemId: entry.workItemId ?? null,
      maintenanceTypeId: entry.maintenanceTypeId,
      maintenanceTypeName: entry.maintenanceTypeName,
      performedOn,
      odometerKm,
      title,
      details,
      workshopName: entry.workshopName,
      intervalKm,
      intervalMonths,
      nextDueDate: due.nextDueDate,
      nextDueKm: due.nextDueKm,
      status: voided ? 'voided' : 'valid',
      revisionOfId: entry.id,
      revisionNo: entry.revisionNo + 1,
      correctionReason: reason,
      source: 'work_completion',
      createdBy: actor.userId,
      createdAt: now.toISOString(),
    },
    supersede: { id: entry.id, status: 'superseded' },
  });
}
