import { describe, expect, it } from 'vitest';
import { IDS, admin, customerA, customerActor, customerB, mechanic, service, tid } from '../testing/fixtures';
import { canonicalApprovalContent, computeContentHash, hashApprovalContent, type ApprovalContentInput } from './content';
import {
  applyDecision,
  requestStatusAfterDecision,
  resetItemsForNewVersion,
  validateDecision,
  withdrawApproval,
  type AuthorizableItem,
  type ValidateDecisionInput,
} from './decisions';
import { createInitialVersion, reviseApproval, sendApproval, type ApprovalVersionState } from './versions';

const t0 = new Date('2026-09-26T08:00:00Z');
const t1 = new Date('2026-09-26T09:00:00Z');
const t2 = new Date('2026-09-26T10:00:00Z');

const brakeOffer: ApprovalContentInput = {
  summaryCustomer: 'Bremsscheiben und Beläge vorne sind verschlissen.',
  lines: [
    { title: 'Bremsscheiben vorne', description: null, quantity: 2, unit: 'Stk', unitPriceCents: 6_500, vatRateBp: 1900, maintenanceTypeId: null },
    { title: 'Arbeitszeit', description: 'Ein- und Ausbau', quantity: 1.5, unit: 'Std', unitPriceCents: 8_990, vatRateBp: 1900, maintenanceTypeId: null },
  ],
  scheduleChange: 'Fertig einen Tag später',
  newReadyAt: '2026-09-27T16:00:00+02:00',
  photoIds: [tid(1002), tid(1001)],
  documentVersionId: null,
};

