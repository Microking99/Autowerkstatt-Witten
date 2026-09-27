/**
 * Getrennte Statusanzeigen eines Auftrags (R-AUF-5, AGENTS.md Regel 6) und automatisches
 * Weiterschalten des Arbeitsstatus, wie in der API aus @werkstatt/domain
 * (`computeStatusTriple`, `canTransitionWorkOrder`, `allExecutableItemsFinished`).
 */
import type { StatusTriple } from '@werkstatt/contracts';
import { allExecutableItemsFinished, canTransitionWorkOrder, computeStatusTriple, isExecutableAuthorization } from '@werkstatt/domain';
import type { DApprovalRequest, DInvoice, DPayment, DRefund, DWorkItem, DWorkOrder } from '../model';

export function statusTriple(
  workOrder: DWorkOrder,
  requests: readonly DApprovalRequest[],
  invoices: readonly DInvoice[],
  payments: readonly DPayment[],
  refunds: readonly DRefund[],
  today: string,
): StatusTriple {
  return computeStatusTriple({
    workStatus: workOrder.status,
    approvalRequests: requests.filter((r) => r.workOrderId === workOrder.id),
    invoices: invoices
      .filter((i) => i.workOrderId === workOrder.id)
      .map((i) => {
        const own = payments.filter((p) => p.invoiceId === i.id);
        const ids = new Set(own.map((p) => p.id));
        return {
          invoice: { status: i.status, totalGrossCents: i.totalGrossCents, dueDate: i.dueDate },
          payments: own.map((p) => ({ amountCents: p.amountCents })),
          refunds: refunds.filter((r) => ids.has(r.paymentId)).map((r) => ({ amountCents: r.amountCents, status: r.status })),
        };
      }),
    today: today.slice(0, 10),
    readyForPickupAt: workOrder.readyForPickupAt,
    pickedUpAt: workOrder.pickedUpAt,
  });
}

/**
 * Nach jeder Positionsänderung wie die API (`autoAdvanceWorkOrder`): offen → in Arbeit, sobald
 * eine ausführbare Position begonnen ist; in Arbeit → Arbeiten erledigt, wenn alle ausführbaren
 * Positionen erledigt oder nicht durchgeführt sind; zurück zu in Arbeit, wenn wieder eine
 * ausführbare Position offen ist (z. B. nachträglich freigegebene Zusatzarbeit).
 */
export function recomputeWorkStatus(workOrder: DWorkOrder, items: readonly DWorkItem[], now: string): DWorkOrder {
  const own = items.filter((i) => i.workOrderId === workOrder.id);
  const executable = own.filter((i) => isExecutableAuthorization(i.authorization));
  const system = { items: own, permissions: new Set(['workOrders.write', 'workItems.execute'] as const) };
  let status = workOrder.status;
  if (status === 'open' && executable.some((i) => i.executionStatus !== 'planned') && canTransitionWorkOrder('open', 'in_progress', system).allowed) status = 'in_progress';
  if (status === 'in_progress' && executable.length > 0 && allExecutableItemsFinished(own)) {
    if (canTransitionWorkOrder('in_progress', 'work_completed', system).allowed) status = 'work_completed';
  } else if (status === 'work_completed' && !allExecutableItemsFinished(own)) {
    if (canTransitionWorkOrder('work_completed', 'in_progress', system).allowed) status = 'in_progress';
  }
  return status === workOrder.status ? workOrder : { ...workOrder, status, updatedAt: now };
}
