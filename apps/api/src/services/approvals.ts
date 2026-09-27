/**
 * Freigabeanfragen: DTO-Aufbau und Abgleich der Auftragspositionen mit der aktuellen Version.
 * Versionen sind nach dem Senden unveränderlich; Regeln (Hash, neue Version, Entscheidung)
 * liegen in packages/domain/src/approvals.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { ApprovalRequest, ApprovalVersion } from '@werkstatt/contracts';
import { redactApprovalRequestForActor, resetItemsForNewVersion, type Actor, type NewApprovalVersion } from '@werkstatt/domain';
import type { DbOrTx } from '../db/index';
import { approvalDecisions, approvalRequests, approvalVersions, users, workItems, type ApprovalLineSnapshot } from '../db/schema/index';
import { closeTimeEntries } from './workOrderOps';

export type ApprovalRequestRow = typeof approvalRequests.$inferSelect;
export type ApprovalVersionRow = typeof approvalVersions.$inferSelect;

export async function toApprovalDtos(db: DbOrTx, requests: ApprovalRequestRow[], actor: Actor): Promise<ApprovalRequest[]> {
  if (requests.length === 0) return [];
  const versions = await db
    .select()
    .from(approvalVersions)
    .where(inArray(approvalVersions.requestId, requests.map((r) => r.id)))
    .orderBy(asc(approvalVersions.versionNo));
  const decisions =
    versions.length > 0 ? await db.select().from(approvalDecisions).where(inArray(approvalDecisions.versionId, versions.map((v) => v.id))) : [];
  const deciderIds = [...new Set(decisions.map((d) => d.decidedByUserId))];
  const deciders = deciderIds.length > 0 ? await db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, deciderIds)) : [];

  const versionDto = (v: ApprovalVersionRow): ApprovalVersion => {
    const d = decisions.find((x) => x.versionId === v.id);
    return {
      id: v.id,
      versionNo: v.versionNo,
      summaryCustomer: v.summaryCustomer,
      lines: v.items.map((l) => ({
        title: l.title,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unitPriceCents: l.unitPriceCents,
        vatRateBp: l.vatRateBp,
        maintenanceTypeId: l.maintenanceTypeId,
      })),
      totalNetCents: v.totalNetCents,
      totalGrossCents: v.totalGrossCents,
      currency: 'EUR',
      scheduleChange: v.scheduleChange,
      newReadyAt: v.newReadyAt ? v.newReadyAt.toISOString() : null,
      photoIds: v.photoIds,
      documentVersionId: v.documentVersionId,
      contentHash: v.contentHash,
      sentAt: v.sentAt ? v.sentAt.toISOString() : null,
      supersededAt: v.supersededAt ? v.supersededAt.toISOString() : null,
      decision: d
        ? {
            id: d.id,
            versionId: d.versionId,
            decision: d.decision,
            decidedByDisplayName: deciders.find((x) => x.id === d.decidedByUserId)?.displayName ?? '',
            decidedAt: d.decidedAt.toISOString(),
            contentHash: d.contentHash,
            channel: d.channel,
            comment: d.comment,
          }
        : null,
    };
  };

  return requests.map((r) => {
    const own = versions.filter((v) => v.requestId === r.id);
    const current = own.find((v) => v.id === r.currentVersionId) ?? own[own.length - 1]!;
    const dto: ApprovalRequest = {
      id: r.id,
      workOrderId: r.workOrderId,
      kind: r.kind,
      title: r.title,
      status: r.status,
      currentVersion: versionDto(current),
      versions: own.map(versionDto),
      findingId: r.findingId,
      createdAt: r.createdAt.toISOString(),
    };
    return redactApprovalRequestForActor(dto, actor);
  });
}

/** Werte einer (neuen) Version für die Tabelle approval_versions. */
export function versionValues(requestId: string, v: NewApprovalVersion, createdBy: string) {
  const lines: ApprovalLineSnapshot[] = v.content.lines.map((l) => ({
    title: l.title,
    description: l.description,
    quantity: Number(l.quantity),
    unit: l.unit,
    unitPriceCents: l.unitPriceCents,
    vatRateBp: l.vatRateBp,
    maintenanceTypeId: l.maintenanceTypeId,
  }));
  return {
    requestId,
    versionNo: v.versionNo,
    summaryCustomer: v.content.summaryCustomer,
    items: lines,
    totalNetCents: v.totalNetCents,
    totalGrossCents: v.totalGrossCents,
    currency: 'EUR',
    scheduleChange: v.content.scheduleChange,
    newReadyAt: v.content.newReadyAt ? new Date(v.content.newReadyAt) : null,
    photoIds: v.content.photoIds,
    documentVersionId: v.content.documentVersionId,
    contentHash: v.contentHash,
    createdBy,
    sentAt: v.sentAt ? new Date(v.sentAt) : null,
  };
}

