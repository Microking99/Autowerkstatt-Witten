import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  AppointmentSchema,
  FindingSchema,
  NOTIFICATION_EVENTS,
  NotificationSchema,
  StartCheckoutResponseSchema,
  WorkOrderDetailSchema,
  routes,
  type NotificationDto,
} from '@werkstatt/contracts';
import { checkouts } from '../src/db/schema/index';
import { notifyMaintenanceDue } from '../src/services/maintenance';
import { call, createCustomer, createHarness, createStaff, expectOk, type Harness, type TestUser } from './support/harness';
import { createAndSendApproval, createWorkOrder, customerWithVehicle, decide, issueInvoice, item, line, setupWorkshop, type Workshop } from './support/scenario';

let h: Harness;
let w: Workshop;
beforeAll(async () => {
  h = await createHarness();
  w = await setupWorkshop(h);
});
afterAll(async () => h?.close());

/** Übersetzt einen App-Zielpfad in den API-Abruf, den die Zielansicht macht. */
function apiForTarget(path: string): string {
  const rules: [RegExp, (m: RegExpExecArray) => string][] = [
    [/^\/(?:kunde|werkstatt)\/auftraege\/([^/]+)\/freigaben\/([^/]+)$/, (m) => `/approvals/${m[2]}`],
    [/^\/(?:kunde|werkstatt)\/auftraege\/([^/]+)\/chat$/, (m) => `/work-orders/${m[1]}/messages`],
    [/^\/werkstatt\/auftraege\/([^/]+)\/arbeiten$/, (m) => `/work-orders/${m[1]}`],
    [/^\/(?:kunde|mechaniker)\/auftraege\/([^/]+)$/, (m) => `/work-orders/${m[1]}`],
    [/^\/(?:kunde|werkstatt)\/rechnungen\/([^/]+)$/, (m) => `/invoices/${m[1]}`],
    [/^\/(?:kunde|werkstatt)\/termine\/([^/]+)$/, (m) => `/appointments/${m[1]}`],
    [/^\/kunde\/fahrzeuge\/([^/]+)$/, (m) => `/vehicles/${m[1]}`],
  ];
  for (const [re, fn] of rules) {
    const m = re.exec(path);
    if (m) return fn(m);
  }
  throw new Error(`Unbekannter Zielpfad: ${path}`);
}

async function notificationsOf(user: TestUser): Promise<NotificationDto[]> {
  return expectOk(await call(h, 'GET', '/notifications', { token: user.token }), z.array(NotificationSchema));
}

async function expectLink(recipient: TestUser, eventType: NotificationDto['eventType'], expectedPath: string, outsider: TestUser) {
  const note = (await notificationsOf(recipient)).find((n) => n.eventType === eventType && n.targetPath === expectedPath);
  expect(note, `${eventType} → ${expectedPath}`).toBeDefined();
  // nur Pfad mit IDs, keine Inhalte oder Tokens; keine Beträge im Text
  expect(note!.targetPath).toMatch(/^\/[a-z]+(\/[a-z0-9-]+)*$/);
  expect(`${note!.title} ${note!.body}`).not.toMatch(/€|EUR|\d+,\d{2}/);
  const api = apiForTarget(note!.targetPath);
  expect((await call(h, 'GET', api, { token: recipient.token })).statusCode, `${eventType} Empfänger ${api}`).toBe(200);
  const other = (await call(h, 'GET', api, { token: outsider.token })).statusCode;
  expect([403, 404], `${eventType} Außenstehender ${api}`).toContain(other);
  return note!;
}

