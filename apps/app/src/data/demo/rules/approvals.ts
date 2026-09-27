/**
 * Versionierte Freigaben (R-FRG-1 bis R-FRG-6, AGENTS.md Regel 4 und 5).
 *
 * - Jede gesendete Version ist unveränderlich und trägt einen Inhalts-Hash.
 * - Eine Entscheidung gilt genau für die Version (versionId + contentHash), die der Kunde
 *   gesehen hat. Passt beides nicht zur aktuellen Version: 409 "Das Angebot wurde geändert".
 * - Änderung von Umfang oder Preis erzeugt eine neue Version; die alte Entscheidung gilt nicht.
 * - Nur das Kundenkonto des Auftragskunden entscheidet; Mitarbeiter (auch Mechaniker) nie.
 * - Ablehnung betrifft nur die Positionen dieser Anfrage.
 *
 * Platzhalter für @werkstatt/domain; reine Funktionen ohne Seiteneffekte.
 */
import type { ApprovalDecisionValue, ApprovalDraftInput, ApprovalLine, ClientChannel, Role } from '@werkstatt/contracts';
import { ApiError, ERROR_CODES } from '../../errors';
import type { DApprovalRequest, DApprovalVersion, DWorkItem } from '../model';
import { contentHash } from './hash';

export interface LineTotals {
  netCents: number;
  vatCents: number;
  grossCents: number;
}

export function lineTotals(line: Pick<ApprovalLine, 'quantity' | 'unitPriceCents' | 'vatRateBp'>): LineTotals {
  const netCents = Math.round(line.quantity * line.unitPriceCents);
  const vatCents = Math.round((netCents * line.vatRateBp) / 10_000);
  return { netCents, vatCents, grossCents: netCents + vatCents };
}

export function computeTotals(lines: readonly ApprovalLine[]): { netCents: number; grossCents: number } {
  return lines.reduce(
    (acc, line) => {
      const t = lineTotals(line);
      return { netCents: acc.netCents + t.netCents, grossCents: acc.grossCents + t.grossCents };
    },
    { netCents: 0, grossCents: 0 },
  );
}

export type ApprovalContent = Pick<
  ApprovalDraftInput,
  'kind' | 'title' | 'summaryCustomer' | 'lines' | 'scheduleChange' | 'newReadyAt' | 'photoIds' | 'documentVersionId'
>;

/** Hash über den kanonischen Inhalt, den der Kunde sieht (inkl. Summen und Versionsnummer). */
export function versionHash(requestId: string, versionNo: number, content: ApprovalContent): string {
  const totals = computeTotals(content.lines);
  return contentHash({
    requestId,
    versionNo,
    kind: content.kind,
    title: content.title,
    summaryCustomer: content.summaryCustomer,
    lines: content.lines.map((l) => ({
      title: l.title,
      description: l.description ?? null,
      quantity: l.quantity,
      unit: l.unit,
      unitPriceCents: l.unitPriceCents,
      vatRateBp: l.vatRateBp,
      maintenanceTypeId: l.maintenanceTypeId ?? null,
    })),
    totalNetCents: totals.netCents,
    totalGrossCents: totals.grossCents,
    currency: 'EUR',
    scheduleChange: content.scheduleChange ?? null,
    newReadyAt: content.newReadyAt ?? null,
    photoIds: content.photoIds ?? [],
    documentVersionId: content.documentVersionId ?? null,
  });
}

export function buildVersion(args: {
  id: string;
  requestId: string;
  versionNo: number;
  content: ApprovalContent;
  createdBy: string;
  sentAt: string | null;
}): DApprovalVersion {
  const totals = computeTotals(args.content.lines);
  return {
    id: args.id,
    versionNo: args.versionNo,
    summaryCustomer: args.content.summaryCustomer,
    lines: args.content.lines.map((l) => ({ ...l, description: l.description ?? null, maintenanceTypeId: l.maintenanceTypeId ?? null })),
    totalNetCents: totals.netCents,
    totalGrossCents: totals.grossCents,
    currency: 'EUR',
    scheduleChange: args.content.scheduleChange ?? null,
    newReadyAt: args.content.newReadyAt ?? null,
    photoIds: [...(args.content.photoIds ?? [])],
    documentVersionId: args.content.documentVersionId ?? null,
    contentHash: versionHash(args.requestId, args.versionNo, args.content),
    createdBy: args.createdBy,
    sentAt: args.sentAt,
    supersededAt: null,
    decision: null,
  };
}

