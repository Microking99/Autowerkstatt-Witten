/**
 * Versionierte Freigaben im Demo-Modus (R-FRG-1 bis R-FRG-6, AGENTS.md Regel 4 und 5).
 *
 * Die Regeln kommen aus @werkstatt/domain (wie in der API): Inhalts-Hash
 * (`hashApprovalContent`), Summen (`calculateTotals`), Versionen (`reviseApproval`,
 * `sendApproval`), Entscheidung (`validateDecision`, `applyDecision`), Rückzug
 * (`withdrawApproval`) und das Zurücksetzen der Positionen bei neuer Version
 * (`resetItemsForNewVersion`). Diese Datei übersetzt nur zwischen dem Demo-Zustand und den
 * Domain-Funktionen und wirft `ApiError` mit denselben Codes wie die API.
 */
import { API_ERROR_CODES, apiCodeFromDomain, type ApprovalDecisionValue, type ApprovalDraftInput, type ApprovalLine, type ClientChannel, type Role } from '@werkstatt/contracts';
import {
  applyDecision,
  calculateTotals,
  canonicalApprovalContent,
  computeContentHash,
  createActor,
  resetItemsForNewVersion,
  reviseApproval,
  sendApproval,
  validateDecision,
  withdrawApproval,
  type ApprovalContentInput,
} from '@werkstatt/domain';
import { ApiError } from '../../errors';
import type { DApprovalRequest, DApprovalVersion, DWorkItem } from '../model';

export interface LineTotals {
  netCents: number;
  vatCents: number;
  grossCents: number;
}

/** Summen einer Zeile (Domain-Rundung). */
export function lineTotals(line: Pick<ApprovalLine, 'quantity' | 'unitPriceCents' | 'vatRateBp'>): LineTotals {
  const t = calculateTotals([line]);
  return { netCents: t.totalNetCents, vatCents: t.totalVatCents, grossCents: t.totalGrossCents };
}

/** Summen aller Zeilen: Netto je Zeile, USt je Satz einmal gerundet (Domain `calculateTotals`). */
export function computeTotals(lines: readonly ApprovalLine[]): { netCents: number; grossCents: number } {
  const t = calculateTotals(lines);
  return { netCents: t.totalNetCents, grossCents: t.totalGrossCents };
}

export type ApprovalContent = Pick<
  ApprovalDraftInput,
  'kind' | 'title' | 'summaryCustomer' | 'lines' | 'scheduleChange' | 'newReadyAt' | 'photoIds' | 'documentVersionId'
>;

function contentInput(content: ApprovalContent): ApprovalContentInput {
  return {
    summaryCustomer: content.summaryCustomer,
    lines: content.lines.map((l) => ({ ...l, description: l.description ?? null, maintenanceTypeId: l.maintenanceTypeId ?? null })),
    scheduleChange: content.scheduleChange ?? null,
    newReadyAt: content.newReadyAt ?? null,
    photoIds: content.photoIds ?? [],
    documentVersionId: content.documentVersionId ?? null,
  };
}

/** Inhalts-Hash wie in der API (`computeContentHash` über den kanonischen Inhalt). */
export function versionHash(content: ApprovalContent): string {
  try {
    return computeContentHash(canonicalApprovalContent(contentInput(content)));
  } catch (e) {
    throw ApiError.unprocessable(API_ERROR_CODES.invalidContent, e instanceof Error ? e.message : 'Ungültiger Inhalt.');
  }
}

export function buildVersion(args: {
  id: string;
  requestId: string;
  versionNo: number;
  content: ApprovalContent;
  createdBy: string;
  sentAt: string | null;
}): DApprovalVersion {
  let canonical;
  try {
    canonical = canonicalApprovalContent(contentInput(args.content));
  } catch (e) {
    throw ApiError.unprocessable(API_ERROR_CODES.invalidContent, e instanceof Error ? e.message : 'Ungültiger Inhalt.');
  }
  return {
    id: args.id,
    versionNo: args.versionNo,
    summaryCustomer: args.content.summaryCustomer.trim(),
    lines: args.content.lines.map((l) => ({ ...l, description: l.description ?? null, maintenanceTypeId: l.maintenanceTypeId ?? null })),
    totalNetCents: canonical.totalNetCents,
    totalGrossCents: canonical.totalGrossCents,
    currency: 'EUR',
    scheduleChange: args.content.scheduleChange ?? null,
    newReadyAt: args.content.newReadyAt ?? null,
    photoIds: [...(args.content.photoIds ?? [])],
    documentVersionId: args.content.documentVersionId ?? null,
    contentHash: computeContentHash(canonical),
    createdBy: args.createdBy,
    sentAt: args.sentAt,
    supersededAt: null,
    decision: null,
  };
}

