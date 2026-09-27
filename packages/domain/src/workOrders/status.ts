/**
 * Arbeitsstatus eines Auftrags, Freigabestatus und Status-Dreiklang
 * (docs/datenmodell.md, Abschnitt 5: Arbeits-, Freigabe- und Zahlungsstatus sind getrennt).
 *
 * Arbeitsstatus: draft → open → in_progress → work_completed → completed → picked_up,
 * jederzeit vor `completed`: cancelled.
 *
 * Ergänzung (in der Doku nicht ausgeschlossen): `work_completed → in_progress`, wenn nach dem
 * Erledigen noch eine ausführbare, nicht abgeschlossene Position hinzukommt (z. B. eine
 * nachträglich freigegebene Zusatzarbeit). Nur dann; sonst ist der Rückschritt verboten.
 */
import type {
  ApprovalOverviewStatus,
  ApprovalRequestStatus,
  Permission,
  StatusTriple,
  WorkItemAuthorization,
  WorkItemExecutionStatus,
  WorkOrderStatus,
} from '@werkstatt/contracts';
import type { IsoDate } from '../common/dates';
import { aggregatePaymentStatus, type InvoiceWithPayments } from '../payments/status';

/** Minimaler Positionsstand für Auftragsregeln. */
export interface WorkItemStatusInput {
  authorization: WorkItemAuthorization;
  executionStatus: WorkItemExecutionStatus;
}

/** Ausführbar sind nur vereinbarte (`agreed`) oder vom Kunden freigegebene (`approved`) Positionen. */
export function isExecutableAuthorization(authorization: WorkItemAuthorization): boolean {
  return authorization === 'agreed' || authorization === 'approved';
}

/** Position ist erledigt oder als nicht durchgeführt markiert. */
export function isItemFinished(item: Pick<WorkItemStatusInput, 'executionStatus'>): boolean {
  return item.executionStatus === 'done' || item.executionStatus === 'not_done';
}

/** true, wenn alle ausführbaren Positionen `done` oder `not_done` sind. */
export function allExecutableItemsFinished(items: readonly WorkItemStatusInput[]): boolean {
  return items.filter((i) => isExecutableAuthorization(i.authorization)).every(isItemFinished);
}

/** Erlaubte Folgestatus je Arbeitsstatus. */
export const WORK_ORDER_TRANSITIONS: Readonly<Record<WorkOrderStatus, readonly WorkOrderStatus[]>> = {
  draft: ['open', 'cancelled'],
  open: ['in_progress', 'cancelled'],
  in_progress: ['work_completed', 'cancelled'],
  work_completed: ['completed', 'in_progress', 'cancelled'],
  completed: ['picked_up'],
  picked_up: [],
  cancelled: [],
};

export interface WorkOrderTransitionContext {
  /** Alle Positionen des Auftrags. */
  items: readonly WorkItemStatusInput[];
  /** Wirksame Rechte der handelnden Person (Kunden: leer). */
  permissions: ReadonlySet<Permission>;
}

export type WorkOrderTransitionCode =
  | 'SAME_STATUS'
  | 'TRANSITION_NOT_ALLOWED'
  | 'MISSING_PERMISSION'
  | 'ITEMS_NOT_FINISHED'
  | 'NO_OPEN_ITEMS';

export type WorkOrderTransitionWarning = 'PENDING_APPROVAL_ITEMS';

export type WorkOrderTransitionResult =
  | { allowed: true; warnings: WorkOrderTransitionWarning[] }
  | { allowed: false; code: WorkOrderTransitionCode; message: string };

function denied(code: WorkOrderTransitionCode, message: string): WorkOrderTransitionResult {
  return { allowed: false, code, message };
}

/** Benötigte Rechte je Übergang (eines davon genügt). */
function requiredPermissions(from: WorkOrderStatus, to: WorkOrderStatus): readonly Permission[] {
  if (to === 'completed') return ['workOrders.completeReview'];
  if (to === 'cancelled' || to === 'open' || to === 'picked_up') return ['workOrders.write'];
  if (to === 'in_progress' || (from === 'in_progress' && to === 'work_completed')) return ['workOrders.write', 'workItems.execute'];
  return ['workOrders.write'];
}

/**
 * Prüft einen Wechsel des Arbeitsstatus.
 * - `work_completed` nur, wenn alle ausführbaren Positionen `done`/`not_done` sind.
 * - `completed` nur aus `work_completed` mit Recht `workOrders.completeReview`
 *   (fachlicher Abschluss; nur dieser Übergang erzeugt Serviceeinträge).
 * - `cancelled` nur vor `completed`.
 * - Warnung `PENDING_APPROVAL_ITEMS`, wenn beim Erledigen/Abschließen noch Positionen auf
 *   eine Kundenentscheidung warten (diese werden dann nicht ausgeführt).
 */