describe('T-11 Benachrichtigungslinks führen zum richtigen Vorgang', () => {
  it('jedes Ereignis hat den Zielpfad aus docs/ansichten-und-routen.md Abschnitt 6', async () => {
    const seen = new Set<string>();
    const { customer, vehicleId } = await customerWithVehicle(h, 'Hinweis');
    const outsiderCustomer = await createCustomer(h, 'Aussen');
    const outsiderMechanic = await createStaff(h, 'mechanic');
    const wo = await createWorkOrder(h, w.service.token, {
      customerId: customer.customerId!,
      vehicleId,
      assigneeIds: [w.mechanic.id],
      items: [item('Ölwechsel', { maintenanceTypeId: w.oilChangeTypeId })],
    });

    // Freigabe angefragt → Kunde
    const approval = await createAndSendApproval(h, w.service.token, wo.id, [line('Luftfilter', 3900)]);
    await expectLink(customer, 'approval.requested', routes.customer.approval(wo.id, approval.id), outsiderCustomer);
    seen.add('approval.requested');

    // Kunde entscheidet → Service und zugewiesener Mechaniker
    await decide(h, customer.token, approval.id, approval.currentVersion.id, approval.currentVersion.contentHash, 'approved');
    await expectLink(w.service, 'approval.decided', routes.workshop.approval(wo.id, approval.id), outsiderMechanic);
    await expectLink(w.mechanic, 'approval.decided', routes.mechanic.workOrder(wo.id), outsiderMechanic);
    seen.add('approval.decided');

    // Nachrichten → Gegenseite
    await call(h, 'POST', `/work-orders/${wo.id}/messages`, { token: customer.token, body: { clientMessageId: 'hinweis-0001', body: 'Frage' } });
    await expectLink(w.service, 'message.received', routes.workshop.workOrderTab(wo.id, 'chat'), outsiderMechanic);
    await call(h, 'POST', `/work-orders/${wo.id}/messages`, { token: w.service.token, body: { clientMessageId: 'hinweis-0002', body: 'Antwort' } });
    await expectLink(customer, 'message.received', routes.customer.chat(wo.id), outsiderCustomer);
    seen.add('message.received');

    // Zusatzarbeit gemeldet → Service
    const finding = expectOk(
      await call(h, 'POST', `/work-orders/${wo.id}/findings`, { token: w.mechanic.token, body: { description: 'Bremsbeläge verschlissen', severity: 'urgent' } }),
      FindingSchema,
      201,
    );
    expectOk(await call(h, 'POST', `/findings/${finding.id}/report`, { token: w.mechanic.token }), FindingSchema);
    await expectLink(w.service, 'finding.reported', routes.workshop.workOrderTab(wo.id, 'arbeiten'), outsiderMechanic);
    seen.add('finding.reported');

    // Arbeiten erledigt, abholbereit → Kunde
    const detail = expectOk(await call(h, 'GET', `/work-orders/${wo.id}`, { token: w.service.token }), WorkOrderDetailSchema);
    for (const i of detail.items) {
      await call(h, 'POST', `/work-items/${i.id}/finish`, { token: w.mechanic.token, body: { odometerKm: 90000 } });
    }
    expectOk(await call(h, 'POST', `/work-orders/${wo.id}/ready-for-pickup`, { token: w.service.token }), WorkOrderDetailSchema);
    await expectLink(customer, 'work_order.ready_for_pickup', routes.customer.workOrder(wo.id), outsiderCustomer);
    seen.add('work_order.ready_for_pickup');

    // Rechnung bereitgestellt → Kunde; Zahlung bestätigt → Kunde und Service
    const invoice = await issueInvoice(h, w.service.token, { customerId: customer.customerId!, workOrderId: wo.id, totalGrossCents: 18900 });
    await expectLink(customer, 'invoice.issued', routes.customer.invoice(invoice.id), outsiderCustomer);
    seen.add('invoice.issued');
    const start = expectOk(await call(h, 'POST', `/invoices/${invoice.id}/checkout`, { token: customer.token }), StartCheckoutResponseSchema);
    const [chk] = await h.db.select().from(checkouts).where(eq(checkouts.id, start.checkoutId));
    h.fake.markPaid(chk!.providerCheckoutId!);
    await call(h, 'POST', '/webhooks/sumup', { body: { event_type: 'CHECKOUT_STATUS_CHANGED', id: chk!.providerCheckoutId } });
    await expectLink(customer, 'payment.confirmed', routes.customer.invoice(invoice.id), outsiderCustomer);
    await expectLink(w.service, 'payment.confirmed', routes.workshop.invoice(invoice.id), outsiderMechanic);
    seen.add('payment.confirmed');

    // Terminanfrage → Service; Alternative und Bestätigung → Kunde
    const request = expectOk(
      await call(h, 'POST', '/appointments/requests', {
        token: customer.token,
        body: { kind: 'service', vehicleId, preferredStart: '2027-03-01T08:00:00.000Z', preferredEnd: '2027-03-01T10:00:00.000Z' },
      }),
      AppointmentSchema,
      201,
    );
    expect(request.status).toBe('requested');
    await expectLink(w.service, 'appointment.requested', routes.workshop.appointment(request.id), outsiderMechanic);
    seen.add('appointment.requested');
    expectOk(
      await call(h, 'POST', `/appointments/${request.id}/proposals`, {
        token: w.service.token,
        body: { startsAt: '2027-03-02T08:00:00.000Z', endsAt: '2027-03-02T10:00:00.000Z' },
      }),
      AppointmentSchema,
    );
    await expectLink(customer, 'appointment.proposed', routes.customer.appointment(request.id), outsiderCustomer);
    seen.add('appointment.proposed');
    const second = expectOk(
      await call(h, 'POST', '/appointments/requests', {
        token: customer.token,
        body: { kind: 'repair', vehicleId, preferredStart: '2027-03-05T08:00:00.000Z', preferredEnd: '2027-03-05T09:00:00.000Z' },
      }),
      AppointmentSchema,
      201,
    );
    expectOk(await call(h, 'POST', `/appointments/${second.id}/confirm`, { token: w.service.token, body: { overrideConflictsReason: 'Test ohne Öffnungszeiten' } }), AppointmentSchema);
    await expectLink(customer, 'appointment.confirmed', routes.customer.appointment(second.id), outsiderCustomer);
    seen.add('appointment.confirmed');

    // Wartung bald fällig → Kunde (Ölwechsel alle 12 Monate)
    expectOk(await call(h, 'POST', `/work-orders/${wo.id}/complete-review`, { token: w.service.token, body: { confirm: true } }), WorkOrderDetailSchema);
    // Fälligkeitslauf mit Zeitpunkt ~11,5 Monate später (App-Uhr bleibt, Sitzungen gelten weiter)
    const later = () => new Date(Date.now() + 350 * 86_400_000);
    await notifyMaintenanceDue({ db: h.db, now: later });
    await notifyMaintenanceDue({ db: h.db, now: later });
    const dueNotes = (await notificationsOf(customer)).filter((n) => n.eventType === 'maintenance.due_soon');
    expect(dueNotes).toHaveLength(1);
    await expectLink(customer, 'maintenance.due_soon', routes.customer.vehicle(vehicleId), outsiderCustomer);
    seen.add('maintenance.due_soon');

    expect([...seen].sort()).toEqual([...NOTIFICATION_EVENTS].sort());
  });

  it('als gelesen markieren nur eigene Benachrichtigungen', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Gelesen');
    const other = await createCustomer(h, 'Andere');
    const wo = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId });
    await call(h, 'POST', `/work-orders/${wo.id}/messages`, { token: w.service.token, body: { clientMessageId: 'gelesen-0001', body: 'Hallo' } });
    const [note] = await notificationsOf(customer);
    expect((await call(h, 'POST', `/notifications/${note!.id}/read`, { token: other.token })).statusCode).toBe(404);
    expect((await call(h, 'POST', `/notifications/${note!.id}/read`, { token: customer.token })).statusCode).toBe(204);
    const [after] = await notificationsOf(customer);
    expect(after!.readAt).not.toBeNull();
  });
});