describe('Kanonischer Inhalt und Hash', () => {
  it('liefert einen 64-stelligen SHA-256-Hex-Hash', () => {
    expect(hashApprovalContent(brakeOffer)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gleicher Inhalt in anderer Schreibweise ergibt denselben Hash', () => {
    const variant: ApprovalContentInput = {
      ...brakeOffer,
      summaryCustomer: '  Bremsscheiben und Beläge vorne sind verschlissen.\r\n',
      lines: brakeOffer.lines.map((l) => ({ ...l, title: ` ${l.title} ` })),
      newReadyAt: new Date('2026-09-27T14:00:00Z'),
      photoIds: [tid(1001), tid(1002).toUpperCase(), tid(1001)],
      scheduleChange: 'Fertig einen Tag später ',
    };
    expect(hashApprovalContent(variant)).toBe(hashApprovalContent(brakeOffer));
  });

  it('jede inhaltliche Änderung ändert den Hash (Umfang, Preis, Termin, Fotos, Dokument)', () => {
    const base = hashApprovalContent(brakeOffer);
    const changed: ApprovalContentInput[] = [
      { ...brakeOffer, lines: [brakeOffer.lines[0]!] },
      { ...brakeOffer, lines: [{ ...brakeOffer.lines[0]!, unitPriceCents: 6_600 }, brakeOffer.lines[1]!] },
      { ...brakeOffer, lines: [{ ...brakeOffer.lines[0]!, quantity: 1 }, brakeOffer.lines[1]!] },
      { ...brakeOffer, scheduleChange: null },
      { ...brakeOffer, newReadyAt: '2026-09-28T16:00:00+02:00' },
      { ...brakeOffer, photoIds: [tid(1001)] },
      { ...brakeOffer, documentVersionId: tid(1100) },
      { ...brakeOffer, summaryCustomer: 'Andere Beschreibung' },
    ];
    for (const c of changed) expect(hashApprovalContent(c)).not.toBe(base);
  });

  it('enthält Summen und Zeilenbeträge', () => {
    const c = canonicalApprovalContent(brakeOffer);
    expect(c.lines.map((l) => l.lineNetCents)).toEqual([13_000, 13_485]);
    expect(c.totalNetCents).toBe(26_485);
    expect(c.totalGrossCents).toBe(26_485 + 5_032);
    expect(c.lines[1]?.quantity).toBe('1.5');
    expect(computeContentHash(c)).toBe(hashApprovalContent(brakeOffer));
  });

  it('lehnt leere oder ungültige Inhalte ab', () => {
    expect(() => canonicalApprovalContent({ ...brakeOffer, lines: [] })).toThrow();
    expect(() => canonicalApprovalContent({ ...brakeOffer, summaryCustomer: ' ' })).toThrow();
    expect(() => canonicalApprovalContent({ ...brakeOffer, lines: [{ ...brakeOffer.lines[0]!, quantity: 0 }] })).toThrow();
    expect(() => canonicalApprovalContent({ ...brakeOffer, lines: [{ ...brakeOffer.lines[0]!, unitPriceCents: 1.5 }] })).toThrow();
  });
});

describe('Versionen', () => {
  const v1 = createInitialVersion(brakeOffer, t0);
  const v1State: ApprovalVersionState = { id: tid(1201), versionNo: 1, contentHash: v1.contentHash, sentAt: null, supersededAt: null };

  it('erste Version ist ein Entwurf', () => {
    expect(v1).toMatchObject({ versionNo: 1, sentAt: null, supersededAt: null, currency: 'EUR' });
  });

  it('Entwurf senden macht die Anfrage wartend', () => {
    const r = sendApproval({ id: tid(1200), status: 'draft' }, v1State, t1);
    expect(r).toEqual({ ok: true, value: { requestStatus: 'pending_customer', versionId: v1State.id, sentAt: t1.toISOString() } });
    expect(sendApproval({ id: tid(1200), status: 'pending_customer' }, { ...v1State, sentAt: t1.toISOString() }, t2).ok).toBe(false);
  });

  it('ungesendeter Entwurf wird ohne neue Versionsnummer ersetzt', () => {
    const r = reviseApproval({ id: tid(1200), status: 'draft' }, v1State, { ...brakeOffer, scheduleChange: null }, t1);
    expect(r.ok && r.value.kind).toBe('draft_updated');
    if (r.ok && r.value.kind === 'draft_updated') {
      expect(r.value.version.versionNo).toBe(1);
      expect(r.value.version.sentAt).toBeNull();
    }
  });

  it('identischer Inhalt erzeugt keine neue Version', () => {
    const sent = { ...v1State, sentAt: t1.toISOString() };
    const r = reviseApproval({ id: tid(1200), status: 'pending_customer' }, sent, { ...brakeOffer, summaryCustomer: ` ${brakeOffer.summaryCustomer}` }, t2);
    expect(r).toEqual({ ok: true, value: { kind: 'unchanged', contentHash: v1.contentHash } });
  });

  it('Preisänderung nach dem Senden erzeugt eine neue Version, die alte wird superseded', () => {
    const sent = { ...v1State, sentAt: t1.toISOString() };
    const cheaper = { ...brakeOffer, lines: [{ ...brakeOffer.lines[0]!, unitPriceCents: 6_000 }, brakeOffer.lines[1]!] };
    const r = reviseApproval({ id: tid(1200), status: 'approved' }, sent, cheaper, t2);
    expect(r.ok && r.value.kind).toBe('new_version');
    if (r.ok && r.value.kind === 'new_version') {
      expect(r.value.newVersion.versionNo).toBe(2);
      expect(r.value.newVersion.contentHash).not.toBe(v1.contentHash);
      expect(r.value.newVersion.sentAt).toBe(t2.toISOString());
      expect(r.value.supersede).toEqual({ versionId: v1State.id, supersededAt: t2.toISOString() });
      expect(r.value.requestStatus).toBe('pending_customer');
    }
  });

  it('zurückgezogene Anfragen und überholte Versionen können nicht überarbeitet werden', () => {
    expect(reviseApproval({ id: tid(1200), status: 'withdrawn' }, v1State, brakeOffer, t1)).toMatchObject({ ok: false, error: { code: 'REQUEST_WITHDRAWN' } });
    expect(reviseApproval({ id: tid(1200), status: 'pending_customer' }, { ...v1State, supersededAt: t1.toISOString() }, brakeOffer, t1)).toMatchObject({
      ok: false,
      error: { code: 'VERSION_NOT_CURRENT' },
    });
  });
});

describe('Abnahme: Freigabe und Ablehnung', () => {
  const requestId = tid(1300);
  const otherRequestId = tid(1310);
  const versionId = tid(1301);
  const hash = hashApprovalContent(brakeOffer);

  const decisionInput = (over: Partial<ValidateDecisionInput> = {}): ValidateDecisionInput => ({
    request: { id: requestId, status: 'pending_customer', currentVersionId: versionId },
    currentVersion: { id: versionId, contentHash: hash, sentAt: t1.toISOString(), supersededAt: null },
    submittedVersionId: versionId,
    submittedHash: hash,
    actor: customerA(),
    workOrderCustomerId: IDS.customerA,
    alreadyDecided: false,
    ...over,
  });

  const items: AuthorizableItem[] = [
    { id: tid(1401), approvalRequestId: null, authorization: 'agreed', executionStatus: 'done' },
    { id: tid(1402), approvalRequestId: requestId, authorization: 'pending_approval', executionStatus: 'planned' },
    { id: tid(1403), approvalRequestId: requestId, authorization: 'pending_approval', executionStatus: 'planned' },
    { id: tid(1404), approvalRequestId: otherRequestId, authorization: 'approved', approvedVersionId: tid(1311), executionStatus: 'planned' },
    { id: tid(1405), approvalRequestId: otherRequestId, authorization: 'pending_approval', executionStatus: 'planned' },
  ];

  it('Kunde des Auftrags kann die aktuelle Version mit passendem Hash entscheiden', () => {
    expect(validateDecision(decisionInput())).toEqual({ ok: true, versionId, contentHash: hash });
  });

  it('Freigabe setzt nur die Positionen dieser Anfrage auf approved', () => {
    const { items: next, changes } = applyDecision(items, requestId, 'approved', versionId);
    expect(changes.map((c) => c.itemId)).toEqual([tid(1402), tid(1403)]);
    expect(next[1]).toMatchObject({ authorization: 'approved', approvedVersionId: versionId });
    expect(next[0]).toBe(items[0]);
    expect(next[3]).toBe(items[3]);
    expect(next[4]).toBe(items[4]);
    expect(requestStatusAfterDecision('approved')).toBe('approved');
  });

  it('Ablehnung betrifft nur die Positionen dieser Anfrage; separat freigegebene bleiben unberührt', () => {
    const { items: next } = applyDecision(items, requestId, 'rejected', versionId);
    expect(next.map((i) => i.authorization)).toEqual(['agreed', 'rejected', 'rejected', 'approved', 'pending_approval']);
    expect(next[1]?.approvedVersionId).toBeNull();
    expect(requestStatusAfterDecision('rejected')).toBe('rejected');
  });

  it('Mechaniker, Service und Admin können nie freigeben', () => {
    for (const actor of [mechanic(), service(), admin()]) {
      const r = validateDecision(decisionInput({ actor }));
      expect(r).toMatchObject({ ok: false, code: 'NOT_CUSTOMER', notFound: false });
    }
  });

  it('fremde Kunden und inaktive Konten können nicht entscheiden (404-Semantik)', () => {
    expect(validateDecision(decisionInput({ actor: customerB() }))).toMatchObject({ ok: false, code: 'NOT_CUSTOMER', notFound: true });
    const disabled = customerActor(IDS.customerAUser, IDS.customerA, 'disabled');
    expect(validateDecision(decisionInput({ actor: disabled }))).toMatchObject({ ok: false, code: 'NOT_CUSTOMER' });
  });

  it('doppelte Entscheidung wird abgelehnt (ALREADY_DECIDED)', () => {
    expect(validateDecision(decisionInput({ alreadyDecided: true }))).toMatchObject({ ok: false, code: 'ALREADY_DECIDED' });
    expect(validateDecision(decisionInput({ request: { id: requestId, status: 'approved', currentVersionId: versionId } }))).toMatchObject({
      ok: false,
      code: 'ALREADY_DECIDED',
    });
  });

  it('Entwürfe und zurückgezogene Anfragen können nicht entschieden werden', () => {
    expect(
      validateDecision(
        decisionInput({
          request: { id: requestId, status: 'draft', currentVersionId: versionId },
          currentVersion: { id: versionId, contentHash: hash, sentAt: null, supersededAt: null },
        }),
      ),
    ).toMatchObject({ ok: false, code: 'NOT_PENDING' });
    expect(validateDecision(decisionInput({ request: { id: requestId, status: 'withdrawn', currentVersionId: versionId } }))).toMatchObject({
      ok: false,
      code: 'WITHDRAWN',
    });
  });

  it('nach einer Änderung ist eine neue Entscheidung nötig: alte Version bzw. alter Hash werden abgelehnt', () => {
    // Kunde hat Version 1 freigegeben; Werkstatt ändert den Preis → Version 2.
    const v1State: ApprovalVersionState = { id: versionId, versionNo: 1, contentHash: hash, sentAt: t1.toISOString(), supersededAt: null };
    const cheaper = { ...brakeOffer, lines: [{ ...brakeOffer.lines[0]!, unitPriceCents: 6_000 }, brakeOffer.lines[1]!] };
    const revised = reviseApproval({ id: requestId, status: 'approved' }, v1State, cheaper, t2);
    if (!revised.ok || revised.value.kind !== 'new_version') throw new Error('neue Version erwartet');
    const v2Id = tid(1302);
    const v2Hash = revised.value.newVersion.contentHash;
    const afterRevision = {
      request: { id: requestId, status: 'pending_customer' as const, currentVersionId: v2Id },
      currentVersion: { id: v2Id, contentHash: v2Hash, sentAt: t2.toISOString(), supersededAt: null },
    };
    // Alte Version (auch mit altem Hash) → VERSION_SUPERSEDED
    expect(validateDecision(decisionInput({ ...afterRevision, submittedVersionId: versionId, submittedHash: hash }))).toMatchObject({
      ok: false,
      code: 'VERSION_SUPERSEDED',
    });
    // Neue Version, aber alter Hash → HASH_MISMATCH
    expect(validateDecision(decisionInput({ ...afterRevision, submittedVersionId: v2Id, submittedHash: hash }))).toMatchObject({
      ok: false,
      code: 'HASH_MISMATCH',
    });
    // Neue Version mit neuem Hash → gültig; die alte Entscheidung (Version 1) gilt nicht für Version 2
    expect(validateDecision(decisionInput({ ...afterRevision, submittedVersionId: v2Id, submittedHash: v2Hash, alreadyDecided: false }))).toMatchObject({
      ok: true,
      versionId: v2Id,
    });
  });

  it('nach einer neuen Version warten offene Positionen wieder auf Freigabe; erledigte behalten ihren Stand', () => {
    const decided = applyDecision(items, requestId, 'approved', versionId).items;
    const withProgress = decided.map((i) =>
      i.id === tid(1402) ? { ...i, executionStatus: 'done' as const } : i.id === tid(1403) ? { ...i, executionStatus: 'in_progress' as const } : i,
    );
    const { items: next, changes, pausedItemIds } = resetItemsForNewVersion(withProgress, requestId);
    expect(next.find((i) => i.id === tid(1402))).toMatchObject({ authorization: 'approved', executionStatus: 'done' });
    expect(next.find((i) => i.id === tid(1403))).toMatchObject({ authorization: 'pending_approval', executionStatus: 'paused', approvedVersionId: null });
    expect(changes).toEqual([{ itemId: tid(1403), from: 'approved', to: 'pending_approval' }]);
    expect(pausedItemIds).toEqual([tid(1403)]);
    expect(next.find((i) => i.id === tid(1404))).toMatchObject({ authorization: 'approved' });
  });

  it('Zurückziehen setzt wartende Positionen dieser Anfrage auf withdrawn', () => {
    const r = withdrawApproval({ id: requestId, status: 'pending_customer' }, items);
    expect(r.ok && r.value.items.map((i) => i.authorization)).toEqual(['agreed', 'withdrawn', 'withdrawn', 'approved', 'pending_approval']);
    expect(withdrawApproval({ id: requestId, status: 'approved' }, items)).toMatchObject({ ok: false, error: { code: 'ALREADY_DECIDED' } });
    expect(withdrawApproval({ id: requestId, status: 'withdrawn' }, items)).toMatchObject({ ok: false, error: { code: 'ALREADY_WITHDRAWN' } });
  });
});