export function currentVersion(request: DApprovalRequest): DApprovalVersion {
  const current = request.versions.reduce<DApprovalVersion | undefined>((acc, v) => (!acc || v.versionNo > acc.versionNo ? v : acc), undefined);
  if (!current) throw new Error(`Freigabeanfrage ${request.id} ohne Version`);
  return current;
}

export function createDraft(args: { id: string; versionId: string; workOrderId: string; draft: ApprovalDraftInput; createdBy: string; now: string }): DApprovalRequest {
  return {
    id: args.id,
    workOrderId: args.workOrderId,
    kind: args.draft.kind,
    title: args.draft.title,
    status: 'draft',
    findingId: args.draft.findingId ?? null,
    createdBy: args.createdBy,
    createdAt: args.now,
    versions: [buildVersion({ id: args.versionId, requestId: args.id, versionNo: 1, content: args.draft, createdBy: args.createdBy, sentAt: null })],
  };
}

const versionState = (v: DApprovalVersion) => ({ id: v.id, versionNo: v.versionNo, contentHash: v.contentHash, sentAt: v.sentAt, supersededAt: v.supersededAt });

/** Entwurf an den Kunden senden (Domain `sendApproval`). Danach ist die Version unveränderlich. */
export function sendRequest(request: DApprovalRequest, now: string): DApprovalRequest {
  const current = currentVersion(request);
  const result = sendApproval({ id: request.id, status: request.status }, versionState(current), new Date(now));
  if (!result.ok) throw ApiError.conflict(apiCodeFromDomain(result.error.code), result.error.message);
  return { ...request, status: result.value.requestStatus, versions: request.versions.map((v) => (v.id === current.id ? { ...v, sentAt: result.value.sentAt } : v)) };
}

/**
 * Inhalt ändern (Domain `reviseApproval`): Entwurf wird ersetzt; gesendete Anfrage erhält eine
 * neue Version (sofort gesendet), die alte wird ersetzt und ihre Entscheidung gilt nicht mehr.
 * Unveränderter Inhalt erzeugt keine neue Version.
 */
export function reviseRequest(request: DApprovalRequest, draft: ApprovalContent, args: { versionId: string; createdBy: string; now: string }): DApprovalRequest {
  const current = currentVersion(request);
  let outcome;
  try {
    outcome = reviseApproval({ id: request.id, status: request.status }, versionState(current), contentInput(draft), new Date(args.now));
  } catch (e) {
    throw ApiError.unprocessable(API_ERROR_CODES.invalidContent, e instanceof Error ? e.message : 'Ungültiger Inhalt.');
  }
  if (!outcome.ok) throw ApiError.conflict(apiCodeFromDomain(outcome.error.code), outcome.error.message);
  const result = outcome.value;
  if (result.kind === 'unchanged') return { ...request, title: draft.title };
  if (result.kind === 'draft_updated') {
    const replaced = buildVersion({ id: current.id, requestId: request.id, versionNo: current.versionNo, content: draft, createdBy: args.createdBy, sentAt: null });
    return { ...request, title: draft.title, versions: request.versions.map((v) => (v.id === current.id ? replaced : v)) };
  }
  const next = buildVersion({ id: args.versionId, requestId: request.id, versionNo: result.newVersion.versionNo, content: draft, createdBy: args.createdBy, sentAt: args.now });
  return {
    ...request,
    title: draft.title,
    status: result.requestStatus,
    versions: [...request.versions.map((v) => (v.id === result.supersede.versionId ? { ...v, supersededAt: result.supersede.supersededAt } : v)), next],
  };
}