/**
 * Gleicht die Auftragspositionen einer Anfrage mit den Zeilen der aktuellen (gesendeten)
 * Version ab: Zeile i ↔ i-te Position der Anfrage. Neue Zeilen werden neue Positionen
 * (`pending_approval`), überzählige, nicht abgeschlossene Positionen `withdrawn`.
 * Bei einer neuen Version setzt die Geschäftslogik (`resetItemsForNewVersion`) bereits
 * entschiedene, nicht abgeschlossene Positionen zurück auf `pending_approval`.
 */
export async function syncItemsWithVersion(
  tx: DbOrTx,
  input: { request: ApprovalRequestRow; lines: ApprovalLineSnapshot[]; newVersion: boolean; now: Date },
): Promise<void> {
  const { request, lines, now } = input;
  const existing = await tx
    .select()
    .from(workItems)
    .where(eq(workItems.approvalRequestId, request.id))
    .orderBy(asc(workItems.position));
  if (input.newVersion && existing.length > 0) {
    const { changes, pausedItemIds } = resetItemsForNewVersion(
      existing.map((i) => ({ id: i.id, approvalRequestId: i.approvalRequestId, authorization: i.authorization, approvedVersionId: i.approvedVersionId, executionStatus: i.executionStatus })),
      request.id,
    );
    for (const c of changes) {
      await tx
        .update(workItems)
        .set({ authorization: c.to, approvedVersionId: null, ...(pausedItemIds.includes(c.itemId) ? { executionStatus: 'paused' as const } : {}) })
        .where(eq(workItems.id, c.itemId));
      if (pausedItemIds.includes(c.itemId)) await closeTimeEntries(tx, c.itemId, now);
    }
  }
  const origin = request.kind === 'offer' ? ('offer' as const) : ('additional' as const);
  const [max] = await tx
    .select({ n: sql<number>`coalesce(max(${workItems.position}), 0)::int` })
    .from(workItems)
    .where(eq(workItems.workOrderId, request.workOrderId));
  let nextPosition = (max?.n ?? 0) + 1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const item = existing[i];
    const content = {
      title: line.title,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitPriceCents: line.unitPriceCents,
      vatRateBp: line.vatRateBp,
      maintenanceTypeId: line.maintenanceTypeId,
    };
    if (item) {
      if (item.executionStatus === 'done' || item.executionStatus === 'not_done') continue;
      await tx
        .update(workItems)
        .set({ ...content, ...(item.authorization === 'withdrawn' ? { authorization: 'pending_approval' as const } : {}) })
        .where(eq(workItems.id, item.id));
    } else {
      await tx.insert(workItems).values({
        workOrderId: request.workOrderId,
        position: nextPosition++,
        kind: 'other',
        ...content,
        origin,
        authorization: 'pending_approval',
        approvalRequestId: request.id,
      });
    }
  }
  for (const surplus of existing.slice(lines.length)) {
    if (surplus.executionStatus === 'done' || surplus.executionStatus === 'not_done') continue;
    await tx
      .update(workItems)
      .set({ authorization: 'withdrawn', approvedVersionId: null })
      .where(and(eq(workItems.id, surplus.id)));
  }
}
