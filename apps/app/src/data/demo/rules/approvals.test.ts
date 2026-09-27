import type { ApprovalDraftInput } from '@werkstatt/contracts';
import { describe, expect, it } from 'vitest';
import { ApiError, ERROR_CODES } from '../../errors';
import type { DWorkItem } from '../model';
import {
  applyDecisionToItems,
  computeTotals,
  createDraft,
  currentVersion,
  decide,
  reviseRequest,
  sendRequest,
  syncItemsWithVersion,
  withdrawRequest,
  type DecisionActor,
} from './approvals';

let n = 0;
const nextId = () => `00000000-0000-4000-8000-${(++n).toString().padStart(12, '0')}`;
const NOW = '2026-09-26T10:00:00.000Z';
const CUSTOMER = 'kunde-1';

const draft: ApprovalDraftInput = {
  kind: 'additional_work',
  title: 'Bremsen vorne',
  summaryCustomer: 'Beläge und Scheiben vorne erneuern.',
  lines: [
    { title: 'Bremsscheiben vorne', description: null, quantity: 1, unit: 'Paar', unitPriceCents: 12_840, vatRateBp: 1900, maintenanceTypeId: null },
    { title: 'Arbeitszeit', description: null, quantity: 1.2, unit: 'Std.', unitPriceCents: 7_800, vatRateBp: 1900, maintenanceTypeId: null },
  ],
  photoIds: [],
};

const customer: DecisionActor = { userId: 'u-kunde', displayName: 'Miriam Kowalczyk', role: 'customer', customerId: CUSTOMER, accountActive: true };

function sentRequest() {
  const req = createDraft({ id: 'req-1', versionId: nextId(), workOrderId: 'wo-1', draft, createdBy: 'u-service', now: NOW });
  return sendRequest(req, NOW);
}

function expectApiError(fn: () => unknown, status: number, code?: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).status).toBe(status);
    if (code) expect((e as ApiError).code).toBe(code);
    return;
  }
  throw new Error('Erwarteter Fehler blieb aus');
}

describe('Freigaben: Bindung an Version und Inhalts-Hash (Regel 4)', () => {
  it('berechnet Summen in Cent mit USt je Zeile', () => {
    expect(computeTotals(draft.lines)).toEqual({ netCents: 12_840 + 9_360, grossCents: 15_280 + 11_138 });
  });

  it('akzeptiert eine Entscheidung zur aktuellen Version mit passendem Hash', () => {
    const req = sentRequest();
    const v = currentVersion(req);
    const decided = decide(req, { versionId: v.id, contentHash: v.contentHash, decision: 'approved', channel: 'web' }, customer, CUSTOMER, { decisionId: nextId(), now: NOW });
    expect(decided.status).toBe('approved');
    expect(currentVersion(decided).decision?.contentHash).toBe(v.contentHash);
    expect(currentVersion(decided).decision?.decidedByDisplayName).toBe('Miriam Kowalczyk');
  });

  it('lehnt einen abweichenden Hash mit 409 "Das Angebot wurde geändert" ab', () => {
    const req = sentRequest();
    const v = currentVersion(req);
    expectApiError(
      () => decide(req, { versionId: v.id, contentHash: 'f'.repeat(64), decision: 'approved', channel: 'web' }, customer, CUSTOMER, { decisionId: nextId(), now: NOW }),
      409,
      ERROR_CODES.hashMismatch,
    );
  });

  it('erzeugt bei Änderung eine neue Version; die alte Entscheidung gilt nicht mehr', () => {
    const req = sentRequest();
    const v1 = currentVersion(req);
    const approved = decide(req, { versionId: v1.id, contentHash: v1.contentHash, decision: 'approved', channel: 'ios' }, customer, CUSTOMER, { decisionId: nextId(), now: NOW });
    const changed = reviseRequest(approved, { ...draft, lines: [...draft.lines, { ...draft.lines[0]!, title: 'Bremsbeläge', unitPriceCents: 5_490 }] }, { versionId: nextId(), createdBy: 'u-service', now: NOW });
    const v2 = currentVersion(changed);
    expect(v2.versionNo).toBe(2);
    expect(v2.contentHash).not.toBe(v1.contentHash);
    expect(v2.decision).toBeNull();
    expect(changed.status).toBe('pending_customer');
    expect(changed.versions.find((v) => v.id === v1.id)?.supersededAt).toBe(NOW);
    // Entscheidung zur alten Version ist nicht mehr möglich
    expectApiError(
      () => decide(changed, { versionId: v1.id, contentHash: v1.contentHash, decision: 'approved', channel: 'web' }, customer, CUSTOMER, { decisionId: nextId(), now: NOW }),
      409,
      ERROR_CODES.versionSuperseded,
    );
  });

  it('verhindert eine zweite Entscheidung zur selben Version', () => {
    const req = sentRequest();
    const v = currentVersion(req);
    const once = decide(req, { versionId: v.id, contentHash: v.contentHash, decision: 'rejected', channel: 'web' }, customer, CUSTOMER, { decisionId: nextId(), now: NOW });
    expectApiError(
      () => decide(once, { versionId: v.id, contentHash: v.contentHash, decision: 'approved', channel: 'web' }, customer, CUSTOMER, { decisionId: nextId(), now: NOW }),
      409,
      ERROR_CODES.alreadyDecided,
    );
  });

  it('erlaubt keinem Mitarbeiter, für den Kunden zu entscheiden (auch nicht Admin oder Mechaniker)', () => {
    const req = sentRequest();
    const v = currentVersion(req);
    for (const role of ['admin', 'service', 'mechanic'] as const) {
      expectApiError(
        () => decide(req, { versionId: v.id, contentHash: v.contentHash, decision: 'approved', channel: 'web' }, { ...customer, role, customerId: null }, CUSTOMER, { decisionId: nextId(), now: NOW }),
        403,
        ERROR_CODES.notCustomer,
      );
    }
  });

  it('behandelt fremde Kunden wie nicht vorhanden (404)', () => {
    const req = sentRequest();
    const v = currentVersion(req);
    expectApiError(
      () => decide(req, { versionId: v.id, contentHash: v.contentHash, decision: 'approved', channel: 'web' }, { ...customer, customerId: 'anderer-kunde' }, CUSTOMER, { decisionId: nextId(), now: NOW }),
      404,
    );
  });

  it('nimmt Entwürfe und zurückgezogene Anfragen nicht an', () => {
    const d = createDraft({ id: 'req-2', versionId: nextId(), workOrderId: 'wo-1', draft, createdBy: 'u-service', now: NOW });
    const v = currentVersion(d);
    expectApiError(() => decide(d, { versionId: v.id, contentHash: v.contentHash, decision: 'approved', channel: 'web' }, customer, CUSTOMER, { decisionId: nextId(), now: NOW }), 404);
    const { request: withdrawn } = withdrawRequest(sendRequest(d, NOW), NOW);
    expectApiError(() => decide(withdrawn, { versionId: v.id, contentHash: v.contentHash, decision: 'approved', channel: 'web' }, customer, CUSTOMER, { decisionId: nextId(), now: NOW }), 409);
  });

  it('Zurückziehen sperrt wartende Positionen der Anfrage (withdrawn), andere bleiben unberührt', () => {
    const req = sentRequest();
    const items = syncItemsWithVersion([], req, nextId);
    const { request, items: after } = withdrawRequest(req, NOW, items);
    expect(request.status).toBe('withdrawn');
    expect(after.every((i) => i.authorization === 'withdrawn')).toBe(true);
  });
});

