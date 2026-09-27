import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  InvoiceSchema,
  PageSchema,
  StaffUserSchema,
  WorkItemSchema,
  WorkOrderDetailSchema,
  WorkOrderSummarySchema,
} from '@werkstatt/contracts';
import { call, createHarness, createStaff, expectOk, expectStatus, type Harness } from './support/harness';
import { createWorkOrder, customerWithVehicle, issueInvoice, item, setupWorkshop, type Workshop } from './support/scenario';

let h: Harness;
let w: Workshop;
beforeAll(async () => {
  h = await createHarness();
  w = await setupWorkshop(h);
});
afterAll(async () => h?.close());

describe('T-03 unterschiedliche Mitarbeiterrechte', () => {
  it('Mechaniker sieht nur zugewiesene Aufträge, keine Preise, keine Rechnungen', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Rechte');
    const assigned = await createWorkOrder(h, w.service.token, {
      customerId: customer.customerId!,
      vehicleId,
      assigneeIds: [w.mechanic.id],
      items: [item('Diagnose', { unitPriceCents: 12000 })],
    });
    const other = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId, items: [item('Anderes')] });
    await call(h, 'PATCH', `/work-orders/${assigned.id}`, { token: w.service.token, body: { costLimitCents: 50000 } });

    const list = expectOk(await call(h, 'GET', '/work-orders', { token: w.mechanic.token }), PageSchema(WorkOrderSummarySchema));
    expect(list.items.map((o) => o.id)).toEqual([assigned.id]);
    expectStatus(await call(h, 'GET', `/work-orders/${other.id}`, { token: w.mechanic.token }), 403);

    const detail = expectOk(await call(h, 'GET', `/work-orders/${assigned.id}`, { token: w.mechanic.token }), WorkOrderDetailSchema);
    expect(detail.items[0]).not.toHaveProperty('unitPriceCents');
    expect(detail).not.toHaveProperty('costLimitCents');
    // Zahlungsstatus nur als Kennzeichen, keine Beträge
    expect(detail.status.payment).toBe('no_invoice');

    const invoice = await issueInvoice(h, w.service.token, { customerId: customer.customerId!, workOrderId: assigned.id, totalGrossCents: 14280 });
    expectStatus(await call(h, 'GET', '/invoices', { token: w.mechanic.token }), 403);
    expectStatus(await call(h, 'GET', `/invoices/${invoice.id}`, { token: w.mechanic.token }), 403);
    expectStatus(await call(h, 'GET', '/exports/invoices.csv', { token: w.mechanic.token }), 403);
    expectStatus(await call(h, 'GET', `/work-orders/${assigned.id}/approvals`, { token: w.mechanic.token }), 403);
    expectStatus(await call(h, 'GET', '/users', { token: w.mechanic.token }), 403);
    const after = expectOk(await call(h, 'GET', `/work-orders/${assigned.id}`, { token: w.mechanic.token }), WorkOrderDetailSchema);
    expect(after.status.payment).toBe('open');
  });

  it('Service ohne payments.refund erhält 403; nach Override durch Admin erlaubt', async () => {
    const { customer } = await customerWithVehicle(h, 'Erstattung');
    const invoice = await issueInvoice(h, w.service.token, { customerId: customer.customerId!, totalGrossCents: 5000 });
    const paid = expectOk(
      await call(h, 'POST', `/invoices/${invoice.id}/payments/manual`, {
        token: w.admin.token,
        body: { method: 'bank_transfer', amountCents: 5000, receivedAt: new Date().toISOString(), referenceText: 'Überweisung [TEST]' },
      }),
      InvoiceSchema,
    );
    const paymentId = paid.payments[0]!.id;
    const service = await createStaff(h, 'service');
    expectStatus(
      await call(h, 'POST', `/payments/${paymentId}/refunds`, { token: service.token, body: { amountCents: 1000, idempotencyKey: 'refund-t03-0001', reason: 'Kulanz' } }),
      403,
    );
    // Service darf manuell keine Zahlung zuordnen (Recht nicht Standard)
    expectStatus(
      await call(h, 'POST', `/invoices/${invoice.id}/payments/manual`, {
        token: service.token,
        body: { method: 'cash', amountCents: 100, receivedAt: new Date().toISOString(), referenceText: 'Bar' },
      }),
      403,
    );
    const updated = expectOk(
      await call(h, 'PATCH', `/users/${service.id}`, { token: w.admin.token, body: { permissionOverrides: [{ permission: 'payments.refund', granted: true }] } }),
      StaffUserSchema,
    );
    expect(updated.effectivePermissions).toContain('payments.refund');
    const refunded = expectOk(
      await call(h, 'POST', `/payments/${paymentId}/refunds`, { token: service.token, body: { amountCents: 1000, idempotencyKey: 'refund-t03-0002', reason: 'Kulanz' } }),
      InvoiceSchema,
    );
    expect(refunded.refundedCents).toBe(1000);
    expect(refunded.paymentStatus).toBe('partially_refunded');
  });

  it('nicht zuweisbare Rechte und Admin-Schutz', async () => {
    // Mechaniker kann invoices.read nie erhalten
    const res = await call(h, 'PATCH', `/users/${w.mechanic.id}`, {
      token: w.admin.token,
      body: { permissionOverrides: [{ permission: 'invoices.read', granted: true }] },
    });
    expectStatus(res, 422, 'permission_change_rejected');
    // Service verwaltet keine Benutzer
    expectStatus(await call(h, 'GET', '/users', { token: w.service.token }), 403);
    expectStatus(await call(h, 'POST', `/users/${w.admin.id}/disable`, { token: w.service.token }), 403);
    // Letzter aktiver Admin: nicht deaktivierbar, users.manage nicht entziehbar, Rolle nicht wechselbar
    const users = expectOk(await call(h, 'GET', '/users', { token: w.admin.token }), z.array(StaffUserSchema));
    expect(users.filter((u) => u.role === 'admin' && u.status === 'active')).toHaveLength(1);
    expectStatus(await call(h, 'POST', `/users/${w.admin.id}/disable`, { token: w.admin.token }), 422);
    expectStatus(
      await call(h, 'PATCH', `/users/${w.admin.id}`, { token: w.admin.token, body: { permissionOverrides: [{ permission: 'users.manage', granted: false }] } }),
      422,
    );
    expectStatus(await call(h, 'PATCH', `/users/${w.admin.id}`, { token: w.admin.token, body: { role: 'service' } }), 422);
  });

  it('Deaktivierung beendet Sitzungen sofort', async () => {
    const mech = await createStaff(h, 'mechanic');
    expectStatus(await call(h, 'GET', '/auth/me', { token: mech.token }), 200);
    expectOk(await call(h, 'POST', `/users/${mech.id}/disable`, { token: w.admin.token }), StaffUserSchema);
    expectStatus(await call(h, 'GET', '/auth/me', { token: mech.token }), 401);
    const login = await call(h, 'POST', '/auth/login', { body: { email: mech.email, password: 'Test-Passwort-123' } });
    expectStatus(login, 403, 'account_disabled');
  });
});

