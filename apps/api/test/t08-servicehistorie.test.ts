import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  ApprovalRequestSchema,
  MaintenanceDueSchema,
  ServiceEntrySchema,
  StartCheckoutResponseSchema,
  WorkItemSchema,
  WorkOrderDetailSchema,
} from '@werkstatt/contracts';
import { checkouts, serviceEntries } from '../src/db/schema/index';
import { call, createHarness, expectOk, expectStatus, type Harness } from './support/harness';
import { createAndSendApproval, createWorkOrder, customerWithVehicle, decide, issueInvoice, item, line, setupWorkshop, type Workshop } from './support/scenario';

let h: Harness;
let w: Workshop;
beforeAll(async () => {
  h = await createHarness();
  w = await setupWorkshop(h);
});
afterAll(async () => h?.close());

async function entriesOf(vehicleId: string) {
  return h.db.select().from(serviceEntries).where(eq(serviceEntries.vehicleId, vehicleId));
}

describe('T-08 Servicehistorie', () => {
  it('Einträge nur aus fachlich abgeschlossener Arbeit, nie aus Angebot, Freigabe, Rechnung oder Zahlung; genau einmal', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Service');
    const wo = await createWorkOrder(h, w.service.token, {
      customerId: customer.customerId!,
      vehicleId,
      assigneeIds: [w.mechanic.id],
      items: [item('Ölwechsel', { maintenanceTypeId: w.oilChangeTypeId })],
    });
    // Angebot/Freigabe mit Wartungsarbeit: freigegeben, aber (noch) nicht ausgeführt
    const fluid = await createAndSendApproval(h, w.service.token, wo.id, [line('Bremsflüssigkeit wechseln', 6900, { maintenanceTypeId: w.brakeFluidTypeId })], 'Bremsflüssigkeit');
    expectOk(await decide(h, customer.token, fluid.id, fluid.currentVersion.id, fluid.currentVersion.contentHash, 'approved'), ApprovalRequestSchema);
    // abgelehnte Wartungsarbeit
    const rejected = await createAndSendApproval(h, w.service.token, wo.id, [line('Zahnriemen', 45000, { maintenanceTypeId: w.oilChangeTypeId })], 'Zahnriemen');
    expectOk(await decide(h, customer.token, rejected.id, rejected.currentVersion.id, rejected.currentVersion.contentHash, 'rejected'), ApprovalRequestSchema);
    // Rechnung gestellt und bezahlt
    const invoice = await issueInvoice(h, w.service.token, { customerId: customer.customerId!, workOrderId: wo.id, totalGrossCents: 20000 });
    const start = expectOk(await call(h, 'POST', `/invoices/${invoice.id}/checkout`, { token: customer.token }), StartCheckoutResponseSchema);
    const [chk] = await h.db.select().from(checkouts).where(eq(checkouts.id, start.checkoutId));
    h.fake.markPaid(chk!.providerCheckoutId!);
    await call(h, 'POST', '/webhooks/sumup', { body: { event_type: 'CHECKOUT_STATUS_CHANGED', id: chk!.providerCheckoutId } });
    expect(await entriesOf(vehicleId)).toHaveLength(0);

    // Mechaniker erledigt den Ölwechsel (km-Stand Pflicht bei Wartungsarbeit)
    const detail = expectOk(await call(h, 'GET', `/work-orders/${wo.id}`, { token: w.service.token }), WorkOrderDetailSchema);
    const oil = detail.items.find((i) => i.title === 'Ölwechsel')!;
    const fluidItem = detail.items.find((i) => i.title === 'Bremsflüssigkeit wechseln')!;
    expectOk(await call(h, 'POST', `/work-items/${oil.id}/start`, { token: w.mechanic.token }), WorkItemSchema);
    expectStatus(await call(h, 'POST', `/work-items/${oil.id}/finish`, { token: w.mechanic.token, body: {} }), 409, 'odometer_required');
    expectOk(await call(h, 'POST', `/work-items/${oil.id}/finish`, { token: w.mechanic.token, body: { odometerKm: 51000, resultNotes: 'Öl 5W-30' } }), WorkItemSchema);
    expect(await entriesOf(vehicleId)).toHaveLength(0);

    // Abschluss erst, wenn alle ausführbaren Positionen erledigt/nicht durchgeführt sind
    expectStatus(await call(h, 'POST', `/work-orders/${wo.id}/complete-review`, { token: w.service.token, body: { confirm: true } }), 409);
    expectOk(await call(h, 'POST', `/work-items/${fluidItem.id}/not-done`, { token: w.mechanic.token, body: { reason: 'Kunde verschoben' } }), WorkItemSchema);
    const status = expectOk(await call(h, 'GET', `/work-orders/${wo.id}`, { token: w.service.token }), WorkOrderDetailSchema);
    expect(status.status.work).toBe('work_completed');
    expect(await entriesOf(vehicleId)).toHaveLength(0);

    // Mechaniker ohne Recht kann nicht fachlich abschließen
    expectStatus(await call(h, 'POST', `/work-orders/${wo.id}/complete-review`, { token: w.mechanic.token, body: { confirm: true } }), 403);

    const completed = expectOk(
      await call(h, 'POST', `/work-orders/${wo.id}/complete-review`, { token: w.service.token, body: { confirm: true, odometerKm: 51000 } }),
      WorkOrderDetailSchema,
    );
    expect(completed.status.work).toBe('completed');
    const created = await entriesOf(vehicleId);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ title: 'Ölwechsel', odometerKm: 51000, nextDueKm: 66000, intervalMonths: 12, workItemId: oil.id, revisionOfId: null, status: 'valid' });

    // Zweiter Aufruf erzeugt nichts Neues
    expectOk(await call(h, 'POST', `/work-orders/${wo.id}/complete-review`, { token: w.service.token, body: { confirm: true } }), WorkOrderDetailSchema);
    expect(await entriesOf(vehicleId)).toHaveLength(1);

    // Fälligkeit aus dem Eintrag
    const due = expectOk(await call(h, 'GET', `/vehicles/${vehicleId}/maintenance-due`, { token: customer.token }), z.array(MaintenanceDueSchema));
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ maintenanceTypeId: w.oilChangeTypeId, dueKm: 66000 });
  });

  it('Korrektur erzeugt eine Revision statt zu überschreiben', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Korrektur');
    const wo = await createWorkOrder(h, w.service.token, {
      customerId: customer.customerId!,
      vehicleId,
      assigneeIds: [w.mechanic.id],
      items: [item('Ölwechsel', { maintenanceTypeId: w.oilChangeTypeId })],
    });
    await call(h, 'POST', `/work-items/${wo.items[0]!.id}/finish`, { token: w.mechanic.token, body: { odometerKm: 80000 } });
    // Status weiter: open → in_progress → work_completed (automatisch)
    expectOk(await call(h, 'POST', `/work-orders/${wo.id}/complete-review`, { token: w.admin.token, body: { confirm: true } }), WorkOrderDetailSchema);
    const [original] = await entriesOf(vehicleId);

    // Service hat das Recht nicht standardmäßig
    expectStatus(await call(h, 'POST', `/service-entries/${original!.id}/corrections`, { token: w.service.token, body: { odometerKm: 8000, reason: 'Tippfehler' } }), 403);
    const revision = expectOk(
      await call(h, 'POST', `/service-entries/${original!.id}/corrections`, { token: w.admin.token, body: { odometerKm: 8000, reason: 'Tippfehler km-Stand' } }),
      ServiceEntrySchema,
      201,
    );
    expect(revision).toMatchObject({ revisionNo: 2, revisionOfId: original!.id, odometerKm: 8000, nextDueKm: 23000, correctionReason: 'Tippfehler km-Stand', status: 'valid' });
    const all = await entriesOf(vehicleId);
    expect(all).toHaveLength(2);
    expect(all.find((e) => e.id === original!.id)!.status).toBe('superseded');
    // Begründung Pflicht; nur der aktuelle Eintrag ist korrigierbar
    expectStatus(await call(h, 'POST', `/service-entries/${revision.id}/corrections`, { token: w.admin.token, body: { odometerKm: 1 } }), 400);
    expectStatus(await call(h, 'POST', `/service-entries/${original!.id}/corrections`, { token: w.admin.token, body: { odometerKm: 9, reason: 'nochmal' } }), 422, 'not_current');

    const staffView = expectOk(await call(h, 'GET', `/vehicles/${vehicleId}/service-entries`, { token: w.service.token }), z.array(ServiceEntrySchema));
    expect(staffView).toHaveLength(2);
    const customerView = expectOk(await call(h, 'GET', `/vehicles/${vehicleId}/service-entries`, { token: customer.token }), z.array(ServiceEntrySchema));
    expect(customerView.map((e) => e.id)).toEqual([revision.id]);
  });
});
