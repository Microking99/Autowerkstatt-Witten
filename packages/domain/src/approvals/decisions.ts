/**
 * Kundenentscheidungen zu Freigabeanfragen und ihre Wirkung auf Positionen.
 */
import type { ApprovalDecisionValue, ApprovalRequestStatus, WorkItemAuthorization, WorkItemExecutionStatus } from '@werkstatt/contracts';
import { fail, ok, type DomainIssue, type Result } from '../common/result';
import type { Actor } from '../permissions/actor';
import { canDecideApproval } from '../permissions/objectRules';

export type DecisionErrorCode = 'NOT_CUSTOMER' | 'NOT_PENDING' | 'VERSION_SUPERSEDED' | 'HASH_MISMATCH' | 'ALREADY_DECIDED' | 'WITHDRAWN';

export interface ValidateDecisionInput {
  request: { id: string; status: ApprovalRequestStatus; currentVersionId: string };
  currentVersion: { id: string; contentHash: string; sentAt: string | null; supersededAt: string | null };
  /** Version, die dem Kunden angezeigt wurde. */
  submittedVersionId: string;
  /** Hash der angezeigten Version. */
  submittedHash: string;
  actor: Actor;
  /** Auftraggeber des Auftrags, zu dem die Anfrage gehört. */
  workOrderCustomerId: string;
  /** Für die aktuelle Version existiert bereits eine Entscheidung (`approval_decisions`). */
  alreadyDecided: boolean;
}

export type ValidateDecisionResult =
  | { ok: true; versionId: string; contentHash: string }
  | { ok: false; code: DecisionErrorCode; message: string; notFound: boolean };

/**
 * Prüft eine Kundenentscheidung. Reihenfolge:
 * 1. `NOT_CUSTOMER`: nur der Kunde des Auftrags mit aktivem Konto (Mitarbeiter, Admin,
 *    Mechaniker nie). Für fremde Kunden `notFound: true` (API: 404).
 * 2. `WITHDRAWN`: Anfrage zurückgezogen.
 * 3. `VERSION_SUPERSEDED`: angezeigte Version ist nicht (mehr) die aktuelle.
 * 4. `ALREADY_DECIDED`: aktuelle Version ist schon entschieden (keine zweite Entscheidung).
 * 5. `NOT_PENDING`: Anfrage wartet nicht auf den Kunden (z. B. Entwurf).
 * 6. `HASH_MISMATCH`: Hash passt nicht zur aktuellen Version.
 * Die API antwortet bei 2–6 mit 409.
 */
export function validateDecision(input: ValidateDecisionInput): ValidateDecisionResult {
  const { request, currentVersion, actor } = input;
  const who = canDecideApproval(actor, { workOrderCustomerId: input.workOrderCustomerId });
  if (!who.allowed) {
    return { ok: false, code: 'NOT_CUSTOMER', message: 'Nur der Kunde des Auftrags kann diese Anfrage entscheiden.', notFound: who.notFound };
  }
  const bad = (code: DecisionErrorCode, message: string): ValidateDecisionResult => ({ ok: false, code, message, notFound: false });
  if (request.status === 'withdrawn') return bad('WITHDRAWN', 'Die Werkstatt hat diese Anfrage zurückgezogen.');
  if (
    input.submittedVersionId !== currentVersion.id ||
    request.currentVersionId !== currentVersion.id ||
    currentVersion.supersededAt !== null
  ) {
    return bad('VERSION_SUPERSEDED', 'Die Anfrage wurde geändert. Bitte die aktuelle Fassung prüfen und neu entscheiden.');
  }
  if (input.alreadyDecided || request.status === 'approved' || request.status === 'rejected') {
    return bad('ALREADY_DECIDED', 'Zu dieser Fassung liegt bereits eine Entscheidung vor.');
  }
  if (request.status !== 'pending_customer' || currentVersion.sentAt === null) {
    return bad('NOT_PENDING', 'Diese Anfrage wartet nicht auf eine Entscheidung.');
  }
  if (input.submittedHash.trim().toLowerCase() !== currentVersion.contentHash.toLowerCase()) {
    return bad('HASH_MISMATCH', 'Der angezeigte Inhalt stimmt nicht mit der aktuellen Fassung überein.');
  }
  return { ok: true, versionId: currentVersion.id, contentHash: currentVersion.contentHash };
}

