/**
 * Getrennte Statusanzeigen eines Auftrags (R-AUF-5, AGENTS.md Regel 6):
 * Arbeitsstatus (gespeichert), Freigabestatus und Zahlungsstatus (berechnet).
 *
 * Platzhalter für @werkstatt/domain; reine Funktionen.
 */
import type { ApprovalOverviewStatus, StatusTriple } from '@werkstatt/contracts';
import type { DApprovalRequest, DWorkItem, DWorkOrder } from '../model';
import { itemIsExecutable } from './access';
import { aggregatePaymentStatus, type InvoiceSummary } from './payments';

export function approvalOverview(requests: readonly DApprovalRequest[]): { status: ApprovalOverviewStatus; pending: number } {
  const relevant = requests.filter((r) => r.status !== 'draft' && r.status !== 'withdrawn');
  const pending = relevant.filter((r) => r.status === 'pending_customer').length;
  if (relevant.length === 0) return { status: 'none', pending: 0 };
  return { status: pending > 0 ? 'pending' : 'decided', pending };
}

export function statusTriple(
  workOrder: DWorkOrder,
  requests: readonly DApprovalRequest[],
  invoiceSummaries: readonly InvoiceSummary[],
): StatusTriple {
  const approval = approvalOverview(requests.filter((r) => r.workOrderId === workOrder.id));
  return {
    work: workOrder.status,
    approval: approval.status,
    payment: aggregatePaymentStatus(invoiceSummaries),
    overdue: invoiceSummaries.some((s) => s.overdue),
    readyForPickup: workOrder.readyForPickupAt !== null && workOrder.pickedUpAt === null,
    pendingApprovalCount: approval.pending,
  };
}

/**
 * Nach jeder Positionsänderung: Sind alle ausführbaren Positionen erledigt bzw. nicht
 * durchgeführt und keine Freigabe offen, wechselt "in Arbeit" zu "Arbeiten erledigt".
 */
export function recomputeWorkStatus(workOrder: DWorkOrder, items: readonly DWorkItem[], now: string): DWorkOrder {
  const own = items.filter((i) => i.workOrderId === workOrder.id);
  const executable = own.filter(itemIsExecutable);
  const anyStarted = executable.some((i) => i.executionStatus !== 'planned');
  const allFinished =
    executable.length > 0 &&
    executable.every((i) => i.executionStatus === 'done' || i.executionStatus === 'not_done') &&
    !own.some((i) => i.authorization === 'pending_approval');
  if (workOrder.status === 'open' && anyStarted) return { ...workOrder, status: allFinished ? 'work_completed' : 'in_progress', updatedAt: now };
  if (workOrder.status === 'in_progress' && allFinished) return { ...workOrder, status: 'work_completed', updatedAt: now };
  if (workOrder.status === 'work_completed' && !allFinished) return { ...workOrder, status: 'in_progress', updatedAt: now };
  return workOrder;
}
