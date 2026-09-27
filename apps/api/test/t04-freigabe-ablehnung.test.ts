import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApprovalRequestSchema, AuditEntrySchema, WorkItemSchema, WorkOrderDetailSchema } from '@werkstatt/contracts';
import { call, createHarness, expectOk, expectStatus, type Harness } from './support/harness';
import { createAndSendApproval, createWorkOrder, customerWithVehicle, decide, item, line, setupWorkshop, type Workshop } from './support/scenario';

let h: Harness;
let w: Workshop;
beforeAll(async () => {
  h = await createHarness();
  w = await setupWorkshop(h);
});
afterAll(async () => h?.close());

describe('T-04 Freigabe und Ablehnung von Zusatzarbeiten', () => {
  it('nur der Kunde entscheidet; Ablehnung betrifft nur diese Positionen; abgelehnte Position ist gesperrt', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Freigabe');
    const wo = await createWorkOrder(h, w.service.token, {
      customerId: customer.customerId!,
      vehicleId,
      assigneeIds: [w.mechanic.id],
      items: [item('Inspektion (vereinbart)')],
    });
    // Mechaniker kann keine Freigabe anfragen
    expectStatus(
      await call(h, 'POST', `/work-orders/${wo.id}/approvals`, {
        token: w.mechanic.token,
        body: { kind: 'additional_work', title: 'x', summaryCustomer: 'x', lines: [line('x', 100)] },
      }),
      403,
    );
    const brakes = await createAndSendApproval(h, w.service.token, wo.id, [line('Bremsbeläge vorne', 14000), line('Bremsscheiben vorne', 18000)], 'Bremsen');
    const wipers = await createAndSendApproval(h, w.service.token, wo.id, [line('Wischerblätter', 2500)], 'Wischer');
    expect(brakes.status).toBe('pending_customer');
    expect(brakes.currentVersion.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const v = brakes.currentVersion;
    // Mitarbeiter, Admin und Mechaniker können nicht im Namen des Kunden entscheiden
    for (const staff of [w.mechanic, w.service, w.admin]) {
      const res = await decide(h, staff.token, brakes.id, v.id, v.contentHash, 'approved');
      expect(res.statusCode, staff.role).toBe(403);
    }

    // Ein "Ja" im Chat ist keine Freigabe
    await call(h, 'POST', `/work-orders/${wo.id}/messages`, { token: customer.token, body: { clientMessageId: 'chat-ja-0001', body: 'Ja, bitte alles machen.' } });
    const stillPending = expectOk(await call(h, 'GET', `/approvals/${brakes.id}`, { token: w.service.token }), ApprovalRequestSchema);
    expect(stillPending.status).toBe('pending_customer');

    // Kunde lehnt die Bremsen ab
    const rejected = expectOk(await decide(h, customer.token, brakes.id, v.id, v.contentHash, 'rejected'), ApprovalRequestSchema);
    expect(rejected.status).toBe('rejected');
    expect(rejected.currentVersion.decision?.decision).toBe('rejected');
    // zweite Entscheidung zur selben Fassung nicht möglich
    expectStatus(await decide(h, customer.token, brakes.id, v.id, v.contentHash, 'approved'), 409, 'already_decided');

    const detail = expectOk(await call(h, 'GET', `/work-orders/${wo.id}`, { token: w.service.token }), WorkOrderDetailSchema);
    const byTitle = (t: string) => detail.items.find((i) => i.title === t)!;
    expect(byTitle('Bremsbeläge vorne').authorization).toBe('rejected');
    expect(byTitle('Bremsscheiben vorne').authorization).toBe('rejected');
    expect(byTitle('Wischerblätter').authorization).toBe('pending_approval');
    expect(byTitle('Inspektion (vereinbart)').authorization).toBe('agreed');

    // abgelehnte Position kann nicht gestartet werden; wartende auch nicht
    expectStatus(await call(h, 'POST', `/work-items/${byTitle('Bremsbeläge vorne').id}/start`, { token: w.mechanic.token }), 403);
    expectStatus(await call(h, 'POST', `/work-items/${byTitle('Wischerblätter').id}/start`, { token: w.mechanic.token }), 403);

    // separat freigegebene Arbeit bleibt unberührt und ist danach ausführbar
    const approved = expectOk(
      await decide(h, customer.token, wipers.id, wipers.currentVersion.id, wipers.currentVersion.contentHash, 'approved'),
      ApprovalRequestSchema,
    );
    expect(approved.status).toBe('approved');
    const started = expectOk(await call(h, 'POST', `/work-items/${byTitle('Wischerblätter').id}/start`, { token: w.mechanic.token }), WorkItemSchema);
    expect(started.authorization).toBe('approved');
    expect(started.executionStatus).toBe('in_progress');

    // Protokoll: Person, Zeitpunkt, Umfang, Betrag, Inhalts-Hash
    const audit = expectOk(
      await call(h, 'GET', '/audit', { token: w.admin.token, query: { entityType: 'approval_request', entityId: brakes.id, action: 'approval.decided' } }),
      z.array(AuditEntrySchema),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorRole).toBe('customer');
    expect(audit[0]!.data).toMatchObject({ decision: 'rejected', contentHash: v.contentHash, totalGrossCents: v.totalGrossCents, versionId: v.id });
  });

  it('Entscheidung verlangt eine gesendete Anfrage (Entwurf: 404 für Kunden)', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'EntwurfFreigabe');
    const wo = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId });
    const draft = expectOk(
      await call(h, 'POST', `/work-orders/${wo.id}/approvals`, {
        token: w.service.token,
        body: { kind: 'offer', title: 'Angebot', summaryCustomer: 'Angebot', lines: [line('Klimaservice', 9900)] },
      }),
      ApprovalRequestSchema,
      201,
    );
    expectStatus(await call(h, 'GET', `/approvals/${draft.id}`, { token: customer.token }), 404);
    expectStatus(await decide(h, customer.token, draft.id, draft.currentVersion.id, draft.currentVersion.contentHash, 'approved'), 404);
    // Positionen eines Entwurfs sind im Auftrag noch nicht enthalten (keine Preise vor dem Senden)
    const detail = expectOk(await call(h, 'GET', `/work-orders/${wo.id}`, { token: customer.token }), WorkOrderDetailSchema);
    expect(detail.items).toHaveLength(0);
  });
});