/** Zurückziehen (Domain `withdrawApproval`); wartende Positionen werden `withdrawn`. */
export function withdrawRequest(request: DApprovalRequest, now: string, items: readonly DWorkItem[] = []): { request: DApprovalRequest; items: DWorkItem[] } {
  const result = withdrawApproval({ id: request.id, status: request.status }, items);
  if (!result.ok) throw ApiError.conflict(apiCodeFromDomain(result.error.code), result.error.message);
  const current = currentVersion(request);
  return {
    request: { ...request, status: 'withdrawn', versions: request.versions.map((v) => (v.id === current.id && !v.supersededAt ? { ...v, supersededAt: now } : v)) },
    items: result.value.items,
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

/**
 * Kundenentscheidung zur angezeigten Version (Domain `validateDecision`): Nur der Kunde des
 * Auftrags mit aktivem Konto; Mitarbeiter nie (403), fremde Kunden 404; veraltete Version
 * oder abweichender Hash 409 (`version_superseded` bzw. `hash_mismatch`).
 */
export function decide(request: DApprovalRequest, input: DecisionInput, actor: DecisionActor, workOrderCustomerId: string, args: { decisionId: string; now: string }): DApprovalRequest {
  const current = currentVersion(request);
  const domainActor = createActor({ userId: actor.userId, role: actor.role, status: actor.accountActive ? 'active' : 'disabled', customerId: actor.customerId });
  const check = validateDecision({
    request: { id: request.id, status: request.status, currentVersionId: current.id },
    currentVersion: { id: current.id, contentHash: current.contentHash, sentAt: current.sentAt, supersededAt: current.supersededAt },
    submittedVersionId: input.versionId,
    submittedHash: input.contentHash,
    actor: domainActor,
    workOrderCustomerId,
    alreadyDecided: current.decision !== null,
  });
  if (!check.ok) {
    if (check.notFound) throw ApiError.notFound();
    if (check.code === 'NOT_CUSTOMER') throw new ApiError(403, API_ERROR_CODES.notCustomer, 'Nur der Kunde selbst kann Freigaben erteilen oder ablehnen.');
    // Entwürfe sind für Kunden unsichtbar (wie nicht vorhanden)
    if (request.status === 'draft') throw ApiError.notFound();
    throw ApiError.conflict(apiCodeFromDomain(check.code), check.message, { currentVersionId: current.id, currentVersionNo: current.versionNo });
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
 * Entscheidung auf die Positionen genau dieser Anfrage übertragen (Domain `applyDecision`).
 * Abgelehnte Positionen werden nicht ausgeführt und gelangen nie in die Servicehistorie.
 */
export function applyDecisionToItems(items: readonly DWorkItem[], requestId: string, decision: ApprovalDecisionValue, versionId: string): DWorkItem[] {
  // Abgelehnte Positionen bleiben "geplant", sind aber gesperrt und zählen nicht (wie in der API).
  return applyDecision(items, requestId, decision, versionId).items;
}

/**
 * Positionen einer Anfrage an deren aktuelle Version angleichen, wie die API
 * (`syncItemsWithVersion`): Positionen entstehen beim Senden; Zeile i ↔ i-te Position der
 * Anfrage. Bei neuer Version gehen nicht abgeschlossene Positionen zurück auf "wartet"
 * (Domain `resetItemsForNewVersion`), überzählige werden zurückgezogen.
 */
export function syncItemsWithVersion(items: readonly DWorkItem[], request: DApprovalRequest, newItemId: () => string, options: { newVersion?: boolean } = {}): DWorkItem[] {
  const version = currentVersion(request);
  let all = [...items];
  if (options.newVersion) {
    all = resetItemsForNewVersion(all, request.id).items.map((i) =>
      i.approvalRequestId === request.id && i.authorization === 'pending_approval' && i.runningSince ? { ...i, runningSince: null } : i,
    );
  }
  const own = all.filter((i) => i.approvalRequestId === request.id).sort((a, b) => a.position - b.position);
  let position = all.filter((i) => i.workOrderId === request.workOrderId).reduce((max, i) => Math.max(max, i.position), 0);
  const origin = request.kind === 'offer' ? 'offer' : 'additional';
  const created: DWorkItem[] = [];
  const updates = new Map<string, DWorkItem>();
  version.lines.forEach((line, index) => {
    const content = {
      title: line.title,
      description: line.description ?? null,
      quantity: line.quantity,
      unit: line.unit,
      unitPriceCents: line.unitPriceCents,
      vatRateBp: line.vatRateBp,
      maintenanceTypeId: line.maintenanceTypeId ?? null,
    };
    const existing = own[index];
    if (existing) {
      if (existing.executionStatus === 'done' || existing.executionStatus === 'not_done') return;
      updates.set(existing.id, { ...existing, ...content, authorization: existing.authorization === 'withdrawn' ? 'pending_approval' : existing.authorization });
      return;
    }
    created.push({
      id: newItemId(),
      workOrderId: request.workOrderId,
      position: ++position,
      kind: 'other',
      ...content,
      intervalKm: null,
      intervalMonths: null,
      origin,
      authorization: 'pending_approval',
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
    });
  });
  for (const surplus of own.slice(version.lines.length)) {
    if (surplus.executionStatus === 'done' || surplus.executionStatus === 'not_done') continue;
    updates.set(surplus.id, { ...surplus, authorization: 'withdrawn', approvedVersionId: null });
  }
  return [...all.map((i) => updates.get(i.id) ?? i), ...created];
}