export function currentVersion(request: DApprovalRequest): DApprovalVersion {
  const current = request.versions.reduce<DApprovalVersion | undefined>(
    (acc, v) => (!acc || v.versionNo > acc.versionNo ? v : acc),
    undefined,
  );
  if (!current) throw new Error(`Freigabeanfrage ${request.id} ohne Version`);
  return current;
}

export function createDraft(args: {
  id: string;
  versionId: string;
  workOrderId: string;
  draft: ApprovalDraftInput;
  createdBy: string;
  now: string;
}): DApprovalRequest {
  return {
    id: args.id,
    workOrderId: args.workOrderId,
    kind: args.draft.kind,
    title: args.draft.title,
    status: 'draft',
    findingId: args.draft.findingId ?? null,
    createdBy: args.createdBy,
    createdAt: args.now,
    versions: [
      buildVersion({ id: args.versionId, requestId: args.id, versionNo: 1, content: args.draft, createdBy: args.createdBy, sentAt: null }),
    ],
  };
}

/** Entwurf an den Kunden senden. Danach ist die Version unveränderlich. */
export function sendRequest(request: DApprovalRequest, now: string): DApprovalRequest {
  if (request.status !== 'draft') {
    throw ApiError.conflict(ERROR_CODES.conflict, 'Nur Entwürfe können gesendet werden.');
  }
  const current = currentVersion(request);
  return {
    ...request,
    status: 'pending_customer',
    versions: request.versions.map((v) => (v.id === current.id ? { ...v, sentAt: now } : v)),
  };
}

/**
 * Inhalt ändern. Entwurf: aktuelle (ungesendete) Version wird ersetzt.
 * Bereits gesendet oder entschieden: neue Version (sofort gesendet), alte wird "superseded",
 * ihre Entscheidung bleibt protokolliert, gilt aber nicht mehr.
 */
export function reviseRequest(
  request: DApprovalRequest,
  draft: ApprovalContent,
  args: { versionId: string; createdBy: string; now: string },
): DApprovalRequest {
  if (request.status === 'withdrawn') {
    throw ApiError.conflict(ERROR_CODES.conflict, 'Zurückgezogene Anfragen können nicht geändert werden.');
  }
  const current = currentVersion(request);
  if (request.status === 'draft') {
    const replaced = buildVersion({
      id: current.id,
      requestId: request.id,
      versionNo: current.versionNo,
      content: draft,
      createdBy: args.createdBy,
      sentAt: null,
    });
    return { ...request, title: draft.title, versions: request.versions.map((v) => (v.id === current.id ? replaced : v)) };
  }
  const next = buildVersion({
    id: args.versionId,
    requestId: request.id,
    versionNo: current.versionNo + 1,
    content: draft,
    createdBy: args.createdBy,
    sentAt: args.now,
  });
  return {
    ...request,
    title: draft.title,
    status: 'pending_customer',
    versions: [...request.versions.map((v) => (v.id === current.id ? { ...v, supersededAt: args.now } : v)), next],
  };
}

export function withdrawRequest(request: DApprovalRequest, now: string): DApprovalRequest {
  if (request.status !== 'draft' && request.status !== 'pending_customer') {
    throw ApiError.conflict(ERROR_CODES.conflict, 'Entschiedene Anfragen können nicht zurückgezogen werden.');
  }
  const current = currentVersion(request);
  return {
    ...request,
    status: 'withdrawn',
    versions: request.versions.map((v) => (v.id === current.id ? { ...v, supersededAt: now } : v)),
  };
}

export interface DecisionActor {
  userId: string;
  displayName: string;
  role: Role;
  /** verknüpfter Kundendatensatz (nur Kundenkonten) */
  customerId: string | null;
  accountActive: boolean;
}

export interface DecisionInput {
  versionId: string;
  contentHash: string;
  decision: ApprovalDecisionValue;
  comment?: string | null;
  channel: ClientChannel;
}