export function canTransitionWorkOrder(from: WorkOrderStatus, to: WorkOrderStatus, ctx: WorkOrderTransitionContext): WorkOrderTransitionResult {
  if (from === to) return denied('SAME_STATUS', 'Der Auftrag hat diesen Status bereits.');
  if (!WORK_ORDER_TRANSITIONS[from].includes(to)) {
    const message =
      to === 'cancelled'
        ? 'Ein abgeschlossener Auftrag kann nicht mehr storniert werden.'
        : to === 'completed'
          ? 'Der fachliche Abschluss ist nur aus "Arbeiten erledigt" möglich.'
          : `Wechsel von ${from} nach ${to} ist nicht erlaubt.`;
    return denied('TRANSITION_NOT_ALLOWED', message);
  }
  const needed = requiredPermissions(from, to);
  if (!needed.some((p) => ctx.permissions.has(p))) {
    return denied('MISSING_PERMISSION', `Dafür fehlt die Berechtigung (${needed.join(' oder ')}).`);
  }
  if ((to === 'work_completed' || to === 'completed') && !allExecutableItemsFinished(ctx.items)) {
    return denied('ITEMS_NOT_FINISHED', 'Nicht alle ausführbaren Positionen sind erledigt oder als nicht durchgeführt markiert.');
  }
  if (from === 'work_completed' && to === 'in_progress' && allExecutableItemsFinished(ctx.items)) {
    return denied('NO_OPEN_ITEMS', 'Es gibt keine offene ausführbare Position; eine Wiederaufnahme ist nicht nötig.');
  }
  const warnings: WorkOrderTransitionWarning[] = [];
  if ((to === 'work_completed' || to === 'completed') && ctx.items.some((i) => i.authorization === 'pending_approval')) {
    warnings.push('PENDING_APPROVAL_ITEMS');
  }
  return { allowed: true, warnings };
}

/** Freigabestatus eines Auftrags mit Zählern. */
export interface ApprovalOverview {
  status: ApprovalOverviewStatus;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  withdrawnCount: number;
  draftCount: number;
}

/**
 * Freigabestatus aus den Freigabeanfragen eines Auftrags:
 * `pending`, wenn mindestens eine Anfrage auf den Kunden wartet; `decided`, wenn es gesendete
 * Anfragen gibt und alle entschieden sind; sonst `none`. Entwürfe und zurückgezogene Anfragen
 * zählen weder als wartend noch als entschieden.
 */
export function computeApprovalOverview(requests: readonly { status: ApprovalRequestStatus }[]): ApprovalOverview {
  const count = (s: ApprovalRequestStatus): number => requests.filter((r) => r.status === s).length;
  const pendingCount = count('pending_customer');
  const approvedCount = count('approved');
  const rejectedCount = count('rejected');
  const status: ApprovalOverviewStatus = pendingCount > 0 ? 'pending' : approvedCount + rejectedCount > 0 ? 'decided' : 'none';
  return { status, pendingCount, approvedCount, rejectedCount, withdrawnCount: count('withdrawn'), draftCount: count('draft') };
}

/**
 * Status-Dreiklang eines Auftrags (Arbeit, Freigabe, Zahlung) für Listen und Kopfzeilen.
 * Abholbereit ist ein Zeitstempel, kein Status; nach der Abholung nicht mehr abholbereit.
 *
 * @param input.today Heutiges Datum in Berlin (`YYYY-MM-DD`).
 */
export function computeStatusTriple(input: {
  workStatus: WorkOrderStatus;
  approvalRequests: readonly { status: ApprovalRequestStatus }[];
  invoices: readonly InvoiceWithPayments[];
  today: IsoDate;
  readyForPickupAt: string | null;
  pickedUpAt?: string | null;
}): StatusTriple {
  const approval = computeApprovalOverview(input.approvalRequests);
  const payment = aggregatePaymentStatus(input.invoices, input.today);
  const pickedUp = input.workStatus === 'picked_up' || (input.pickedUpAt ?? null) !== null;
  return {
    work: input.workStatus,
    approval: approval.status,
    payment: payment.status,
    overdue: payment.overdue,
    readyForPickup: input.readyForPickupAt !== null && !pickedUp && input.workStatus !== 'cancelled',
    pendingApprovalCount: approval.pendingCount,
  };
}