describe('Freigaben: Positionen (Regel 5)', () => {
  const base = (p: Partial<DWorkItem>): DWorkItem => ({
    id: nextId(), workOrderId: 'wo-1', position: 1, kind: 'labor', title: 'x', description: null, maintenanceTypeId: null, intervalKm: null, intervalMonths: null,
    quantity: 1, unit: 'Stk', unitPriceCents: 100, vatRateBp: 1900, origin: 'intake', authorization: 'agreed', executionStatus: 'planned', approvalRequestId: null,
    approvedVersionId: null, assignedTo: null, doneAt: null, doneBy: null, doneOdometerKm: null, resultNotes: null, trackedMinutes: 0, runningSince: null, parts: [], ...p,
  });

  it('Ablehnung betrifft nur die Positionen dieser Anfrage', () => {
    const items = [
      base({ title: 'Inspektion', authorization: 'agreed' }),
      base({ title: 'Bremsen', authorization: 'pending_approval', approvalRequestId: 'req-1' }),
      base({ title: 'Wischer', authorization: 'approved', approvalRequestId: 'req-2', approvedVersionId: 'v-9' }),
    ];
    const after = applyDecisionToItems(items, 'req-1', 'rejected', 'v-1');
    // wie die API: abgelehnt, bleibt "geplant", ist aber nicht ausführbar
    expect(after.find((i) => i.title === 'Bremsen')).toMatchObject({ authorization: 'rejected', executionStatus: 'planned' });
    expect(after.find((i) => i.title === 'Inspektion')?.authorization).toBe('agreed');
    expect(after.find((i) => i.title === 'Wischer')).toMatchObject({ authorization: 'approved', approvedVersionId: 'v-9' });
  });

  it('Freigabe setzt die Positionen auf "freigegeben" mit Versionsbezug', () => {
    const items = [base({ approvalRequestId: 'req-1', authorization: 'pending_approval' })];
    expect(applyDecisionToItems(items, 'req-1', 'approved', 'v-1')[0]).toMatchObject({ authorization: 'approved', approvedVersionId: 'v-1' });
  });

  it('eine neue Version setzt bereits freigegebene, nicht begonnene Positionen zurück auf "wartet"', () => {
    const req = sentRequest();
    const items = syncItemsWithVersion([], req, nextId);
    expect(items).toHaveLength(2);
    const approvedItems = applyDecisionToItems(items, req.id, 'approved', currentVersion(req).id);
    const revised = reviseRequest(req, { ...draft, lines: [draft.lines[0]!] }, { versionId: nextId(), createdBy: 'u', now: NOW });
    const synced = syncItemsWithVersion(approvedItems, revised, nextId, { newVersion: true });
    // wie die API: Zeile 1 wartet wieder auf Entscheidung, die entfallene Zeile ist zurückgezogen
    expect(synced).toHaveLength(2);
    expect(synced[0]?.authorization).toBe('pending_approval');
    expect(synced[1]?.authorization).toBe('withdrawn');
  });
});
