/**
 * Review (Claude-Unteragent, 27.09.2026): Angriffsszenarien Freigaben (ADR-006, Teil C-01/C-02).
 * `it.fails` = bestätigter, offener Befund (siehe docs/uebergaben/2026-09-27-review-claude.md).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApprovalRequestSchema, DocumentSchema, FileRefSchema, FindingSchema, IntakeSchema, PhotoSchema, WorkItemSchema, WorkOrderDetailSchema } from '@werkstatt/contracts';
import { SAMPLE_PDF, SAMPLE_PNG, call, createHarness, expectOk, expectStatus, uploadFile, type Harness } from './support/harness';
import { createAndSendApproval, createWorkOrder, customerWithVehicle, decide, item, line, setupWorkshop, type Workshop } from './support/scenario';

let h: Harness;
let w: Workshop;
beforeAll(async () => {
  h = await createHarness();
  w = await setupWorkshop(h);
});
afterAll(async () => h?.close());

const draftBody = (lines: ReturnType<typeof line>[], extra: Record<string, unknown> = {}) => ({
  kind: 'additional_work',
  title: '[TEST] Zusatz',
  summaryCustomer: 'Bei der Prüfung festgestellt.',
  lines,
  photoIds: [],
  ...extra,
});

async function orderWithApproval(lines = [line('Bremsbeläge', 12000)]) {
  const { customer, vehicleId } = await customerWithVehicle(h, 'Freigabe');
  const wo = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId, assigneeIds: [w.mechanic.id], items: [item('Diagnose')] });
  const approval = await createAndSendApproval(h, w.service.token, wo.id, lines);
  return { customer, vehicleId, wo, approval };
}

const itemsOf = async (woId: string, approvalId: string) =>
  expectOk(await call(h, 'GET', `/work-orders/${woId}`, { token: w.service.token }), WorkOrderDetailSchema).items.filter((i) => i.approvalRequestId === approvalId);

describe('F01 gleichzeitige Entscheidungen', () => {
  it('Freigabe und Ablehnung gleichzeitig: genau eine Entscheidung, Positionen passend', async () => {
    const { customer, wo, approval } = await orderWithApproval();
    const v = approval.currentVersion;
    const results = await Promise.all([
      decide(h, customer.token, approval.id, v.id, v.contentHash, 'approved'),
      decide(h, customer.token, approval.id, v.id, v.contentHash, 'rejected'),
      decide(h, customer.token, approval.id, v.id, v.contentHash, 'approved'),
    ]);
    const ok = results.filter((r) => r.statusCode === 200);
    expect(ok).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(2);
    const decided = ok[0]!.json().status as 'approved' | 'rejected';
    for (const i of await itemsOf(wo.id, approval.id)) expect(i.authorization).toBe(decided);
  });
});

describe('F02 gleichzeitiges Ändern und Entscheiden', () => {
  it('nach Abschluss beider Vorgänge ist keine Position auf eine nicht entschiedene Fassung freigegeben', async () => {
    for (let round = 0; round < 4; round++) {
      const { customer, wo, approval } = await orderWithApproval([line('Scheibe', 20000)]);
      const v = approval.currentVersion;
      await Promise.all([
        decide(h, customer.token, approval.id, v.id, v.contentHash, 'approved'),
        call(h, 'PUT', `/approvals/${approval.id}`, { token: w.service.token, body: draftBody([line('Scheibe', 26000)]) }),
      ]);
      const now = expectOk(await call(h, 'GET', `/approvals/${approval.id}`, { token: w.service.token }), ApprovalRequestSchema);
      const items = await itemsOf(wo.id, approval.id);
      if (now.currentVersion.decision === null) {
        expect(now.status, `Runde ${round}`).toBe('pending_customer');
        for (const i of items) expect(i.authorization, `Runde ${round}`).toBe('pending_approval');
      } else {
        for (const i of items) expect(i.authorization, `Runde ${round}`).toBe(now.currentVersion.decision.decision);
      }
      expect(items.every((i) => i.unitPriceCents === now.currentVersion.lines[0]!.unitPriceCents)).toBe(true);
    }
  });
});

describe('F03 Bindung an Fassung und Hash', () => {
  it('falscher Hash, alte Fassung, zurückgezogen, bereits entschieden: 409; fremder Kunde: 404', async () => {
    const { customer, wo, approval } = await orderWithApproval();
    const v1 = approval.currentVersion;
    expectStatus(await decide(h, customer.token, approval.id, v1.id, 'a'.repeat(64), 'approved'), 409, 'hash_mismatch');
    const revised = expectOk(await call(h, 'PUT', `/approvals/${approval.id}`, { token: w.service.token, body: draftBody([line('Bremsbeläge', 15000)]) }), ApprovalRequestSchema);
    expect(revised.currentVersion.versionNo).toBe(2);
    expectStatus(await decide(h, customer.token, approval.id, v1.id, v1.contentHash, 'approved'), 409, 'version_superseded');
    // Hash der neuen Fassung mit ID der alten
    expectStatus(await decide(h, customer.token, approval.id, v1.id, revised.currentVersion.contentHash, 'approved'), 409, 'version_superseded');
    const other = await customerWithVehicle(h, 'FremdEntscheid');
    expectStatus(await decide(h, other.customer.token, approval.id, revised.currentVersion.id, revised.currentVersion.contentHash, 'approved'), 404);
    expectOk(await decide(h, customer.token, approval.id, revised.currentVersion.id, revised.currentVersion.contentHash, 'approved'), ApprovalRequestSchema);
    expectStatus(await decide(h, customer.token, approval.id, revised.currentVersion.id, revised.currentVersion.contentHash, 'rejected'), 409, 'already_decided');
    const items = await itemsOf(wo.id, approval.id);
    expect(items.every((i) => i.authorization === 'approved' && i.unitPriceCents === 15000)).toBe(true);

    const second = await createAndSendApproval(h, w.service.token, wo.id, [line('Wischer', 3000)]);
    expectOk(await call(h, 'POST', `/approvals/${second.id}/withdraw`, { token: w.service.token }), ApprovalRequestSchema);
    expectStatus(await decide(h, customer.token, second.id, second.currentVersion.id, second.currentVersion.contentHash, 'approved'), 409, 'withdrawn');
  });

  it('Ablehnung betrifft nur Positionen dieser Anfrage', async () => {
    const { customer, wo, approval } = await orderWithApproval([line('A', 1000)]);
    const other = await createAndSendApproval(h, w.service.token, wo.id, [line('B', 2000)]);
    expectOk(await decide(h, customer.token, approval.id, approval.currentVersion.id, approval.currentVersion.contentHash, 'rejected'), ApprovalRequestSchema);
    const detail = expectOk(await call(h, 'GET', `/work-orders/${wo.id}`, { token: w.service.token }), WorkOrderDetailSchema);
    expect(detail.items.find((i) => i.title === 'Diagnose')!.authorization).toBe('agreed');
    expect(detail.items.find((i) => i.approvalRequestId === other.id)!.authorization).toBe('pending_approval');
    expect(detail.items.find((i) => i.approvalRequestId === approval.id)!.authorization).toBe('rejected');
  });
});

describe('F04 Ausführung und Änderung von Positionen', () => {
  it('wartende Positionen startet auch der Admin nicht; laufende Arbeit sperrt die Überarbeitung der Anfrage', async () => {
    const { customer, wo, approval } = await orderWithApproval([line('Scheiben', 30000)]);
    const [pending] = await itemsOf(wo.id, approval.id);
    expectStatus(await call(h, 'POST', `/work-items/${pending!.id}/start`, { token: w.admin.token }), 403);
    expectOk(await decide(h, customer.token, approval.id, approval.currentVersion.id, approval.currentVersion.contentHash, 'approved'), ApprovalRequestSchema);
    expectOk(await call(h, 'POST', `/work-items/${pending!.id}/start`, { token: w.mechanic.token }), WorkItemSchema);
    // Mehraufwand während laufender Arbeit: eigene neue Freigabeanfrage statt Überarbeitung
    expectStatus(await call(h, 'PUT', `/approvals/${approval.id}`, { token: w.service.token, body: draftBody([line('Scheiben', 36000)]) }), 409, 'approval_in_execution');
    const [after] = await itemsOf(wo.id, approval.id);
    expect(after!.authorization).toBe('approved');
    expect(after!.executionStatus).toBe('in_progress');
    // Direkte Änderung einer Freigabeposition ist gesperrt
    expectStatus(await call(h, 'PATCH', `/work-items/${pending!.id}`, { token: w.service.token, body: { unitPriceCents: 1 } }), 409, 'approval_bound');
  });

  it('Fotos, Dokument und Feststellung eines anderen Auftrags können nicht in eine Fassung', async () => {
    const a = await orderWithApproval();
    const b = await orderWithApproval();
    const png = expectOk(await uploadFile(h, w.service.token, 'b.png', 'image/png', SAMPLE_PNG), FileRefSchema, 201);
    const photoB = expectOk(await call(h, 'POST', `/work-orders/${b.wo.id}/photos`, { token: w.service.token, body: { fileId: png.id, context: 'finding' } }), PhotoSchema, 201);
    const pdf = expectOk(await uploadFile(h, w.service.token, 'b.pdf', 'application/pdf', SAMPLE_PDF), FileRefSchema, 201);
    const docB = expectOk(await call(h, 'POST', '/documents', { token: w.service.token, body: { kind: 'offer', title: 'Angebot B', fileId: pdf.id, workOrderId: b.wo.id } }), DocumentSchema, 201);
    const findingB = expectOk(await call(h, 'POST', `/work-orders/${b.wo.id}/findings`, { token: w.mechanic.token, body: { description: 'Riss', severity: 'urgent' } }), FindingSchema, 201);
    const post = (extra: Record<string, unknown>) => call(h, 'POST', `/work-orders/${a.wo.id}/approvals`, { token: w.service.token, body: draftBody([line('X', 100)], extra) });
    expectStatus(await post({ photoIds: [photoB.id] }), 422, 'invalid_photos');
    expectStatus(await post({ documentVersionId: docB.currentVersion.id }), 422, 'invalid_document');
    expectStatus(await post({ findingId: findingB.id }), 422, 'invalid_finding');
    expectStatus(await call(h, 'PUT', `/approvals/${a.approval.id}`, { token: w.service.token, body: draftBody([line('X', 100)], { photoIds: [photoB.id] }) }), 422, 'invalid_photos');
    // Foto von B bleibt intern
    const photos = expectOk(await call(h, 'GET', `/work-orders/${b.wo.id}/photos`, { token: b.customer.token }), z.array(PhotoSchema));
    expect(photos.map((p) => p.id)).not.toContain(photoB.id);
  });

  it('Entwurf eines stornierten Auftrags kann nicht mehr an den Kunden gesendet werden', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'StornoFreigabe');
    const wo = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId });
    const draft = expectOk(await call(h, 'POST', `/work-orders/${wo.id}/approvals`, { token: w.service.token, body: draftBody([line('Nachtrag', 5000)]) }), ApprovalRequestSchema, 201);
    expectOk(await call(h, 'POST', `/work-orders/${wo.id}/transition`, { token: w.service.token, body: { to: 'cancelled', reason: 'Kunde storniert' } }), WorkOrderDetailSchema);
    expectStatus(await call(h, 'POST', `/approvals/${draft.id}/send`, { token: w.service.token }), 409, 'work_order_closed');
    const list = expectOk(await call(h, 'GET', `/work-orders/${wo.id}/approvals`, { token: customer.token }), z.array(ApprovalRequestSchema));
    expect(list).toHaveLength(0);
  });
});

describe('F05 Annahme-Bestätigung (R-ANN-3)', () => {
  it('nach bestätigter Annahme entstehen neue oder geänderte Leistungen nur über Freigabe, auch nach nachträglicher Änderung (behoben)', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Annahme');
    const wo = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId, items: [item('Ölwechsel', { unitPriceCents: 8000 })] });
    const intake = expectOk(
      await call(h, 'PUT', `/work-orders/${wo.id}/intake`, { token: w.service.token, body: { odometerKm: 1000, customerComplaint: 'Service', agreedServices: 'Ölwechsel' } }),
      IntakeSchema,
    );
    // vor der Bestätigung sind Änderungen erlaubt
    expectOk(await call(h, 'PATCH', `/work-items/${wo.items[0]!.id}`, { token: w.service.token, body: { unitPriceCents: 7900 } }), WorkItemSchema);
    const current = expectOk(await call(h, 'GET', `/work-orders/${wo.id}/intake`, { token: customer.token }), IntakeSchema);
    expect(current.contentHash).not.toBe(intake.contentHash);
    expectOk(await call(h, 'POST', `/work-orders/${wo.id}/intake/confirm`, { token: customer.token, body: { method: 'app', contentHash: current.contentHash } }), IntakeSchema);
    expectStatus(await call(h, 'POST', `/work-orders/${wo.id}/items`, { token: w.service.token, body: item('Zusatz ohne Freigabe') }), 409, 'approval_required');
    // Umfang/Preis bestätigter Leistungen nur über Freigabe
    expectStatus(await call(h, 'PATCH', `/work-items/${wo.items[0]!.id}`, { token: w.service.token, body: { unitPriceCents: 8001 } }), 409, 'approval_required');
    // Zuweisung bleibt änderbar
    expectOk(await call(h, 'PATCH', `/work-items/${wo.items[0]!.id}`, { token: w.service.token, body: { assignedTo: w.mechanic.id } }), WorkItemSchema);
    // Änderung des Annahmetextes macht die Bestätigung ungültig, öffnet aber keinen Weg für neue Leistungen
    const changed = expectOk(
      await call(h, 'PUT', `/work-orders/${wo.id}/intake`, { token: w.service.token, body: { odometerKm: 1000, customerComplaint: 'Service und Klappern', agreedServices: 'Ölwechsel' } }),
      IntakeSchema,
    );
    expect(changed.confirmedAt).toBeNull();
    expectStatus(await call(h, 'POST', `/work-orders/${wo.id}/items`, { token: w.service.token, body: item('Zusatz ohne Freigabe') }), 409, 'approval_required');
  });
});

describe('F05b Annahme-Hash und Bruttopreis', () => {
  it('USt-Satz ist Teil des Annahme-Hashs; nach Bestätigung nur über Freigabe änderbar (behoben)', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'AnnahmeUst');
    const wo = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId, items: [item('Inspektion', { unitPriceCents: 10000, vatRateBp: 1900 })] });
    const intake = expectOk(
      await call(h, 'PUT', `/work-orders/${wo.id}/intake`, { token: w.service.token, body: { odometerKm: 1000, customerComplaint: 'Inspektion', agreedServices: 'Inspektion' } }),
      IntakeSchema,
    );
    expectOk(await call(h, 'PATCH', `/work-items/${wo.items[0]!.id}`, { token: w.service.token, body: { vatRateBp: 700 } }), WorkItemSchema);
    const afterVat = expectOk(await call(h, 'GET', `/work-orders/${wo.id}/intake`, { token: customer.token }), IntakeSchema);
    expect(afterVat.contentHash).not.toBe(intake.contentHash);
    // alte Fassung kann nicht mehr bestätigt werden
    expectStatus(await call(h, 'POST', `/work-orders/${wo.id}/intake/confirm`, { token: customer.token, body: { method: 'app', contentHash: intake.contentHash } }), 409, 'intake_changed');
    expectOk(await call(h, 'POST', `/work-orders/${wo.id}/intake/confirm`, { token: customer.token, body: { method: 'app', contentHash: afterVat.contentHash } }), IntakeSchema);
    expectStatus(await call(h, 'PATCH', `/work-items/${wo.items[0]!.id}`, { token: w.service.token, body: { vatRateBp: 1900 } }), 409, 'approval_required');
  });
});

describe('F06 Zuordnung Fassungszeilen ↔ Positionen bei begonnener Arbeit', () => {
  it('Anfrage mit begonnener Arbeit kann nicht überarbeitet werden; Änderung läuft über eine neue Anfrage (behoben)', async () => {
    const { customer, wo, approval } = await orderWithApproval([line('A-Scheiben', 10000), line('B-Beläge', 5000)]);
    expectOk(await decide(h, customer.token, approval.id, approval.currentVersion.id, approval.currentVersion.contentHash, 'approved'), ApprovalRequestSchema);
    const [a] = await itemsOf(wo.id, approval.id);
    expectOk(await call(h, 'POST', `/work-items/${a!.id}/start`, { token: w.mechanic.token }), WorkItemSchema);
    expectOk(await call(h, 'POST', `/work-items/${a!.id}/finish`, { token: w.mechanic.token, body: {} }), WorkItemSchema);
    expectStatus(await call(h, 'PUT', `/approvals/${approval.id}`, { token: w.service.token, body: draftBody([line('B-Beläge', 6000)]) }), 409, 'approval_in_execution');
    // bereits freigegebene Positionen bleiben unverändert und ausführbar
    const items = await itemsOf(wo.id, approval.id);
    const b = items.find((i) => i.title === 'B-Beläge');
    expect(b?.authorization).toBe('approved');
    expect(b?.unitPriceCents).toBe(5000);
    expect(items.find((i) => i.title === 'A-Scheiben')?.executionStatus).toBe('done');
  });

  it('vor Arbeitsbeginn erzeugt eine Überarbeitung eine neue Version, die neu entschieden werden muss', async () => {
    const { customer, wo, approval } = await orderWithApproval([line('A-Scheiben', 10000), line('B-Beläge', 5000)]);
    expectOk(await decide(h, customer.token, approval.id, approval.currentVersion.id, approval.currentVersion.contentHash, 'approved'), ApprovalRequestSchema);
    const v2 = expectOk(await call(h, 'PUT', `/approvals/${approval.id}`, { token: w.service.token, body: draftBody([line('A-Scheiben', 10000), line('B-Beläge', 6000)]) }), ApprovalRequestSchema);
    expect(v2.currentVersion.versionNo).toBe(2);
    const pending = await itemsOf(wo.id, approval.id);
    expect(pending.every((i) => i.authorization === 'pending_approval')).toBe(true);
    expectOk(await decide(h, customer.token, approval.id, v2.currentVersion.id, v2.currentVersion.contentHash, 'approved'), ApprovalRequestSchema);
    const items = await itemsOf(wo.id, approval.id);
    expect(items.find((i) => i.title === 'B-Beläge')?.unitPriceCents).toBe(6000);
    expect(items.every((i) => i.authorization === 'approved')).toBe(true);
  });
});

describe('Stornierung zieht offene Freigabeanfragen zurück', () => {
  it('nach Stornierung kann der Kunde nicht mehr entscheiden; die Anfrage ist zurückgezogen', async () => {
    const { customer, wo, approval } = await orderWithApproval([line('Scheiben', 20000)]);
    expectOk(await call(h, 'POST', `/work-orders/${wo.id}/transition`, { token: w.service.token, body: { to: 'cancelled', reason: 'Kunde storniert' } }), WorkOrderDetailSchema);
    const after = expectOk(await call(h, 'GET', `/approvals/${approval.id}`, { token: w.service.token }), ApprovalRequestSchema);
    expect(after.status).toBe('withdrawn');
    const res = await decide(h, customer.token, approval.id, approval.currentVersion.id, approval.currentVersion.contentHash, 'approved');
    expect(res.statusCode).toBe(409);
    const items = await itemsOf(wo.id, approval.id);
    expect(items.every((i) => i.authorization === 'withdrawn')).toBe(true);
  });
});
