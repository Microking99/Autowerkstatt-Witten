/**
 * Ausführungsstatus einer Position: planned → in_progress ⇄ paused → done | not_done.
 *
 * Ausgeführt (gestartet, abgeschlossen, als nicht durchgeführt markiert) werden nur Positionen
 * mit `authorization ∈ {agreed, approved}`. Abgelehnte, zurückgezogene und auf Freigabe
 * wartende Positionen sind gesperrt (R-FRG-5). Wer ausführen darf, prüft `canExecuteWorkItem`.
 *
 * Jeder Übergang meldet, ob ein Zeitabschnitt geöffnet oder geschlossen werden muss
 * (`timeEntry`), damit Zeiterfassung und Status zusammenpassen.
 */
import type { WorkItemAuthorization, WorkItemExecutionStatus } from '@werkstatt/contracts';
import { fail, ok, type DomainIssue, type Result } from '../common/result';
import { isExecutableAuthorization } from './status';

/** Relevanter Stand einer Position. */
export interface WorkItemExecutionState {
  authorization: WorkItemAuthorization;
  executionStatus: WorkItemExecutionStatus;
  /** Gesetzt bei Wartungspositionen (erzeugen Serviceeinträge). */
  maintenanceTypeId: string | null;
}

/** Aktion für die Zeiterfassung: Abschnitt öffnen, schließen oder nichts tun. */
export type TimeEntryAction = { action: 'open'; at: string } | { action: 'close'; at: string } | { action: 'none' };

/** Neuer Stand nach einem Übergang. */
export interface WorkItemTransition {
  executionStatus: WorkItemExecutionStatus;
  doneAt: string | null;
  doneOdometerKm: number | null;
  /** `true`, wenn bei einer Wartungsposition ausdrücklich "km-Stand unbekannt" gewählt wurde. */
  odometerUnknown: boolean;
  resultNotes: string | null;
  timeEntry: TimeEntryAction;
}

export type WorkItemTransitionCode = 'NOT_AUTHORIZED' | 'INVALID_STATUS' | 'ODOMETER_REQUIRED' | 'INVALID_ODOMETER' | 'REASON_REQUIRED';
export type WorkItemTransitionResult = Result<WorkItemTransition, DomainIssue<WorkItemTransitionCode>>;

function authorizationProblem(item: WorkItemExecutionState): WorkItemTransitionResult | null {
  if (isExecutableAuthorization(item.authorization)) return null;
  const reason: Record<Exclude<WorkItemAuthorization, 'agreed' | 'approved'>, string> = {
    pending_approval: 'Die Position wartet auf Kundenfreigabe.',
    rejected: 'Die Position wurde vom Kunden abgelehnt und wird nicht ausgeführt.',
    withdrawn: 'Die Position wurde zurückgezogen und wird nicht ausgeführt.',
  };
  return fail('NOT_AUTHORIZED', reason[item.authorization as keyof typeof reason]);
}

function closeIfRunning(item: WorkItemExecutionState, now: Date): TimeEntryAction {
  return item.executionStatus === 'in_progress' ? { action: 'close', at: now.toISOString() } : { action: 'none' };
}

/** Arbeit starten bzw. fortsetzen: `planned` oder `paused` → `in_progress`. Öffnet einen Zeitabschnitt. */
export function startItem(item: WorkItemExecutionState, input: { now: Date }): WorkItemTransitionResult {
  const auth = authorizationProblem(item);
  if (auth) return auth;
  if (item.executionStatus !== 'planned' && item.executionStatus !== 'paused') {
    return fail('INVALID_STATUS', 'Nur geplante oder pausierte Positionen können gestartet werden.');
  }
  return ok({
    executionStatus: 'in_progress',
    doneAt: null,
    doneOdometerKm: null,
    odometerUnknown: false,
    resultNotes: null,
    timeEntry: { action: 'open', at: input.now.toISOString() },
  });
}

