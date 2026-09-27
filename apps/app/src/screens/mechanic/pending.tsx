/**
 * Anzeige nicht übertragener Einträge in der Mechanikeransicht: erwarteter Zustand einer
 * Position nach den gespeicherten Aktionen und der Chip "Nicht synchronisiert".
 */
import type { StatusLabel, WorkItem, WorkItemExecutionStatus } from '@werkstatt/contracts';
import type { QueueEntry, QueueOpKind } from '../../offline/queueCore';
import { StatusChip } from '../../ui';

export const unsyncedLabel: StatusLabel = { label: 'Nicht synchronisiert', tone: 'warning', icon: 'CloudSlash' };
export const conflictLabel: StatusLabel = { label: 'Konflikt, bitte prüfen', tone: 'danger', icon: 'WarningCircle' };
export const sendingLabel: StatusLabel = { label: 'Wird übertragen', tone: 'info', icon: 'CloudArrowUp' };

export const queueKindLabels: Record<QueueOpKind, string> = {
  photo: 'Foto',
  createFinding: 'Feststellung',
  reportFinding: 'An Service melden',
  startWorkItem: 'Position starten',
  pauseWorkItem: 'Position pausieren',
  finishWorkItem: 'Position abschließen',
  notDoneWorkItem: 'Nicht durchgeführt',
  addPart: 'Verbautes Teil',
  addInternalNote: 'Interne Notiz',
  sendMessage: 'Nachricht',
};

/** Ausführungsstatus, wie er nach Übertragung der gespeicherten Aktionen voraussichtlich ist. */
export function expectedExecution(item: WorkItem, entries: readonly QueueEntry[]): WorkItemExecutionStatus {
  let status = item.executionStatus;
  for (const e of entries) {
    if (e.state === 'conflict') break;
    if (e.kind === 'startWorkItem') status = 'in_progress';
    if (e.kind === 'pauseWorkItem') status = 'paused';
    if (e.kind === 'finishWorkItem') status = 'done';
    if (e.kind === 'notDoneWorkItem') status = 'not_done';
  }
  return status;
}

export function PendingChip({ entries, testID }: { entries: readonly QueueEntry[]; testID?: string }) {
  if (entries.length === 0) return null;
  const conflict = entries.some((e) => e.state === 'conflict');
  // Gerade in Übertragung (mit Verbindung): kein Warnhinweis, nur der Zwischenstand
  if (!conflict && entries.every((e) => e.state === 'sending')) return <StatusChip status={sendingLabel} testID="wird-uebertragen" />;
  return <StatusChip status={conflict ? conflictLabel : { ...unsyncedLabel, label: entries.length > 1 ? `Nicht synchronisiert (${entries.length})` : unsyncedLabel.label }} testID={testID ?? 'nicht-synchronisiert'} />;
}