export function decide(
  request: DApprovalRequest,
  input: DecisionInput,
  actor: DecisionActor,
  workOrderCustomerId: string,
  args: { decisionId: string; now: string },
): DApprovalRequest {
  if (actor.role !== 'customer') {
    // Kein Mitarbeiter (auch nicht Admin oder Mechaniker) entscheidet für den Kunden.
    throw ApiError.forbidden('Nur der Kunde selbst kann Freigaben erteilen oder ablehnen.');
  }
  if (!actor.accountActive || actor.customerId !== workOrderCustomerId || request.status === 'draft') {
    throw ApiError.notFound();
  }
  if (request.status === 'withdrawn') {
    throw ApiError.conflict(ERROR_CODES.conflict, 'Die Werkstatt hat diese Anfrage zurückgezogen.');
  }
  const current = currentVersion(request);
  if (input.versionId !== current.id || input.contentHash !== current.contentHash) {
    throw ApiError.conflict(
      ERROR_CODES.approvalVersionOutdated,
      'Das Angebot wurde geändert. Bitte prüfen Sie die neue Version und entscheiden Sie erneut.',
      { currentVersionId: current.id, currentVersionNo: current.versionNo },
    );
  }
  if (current.decision || request.status !== 'pending_customer') {
    throw ApiError.conflict(ERROR_CODES.approvalAlreadyDecided, 'Zu dieser Version liegt bereits eine Entscheidung vor.');
  }
  const decision = {
    id: args.decisionId,
    versionId: current.id,
    decision: input.decision,
    decidedByUserId: actor.userId,
    decidedByDisplayName: actor.displayName,
    customerId: workOrderCustomerId,
    decidedAt: args.now,
    contentHash: current.contentHash,
    channel: input.channel,
    comment: input.comment ?? null,
  };
  return {
    ...request,
    status: input.decision === 'approved' ? 'approved' : 'rejected',
    versions: request.versions.map((v) => (v.id === current.id ? { ...v, decision } : v)),
  };
}

/**
 * Überträgt die Entscheidung auf die Positionen genau dieser Anfrage.
 * Abgelehnte Positionen werden nicht ausgeführt (not_done) und gelangen nie in die Historie.
 */
export function applyDecisionToItems(
  items: readonly DWorkItem[],
  requestId: string,
  decision: ApprovalDecisionValue,
  versionId: string,
): DWorkItem[] {
  return items.map((item) => {
    if (item.approvalRequestId !== requestId) return item;
    if (decision === 'approved') return { ...item, authorization: 'approved', approvedVersionId: versionId };
    return { ...item, authorization: 'rejected', approvedVersionId: null, executionStatus: 'not_done' };
  });
}

/**
 * Positionen einer Anfrage an deren aktuelle Version angleichen (nach Anlage oder Änderung).
 * Noch nicht begonnene Positionen der Anfrage werden ersetzt; alle warten auf Freigabe.
 */
export function syncItemsWithVersion(
  items: readonly DWorkItem[],
  request: DApprovalRequest,
  newItemId: () => string,
): DWorkItem[] {
  const version = currentVersion(request);
  const kept = items.filter((i) => i.approvalRequestId !== request.id || i.executionStatus === 'done');
  const workOrderItems = kept.filter((i) => i.workOrderId === request.workOrderId);
  let position = workOrderItems.reduce((max, i) => Math.max(max, i.position), 0);
  const authorization = request.status === 'withdrawn' ? 'withdrawn' : 'pending_approval';
  const created: DWorkItem[] = version.lines.map((line) => ({
    id: newItemId(),
    workOrderId: request.workOrderId,
    position: ++position,
    kind: 'flat_rate',
    title: line.title,
    description: line.description ?? null,
    maintenanceTypeId: line.maintenanceTypeId ?? null,
    intervalKm: null,
    intervalMonths: null,
    quantity: line.quantity,
    unit: line.unit,
    unitPriceCents: line.unitPriceCents,
    vatRateBp: line.vatRateBp,
    origin: request.kind === 'offer' ? 'offer' : 'additional',
    authorization,
    executionStatus: 'planned',
    approvalRequestId: request.id,
    approvedVersionId: null,
    assignedTo: null,
    doneAt: null,
    doneBy: null,
    doneOdometerKm: null,
    resultNotes: null,
    trackedMinutes: 0,
    runningSince: null,
    parts: [],
  }));
  return [...kept, ...created];
}

export function withdrawItems(items: readonly DWorkItem[], requestId: string): DWorkItem[] {
  return items.map((i) =>
    i.approvalRequestId === requestId && i.executionStatus !== 'done' ? { ...i, authorization: 'withdrawn' } : i,
  );
}