/** Arbeit pausieren: `in_progress` → `paused`. Schließt den laufenden Zeitabschnitt. */
export function pauseItem(item: WorkItemExecutionState, input: { now: Date }): WorkItemTransitionResult {
  const auth = authorizationProblem(item);
  if (auth) return auth;
  if (item.executionStatus !== 'in_progress') {
    return fail('INVALID_STATUS', 'Nur laufende Positionen können pausiert werden.');
  }
  return ok({
    executionStatus: 'paused',
    doneAt: null,
    doneOdometerKm: null,
    odometerUnknown: false,
    resultNotes: null,
    timeEntry: { action: 'close', at: input.now.toISOString() },
  });
}

/**
 * Arbeit abschließen: `planned`, `in_progress` oder `paused` → `done`.
 *
 * Wartungspositionen (mit `maintenanceTypeId`) verlangen einen km-Stand (ganzzahlig ≥ 0).
 * `null` wird nur akzeptiert, wenn ausdrücklich `odometerUnknown: true` übergeben wird; dann
 * entsteht später ein Serviceeintrag mit unbekanntem km-Stand (keine vorgetäuschte
 * km-Fälligkeit). km-Stand und `odometerUnknown: true` zugleich sind widersprüchlich.
 */
export function finishItem(
  item: WorkItemExecutionState,
  input: { now: Date; odometerKm?: number | null; odometerUnknown?: boolean; resultNotes?: string | null },
): WorkItemTransitionResult {
  const auth = authorizationProblem(item);
  if (auth) return auth;
  if (item.executionStatus === 'done' || item.executionStatus === 'not_done') {
    return fail('INVALID_STATUS', 'Die Position ist bereits abgeschlossen.');
  }
  const km = input.odometerKm ?? null;
  const unknown = input.odometerUnknown === true;
  if (km !== null && (!Number.isInteger(km) || km < 0)) {
    return fail('INVALID_ODOMETER', 'Der km-Stand muss eine ganze Zahl ab 0 sein.');
  }
  if (km !== null && unknown) {
    return fail('INVALID_ODOMETER', 'km-Stand angegeben und zugleich als unbekannt markiert.');
  }
  if (item.maintenanceTypeId !== null && km === null && !unknown) {
    return fail('ODOMETER_REQUIRED', 'Für Wartungsarbeiten ist der km-Stand Pflicht (oder ausdrücklich "unbekannt" wählen).');
  }
  const notes = input.resultNotes?.trim() ?? '';
  return ok({
    executionStatus: 'done',
    doneAt: input.now.toISOString(),
    doneOdometerKm: km,
    odometerUnknown: km === null && item.maintenanceTypeId !== null ? unknown : false,
    resultNotes: notes.length > 0 ? notes : null,
    timeEntry: closeIfRunning(item, input.now),
  });
}

/**
 * Als nicht durchgeführt markieren: `planned`, `in_progress` oder `paused` → `not_done`.
 * Nur für ausführbare Positionen (`agreed`/`approved`); Begründung Pflicht.
 * Nicht durchgeführte Positionen erzeugen nie Serviceeinträge.
 */
export function markNotDone(item: WorkItemExecutionState, input: { now: Date; reason: string }): WorkItemTransitionResult {
  const auth = authorizationProblem(item);
  if (auth) return auth;
  if (item.executionStatus === 'done' || item.executionStatus === 'not_done') {
    return fail('INVALID_STATUS', 'Die Position ist bereits abgeschlossen.');
  }
  const reason = input.reason.trim();
  if (reason.length === 0) return fail('REASON_REQUIRED', 'Bitte eine Begründung angeben.');
  return ok({
    executionStatus: 'not_done',
    doneAt: null,
    doneOdometerKm: null,
    odometerUnknown: false,
    resultNotes: reason,
    timeEntry: closeIfRunning(item, input.now),
  });
}