describe('Präzisierte Regeln (Lead, Commit 7c547ba)', () => {
  it('Kunden sehen Aufträge im Status draft nicht (404), nach Freischaltung schon', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Entwurf');
    const draft = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId, items: [item('Vorab')] }, { draft: 'true' });
    expect(draft.status.work).toBe('draft');
    expectStatus(await call(h, 'GET', `/work-orders/${draft.id}`, { token: customer.token }), 404);
    expectStatus(await call(h, 'GET', `/work-orders/${draft.id}/messages`, { token: customer.token }), 404);
    const list = expectOk(await call(h, 'GET', '/work-orders', { token: customer.token }), PageSchema(WorkOrderSummarySchema));
    expect(list.items.map((o) => o.id)).not.toContain(draft.id);
    // Werkstatt sieht den Entwurf
    expectOk(await call(h, 'GET', `/work-orders/${draft.id}`, { token: w.service.token }), WorkOrderDetailSchema);
    expectOk(await call(h, 'POST', `/work-orders/${draft.id}/transition`, { token: w.service.token, body: { to: 'open' } }), WorkOrderDetailSchema);
    const visible = expectOk(await call(h, 'GET', `/work-orders/${draft.id}`, { token: customer.token }), WorkOrderDetailSchema);
    expect(visible.status.work).toBe('open');
  });

  it('Mechaniker führt nicht zugewiesene Positionen seines Auftrags aus, nie fremd zugewiesene', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Zuweisung');
    const colleague = await createStaff(h, 'mechanic');
    const wo = await createWorkOrder(h, w.service.token, {
      customerId: customer.customerId!,
      vehicleId,
      assigneeIds: [w.mechanic.id],
      items: [item('Ohne Zuweisung'), item('Kollege', { assignedTo: colleague.id })],
    });
    const [free, foreign] = wo.items;
    const started = expectOk(await call(h, 'POST', `/work-items/${free!.id}/start`, { token: w.mechanic.token }), WorkItemSchema);
    expect(started.executionStatus).toBe('in_progress');
    expectStatus(await call(h, 'POST', `/work-items/${foreign!.id}/start`, { token: w.mechanic.token }), 403);
    // der Kollege darf seine eigene Position ausführen
    expectOk(await call(h, 'POST', `/work-items/${foreign!.id}/start`, { token: colleague.token }), WorkItemSchema);
    // ein nicht zugewiesener Mechaniker darf gar nichts im Auftrag ausführen
    const stranger = await createStaff(h, 'mechanic');
    expectStatus(await call(h, 'POST', `/work-items/${free!.id}/pause`, { token: stranger.token }), 403);
  });
});