/** Status der Anfrage nach einer Entscheidung. */
export function requestStatusAfterDecision(decision: ApprovalDecisionValue): 'approved' | 'rejected' {
  return decision === 'approved' ? 'approved' : 'rejected';
}

/** Position mit Bezug zu einer Freigabeanfrage. */
export interface AuthorizableItem {
  id: string;
  approvalRequestId: string | null;
  authorization: WorkItemAuthorization;
  approvedVersionId?: string | null;
  executionStatus?: WorkItemExecutionStatus;
}

export interface AuthorizationChange {
  itemId: string;
  from: WorkItemAuthorization;
  to: WorkItemAuthorization;
}

/**
 * Wendet eine (vorher mit {@link validateDecision} geprüfte) Entscheidung an: Positionen
 * DIESER Anfrage im Status `pending_approval` werden `approved` (mit `approvedVersionId`)
 * bzw. `rejected`. Alle anderen Positionen, auch aus anderen Anfragen oder vereinbarte,
 * bleiben unverändert (R-FRG-5).
 */
export function applyDecision<T extends AuthorizableItem>(
  items: readonly T[],
  requestId: string,
  decision: ApprovalDecisionValue,
  versionId: string,
): { items: T[]; changes: AuthorizationChange[] } {
  const changes: AuthorizationChange[] = [];
  const next = items.map((item) => {
    if (item.approvalRequestId !== requestId || item.authorization !== 'pending_approval') return item;
    const to: WorkItemAuthorization = decision === 'approved' ? 'approved' : 'rejected';
    changes.push({ itemId: item.id, from: item.authorization, to });
    return { ...item, authorization: to, approvedVersionId: decision === 'approved' ? versionId : null };
  });
  return { items: next, changes };
}

/**
 * Nach einer neuen Version: Positionen dieser Anfrage, die noch nicht abgeschlossen sind
 * (`planned`, `paused`, `in_progress`), brauchen eine neue Entscheidung und werden wieder
 * `pending_approval`; laufende werden dabei pausiert. Bereits erledigte oder als nicht
 * durchgeführt markierte Positionen behalten ihren Stand (die alte Entscheidung verfällt nicht
 * rückwirkend). Zurückgezogene bleiben zurückgezogen.
 */
export function resetItemsForNewVersion<T extends AuthorizableItem>(
  items: readonly T[],
  requestId: string,
): { items: T[]; changes: AuthorizationChange[]; pausedItemIds: string[] } {
  const changes: AuthorizationChange[] = [];
  const pausedItemIds: string[] = [];
  const next = items.map((item) => {
    if (item.approvalRequestId !== requestId || item.authorization === 'withdrawn') return item;
    const status = item.executionStatus ?? 'planned';
    if (status === 'done' || status === 'not_done') return item;
    if (item.authorization === 'pending_approval') return item;
    changes.push({ itemId: item.id, from: item.authorization, to: 'pending_approval' });
    if (status === 'in_progress') pausedItemIds.push(item.id);
    return {
      ...item,
      authorization: 'pending_approval' as const,
      approvedVersionId: null,
      ...(status === 'in_progress' ? { executionStatus: 'paused' as const } : {}),
    };
  });
  return { items: next, changes, pausedItemIds };
}

/**
 * Anfrage zurückziehen (nur `draft` oder `pending_customer`). Wartende Positionen dieser
 * Anfrage werden `withdrawn` und damit nie ausgeführt.
 */
export function withdrawApproval<T extends AuthorizableItem>(
  request: { id: string; status: ApprovalRequestStatus },
  items: readonly T[],
): Result<{ requestStatus: 'withdrawn'; items: T[]; changes: AuthorizationChange[] }, DomainIssue<'ALREADY_DECIDED' | 'ALREADY_WITHDRAWN'>> {
  if (request.status === 'withdrawn') return fail('ALREADY_WITHDRAWN', 'Die Anfrage ist bereits zurückgezogen.');
  if (request.status === 'approved' || request.status === 'rejected') {
    return fail('ALREADY_DECIDED', 'Eine entschiedene Anfrage kann nicht zurückgezogen werden.');
  }
  const changes: AuthorizationChange[] = [];
  const next = items.map((item) => {
    if (item.approvalRequestId !== request.id || item.authorization !== 'pending_approval') return item;
    changes.push({ itemId: item.id, from: item.authorization, to: 'withdrawn' });
    return { ...item, authorization: 'withdrawn' as const };
  });
  return ok({ requestStatus: 'withdrawn', items: next, changes });
}
