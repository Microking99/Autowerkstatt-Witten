import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CustomerDetailSchema,
  LoginResponseSchema,
  PageSchema,
  VehicleDetailSchema,
  VehicleSummarySchema,
  WorkOrderDetailSchema,
  WorkOrderSummarySchema,
} from '@werkstatt/contracts';
import { call, createHarness, expectOk, expectStatus, type Harness } from './support/harness';
import { item, setupWorkshop, type Workshop } from './support/scenario';

let h: Harness;
let w: Workshop;
beforeAll(async () => {
  h = await createHarness();
  w = await setupWorkshop(h);
});
afterAll(async () => h?.close());

describe('T-01 Kunde mit mehreren Fahrzeugen', () => {
  it('Kunde sieht beide Fahrzeuge; Auftragsanlage mit Fahrzeugwahl aus seinen Fahrzeugen', async () => {
    // Werkstatt legt Kundendatensatz und zwei Fahrzeuge an
    const customer = expectOk(
      await call(h, 'POST', '/customers', { token: w.service.token, body: { kind: 'private', firstName: '[TEST] Mara', lastName: 'Zwei', isTestData: true } }),
      CustomerDetailSchema,
      201,
    );
    expect(customer.accessStatus).toBe('none');
    const v1 = expectOk(
      await call(h, 'POST', '/vehicles', {
        token: w.service.token,
        body: { licensePlate: 'en-ab 123', make: 'Volkswagen', model: 'Golf', ownerCustomerId: customer.id, isTestData: true },
      }),
      VehicleDetailSchema,
      201,
    );
    expect(v1.licensePlate).toBe('EN-AB 123');
    const v2 = expectOk(
      await call(h, 'POST', '/vehicles', {
        token: w.service.token,
        body: { licensePlate: 'EN-CD 45', make: 'Skoda', model: 'Octavia', vin: 'TMBJJ7NE0K0000001', ownerCustomerId: customer.id, isTestData: true },
      }),
      VehicleDetailSchema,
      201,
    );

    // Werkstatt sieht bei der Auftragsanlage die Fahrzeuge des Kunden
    const choice = expectOk(await call(h, 'GET', '/vehicles', { token: w.service.token, query: { customerId: customer.id } }), PageSchema(VehicleSummarySchema));
    expect(choice.items.map((v) => v.id).sort()).toEqual([v1.id, v2.id].sort());

    // Einladung zur App, Annahme über den Link aus der E-Mail
    expectOk(
      await call(h, 'POST', `/customers/${customer.id}/account/invite`, { token: w.service.token, body: { email: 'mara.zwei@beispiel.test' } }),
      CustomerDetailSchema,
    );
    const mail = h.mailer.sent.find((m) => m.to === 'mara.zwei@beispiel.test');
    const token = /einladung\/([A-Za-z0-9_-]+)/.exec(mail!.text)![1]!;
    const session = expectOk(
      await call(h, 'POST', '/auth/invitations/accept', { body: { token, password: 'Sicheres-Passwort-1' } }),
      LoginResponseSchema,
    );
    expect(session.user.customerId).toBe(customer.id);

    // Kunde sieht beide Fahrzeuge
    const mine = expectOk(await call(h, 'GET', '/vehicles', { token: session.token }), PageSchema(VehicleSummarySchema));
    expect(mine.items.map((v) => v.id).sort()).toEqual([v1.id, v2.id].sort());
    expect(mine.items.every((v) => v.currentOwner === undefined)).toBe(true);

    // Auftrag für das zweite Fahrzeug
    const wo = expectOk(
      await call(h, 'POST', '/work-orders', {
        token: w.service.token,
        body: { customerId: customer.id, vehicleId: v2.id, title: '[TEST] HU-Vorbereitung', items: [item('Durchsicht')] },
      }),
      WorkOrderDetailSchema,
      201,
    );
    expect(wo.vehicleId).toBe(v2.id);
    expect(wo.status).toMatchObject({ work: 'open', approval: 'none', payment: 'no_invoice' });

    const orders = expectOk(await call(h, 'GET', '/work-orders', { token: session.token }), PageSchema(WorkOrderSummarySchema));
    expect(orders.items.map((o) => o.id)).toEqual([wo.id]);
    expect(orders.items[0]!.vehicleLabel).toContain('EN-CD 45');
  });

  it('Auftrag nur mit einem Fahrzeug des gewählten Kunden', async () => {
    const a = expectOk(
      await call(h, 'POST', '/customers', { token: w.service.token, body: { kind: 'private', lastName: '[TEST] A', isTestData: true } }),
      CustomerDetailSchema,
      201,
    );
    const b = expectOk(
      await call(h, 'POST', '/customers', { token: w.service.token, body: { kind: 'private', lastName: '[TEST] B', isTestData: true } }),
      CustomerDetailSchema,
      201,
    );
    const vb = expectOk(
      await call(h, 'POST', '/vehicles', { token: w.service.token, body: { licensePlate: 'EN-X 1', make: 'Opel', model: 'Astra', ownerCustomerId: b.id } }),
      VehicleDetailSchema,
      201,
    );
    const res = await call(h, 'POST', '/work-orders', { token: w.service.token, body: { customerId: a.id, vehicleId: vb.id, title: '[TEST] falsch' } });
    expectStatus(res, 422, 'vehicle_not_owned_by_customer');
  });
});
