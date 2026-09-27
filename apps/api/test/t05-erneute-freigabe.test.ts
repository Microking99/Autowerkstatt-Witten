import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApprovalRequestSchema, NotificationSchema, WorkOrderDetailSchema, routes } from '@werkstatt/contracts';
import { call, createHarness, expectOk, expectStatus, type Harness } from './support/harness';
import { createAndSendApproval, createWorkOrder, customerWithVehicle, decide, line, setupWorkshop, type Workshop } from './support/scenario';

let h: Harness;
let w: Workshop;
beforeAll(async () => {
  h = await createHarness();
  w = await setupWorkshop(h);
});
afterAll(async () => h?.close());

describe('T-05 erneute Freigabe nach Änderung', () => {
  it('alter Hash → 409, neue Version entscheidbar, Kunde wird benachrichtigt', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Version');
    const wo = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId, assigneeIds: [w.mechanic.id] });
    const sent = await createAndSendApproval(h, w.service.token, wo.id, [line('Zahnriemen', 45000)], 'Zahnriemen');
    const v1 = sent.currentVersion;

    const notesBefore = expectOk(await call(h, 'GET', '/notifications', { token: customer.token }), z.array(NotificationSchema));
    expect(notesBefore.filter((n) => n.eventType === 'approval.requested')).toHaveLength(1);

    // Werkstatt ändert den Preis nach dem Senden → neue Version
    const revised = expectOk(
      await call(h, 'PUT', `/approvals/${sent.id}`, {
        token: w.service.token,
        body: { kind: 'additional_work', title: 'Zahnriemen', summaryCustomer: 'Bei der Prüfung festgestellt.', lines: [line('Zahnriemen', 52000)], photoIds: [] },
      }),
      ApprovalRequestSchema,
    );
    expect(revised.status).toBe('pending_customer');
    expect(revised.currentVersion.versionNo).toBe(2);
    expect(revised.currentVersion.contentHash).not.toBe(v1.contentHash);
    expect(revised.versions.find((v) => v.id === v1.id)!.supersededAt).not.toBeNull();

    // Entscheidung zur alten Version (alter Hash) → 409
    expectStatus(await decide(h, customer.token, sent.id, v1.id, v1.contentHash, 'approved'), 409, 'version_superseded');
    // aktuelle Version mit falschem Hash → 409
    expectStatus(await decide(h, customer.token, sent.id, revised.currentVersion.id, v1.contentHash, 'approved'), 409, 'hash_mismatch');

    // Benachrichtigung zur neuen Version mit Ziel = Freigabe-Ansicht des Kunden
    const notes = expectOk(await call(h, 'GET', '/notifications', { token: customer.token }), z.array(NotificationSchema));
    const approvalNotes = notes.filter((n) => n.eventType === 'approval.requested');
    expect(approvalNotes).toHaveLength(2);
    expect(approvalNotes.every((n) => n.targetPath === routes.customer.approval(wo.id, sent.id))).toBe(true);

    // Kunde sieht nur gesendete Versionen, entscheidet über die neue Version
    const view = expectOk(await call(h, 'GET', `/approvals/${sent.id}`, { token: customer.token }), ApprovalRequestSchema);
    expect(view.versions.map((v) => v.versionNo)).toEqual([1, 2]);
    const decided = expectOk(
      await decide(h, customer.token, sent.id, view.currentVersion.id, view.currentVersion.contentHash, 'approved'),
      ApprovalRequestSchema,
    );
    expect(decided.status).toBe('approved');
    expect(decided.currentVersion.decision?.contentHash).toBe(view.currentVersion.contentHash);
    const detail = expectOk(await call(h, 'GET', `/work-orders/${wo.id}`, { token: w.service.token }), WorkOrderDetailSchema);
    expect(detail.items.find((i) => i.title === 'Zahnriemen')).toMatchObject({ authorization: 'approved', unitPriceCents: 52000 });
  });

  it('Änderung nach Freigabe erzwingt neue Entscheidung; gleicher Inhalt erzeugt keine Version', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Nachtrag');
    const wo = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId });
    const sent = await createAndSendApproval(h, w.service.token, wo.id, [line('Ölleck abdichten', 8000)], 'Ölleck');
    expectOk(await decide(h, customer.token, sent.id, sent.currentVersion.id, sent.currentVersion.contentHash, 'approved'), ApprovalRequestSchema);
    const body = { kind: 'additional_work', title: 'Ölleck', summaryCustomer: 'Bei der Prüfung festgestellt.', photoIds: [] };
    const same = expectOk(await call(h, 'PUT', `/approvals/${sent.id}`, { token: w.service.token, body: { ...body, lines: [line('Ölleck abdichten', 8000)] } }), ApprovalRequestSchema);
    expect(same.versions).toHaveLength(1);
    expect(same.status).toBe('approved');
    const changed = expectOk(
      await call(h, 'PUT', `/approvals/${sent.id}`, { token: w.service.token, body: { ...body, lines: [line('Ölleck abdichten', 8000), line('Dichtung', 1500)] } }),
      ApprovalRequestSchema,
    );
    expect(changed.status).toBe('pending_customer');
    const detail = expectOk(await call(h, 'GET', `/work-orders/${wo.id}`, { token: w.service.token }), WorkOrderDetailSchema);
    expect(detail.items.map((i) => i.authorization)).toEqual(['pending_approval', 'pending_approval']);
  });
});
