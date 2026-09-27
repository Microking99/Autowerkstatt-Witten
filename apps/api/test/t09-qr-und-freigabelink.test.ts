import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { PublicVehicleViewSchema, QrResolutionSchema, VehicleDetailSchema, VehicleShareSchema, WorkOrderDetailSchema } from '@werkstatt/contracts';
import { serviceEntries, vehicleShares, vehicles } from '../src/db/schema/index';
import { call, createCustomer, createHarness, expectOk, expectStatus, type Harness } from './support/harness';
import { createWorkOrder, customerWithVehicle, issueInvoice, item, setupWorkshop, type Workshop } from './support/scenario';

let h: Harness;
let w: Workshop;
beforeAll(async () => {
  h = await createHarness();
  w = await setupWorkshop(h);
});
afterAll(async () => h?.close());

let vinCounter = 100;
async function vehicleWithHistory() {
  const { customer, vehicleId } = await customerWithVehicle(h, 'Qrhalter');
  vinCounter += 1;
  const vin = `WVWZZZ1KZAW000${vinCounter}`;
  await h.db.update(vehicles).set({ vin }).where(eq(vehicles.id, vehicleId));
  const wo = await createWorkOrder(h, w.service.token, {
    customerId: customer.customerId!,
    vehicleId,
    assigneeIds: [w.mechanic.id],
    items: [item('Ölwechsel', { maintenanceTypeId: w.oilChangeTypeId, unitPriceCents: 12345 }), item('Bremsflüssigkeit', { maintenanceTypeId: w.brakeFluidTypeId })],
  });
  for (const i of wo.items) await call(h, 'POST', `/work-items/${i.id}/finish`, { token: w.mechanic.token, body: { odometerKm: 60000 } });
  expectOk(await call(h, 'POST', `/work-orders/${wo.id}/complete-review`, { token: w.service.token, body: { confirm: true } }), WorkOrderDetailSchema);
  await issueInvoice(h, w.service.token, { customerId: customer.customerId!, workOrderId: wo.id, totalGrossCents: 34567 });
  await call(h, 'POST', `/work-orders/${wo.id}/messages`, { token: customer.token, body: { clientMessageId: 'qr-msg-0001', body: 'Private Nachricht' } });
  const [v] = await h.db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
  const entries = await h.db.select().from(serviceEntries).where(eq(serviceEntries.vehicleId, vehicleId));
  return { customer, vehicleId, wo, vin, qrToken: v!.qrToken, plate: v!.licensePlate, entries };
}

function assertNoPrivateData(body: string, ctx: { plate: string; orderNumber: string }) {
  expect(body).not.toContain(ctx.plate);
  expect(body).not.toContain('Qrhalter');
  expect(body).not.toContain(ctx.orderNumber);
  expect(body).not.toContain('34567');
  expect(body).not.toContain('12345');
  expect(body).not.toContain('Private Nachricht');
  expect(body).not.toContain('beispiel.test');
}

describe('T-09 QR-Code und Freigabe für Dritte', () => {
  it('QR ohne Anmeldung zeigt standardmäßig nur login_required; Kurzansicht nur freigegebene Felder', async () => {
    const v = await vehicleWithHistory();
    const anon = await call(h, 'GET', `/public/qr/${v.qrToken}`);
    const resolved = expectOk(anon, QrResolutionSchema);
    expect(resolved).toEqual({ mode: 'login_required', workshopName: expect.any(String) });
    assertNoPrivateData(anon.body, { plate: v.plate, orderNumber: v.wo.orderNumber });
    expect(anon.body).not.toContain(v.vin);

    // Werkstatt kann die Kurzansicht nicht für den Kunden einschalten
    expectStatus(await call(h, 'PUT', `/vehicles/${v.vehicleId}/qr-public-view`, { token: w.service.token, body: { enabled: true } }), 403);
    expectOk(await call(h, 'PUT', `/vehicles/${v.vehicleId}/qr-public-view`, { token: v.customer.token, body: { enabled: true } }), VehicleDetailSchema);

    const pub = await call(h, 'GET', `/public/qr/${v.qrToken}`);
    const view = expectOk(pub, QrResolutionSchema);
    expect(view.mode).toBe('public');
    if (view.mode !== 'public') throw new Error('unerwartet');
    expect(view.view.vin).toBeNull();
    expect(view.view.source).toBe('qr_public_view');
    expect(view.view.entries.map((e) => e.title).sort()).toEqual(['Bremsflüssigkeit', 'Ölwechsel']);
    expect(Object.keys(view.view.entries[0]!).sort()).toEqual(
      ['details', 'maintenanceTypeName', 'nextDueDate', 'nextDueKm', 'odometerKm', 'performedOn', 'revisionNo', 'title', 'workshopName'].sort(),
    );
    assertNoPrivateData(pub.body, { plate: v.plate, orderNumber: v.wo.orderNumber });
    expect(pub.body).not.toContain(v.vin);

    // Angemeldet und berechtigt → direkt zur vollständigen Ansicht der Rolle
    const own = expectOk(await call(h, 'GET', `/public/qr/${v.qrToken}`, { token: v.customer.token }), QrResolutionSchema);
    expect(own).toEqual({ mode: 'authorized', vehicleId: v.vehicleId, targetPath: `/kunde/fahrzeuge/${v.vehicleId}` });
    const staff = expectOk(await call(h, 'GET', `/public/qr/${v.qrToken}`, { token: w.service.token }), QrResolutionSchema);
    expect(staff).toEqual({ mode: 'authorized', vehicleId: v.vehicleId, targetPath: `/werkstatt/fahrzeuge/${v.vehicleId}` });
    // Angemeldet, aber nicht berechtigt → nur, was öffentlich freigegeben ist
    const stranger = await createCustomer(h, 'Fremd');
    const other = expectOk(await call(h, 'GET', `/public/qr/${v.qrToken}`, { token: stranger.token }), QrResolutionSchema);
    expect(other.mode).toBe('public');
    // Unbekannter Code
    expectStatus(await call(h, 'GET', '/public/qr/unbekannterCode1234567890'), 404);
  });

  it('Freigabe-Link: nur ausgewählte Einträge, Link einmalig, Token nur als Hash, Ablauf und Widerruf', async () => {
    const v = await vehicleWithHistory();
    const oil = v.entries.find((e) => e.title === 'Ölwechsel')!;
    const expiresAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
    // Werkstatt kann keine Freigabe im Namen des Kunden anlegen
    expectStatus(
      await call(h, 'POST', `/vehicles/${v.vehicleId}/shares`, { token: w.service.token, body: { label: 'x', serviceEntryIds: [oil.id], expiresAt } }),
      403,
    );
    const share = expectOk(
      await call(h, 'POST', `/vehicles/${v.vehicleId}/shares`, {
        token: v.customer.token,
        body: { label: 'Kaufinteressent [TEST]', serviceEntryIds: [oil.id], includeVin: true, expiresAt },
      }),
      VehicleShareSchema,
      201,
    );
    expect(share.shareUrl).toMatch(/^https:\/\/app\.werkstatt\.test\/f\//);
    const token = share.shareUrl!.split('/f/')[1]!;
    const [stored] = await h.db.select().from(vehicleShares).where(eq(vehicleShares.id, share.id));
    expect(stored!.tokenHash).not.toBe(token);
    expect(JSON.stringify(stored)).not.toContain(token);
    const listed = expectOk(await call(h, 'GET', `/vehicles/${v.vehicleId}/shares`, { token: v.customer.token }), z.array(VehicleShareSchema));
    expect(listed[0]!.shareUrl).toBeNull();

    const res = await call(h, 'GET', `/public/shares/${token}`);
    const view = expectOk(res, PublicVehicleViewSchema);
    expect(view.entries.map((e) => e.title)).toEqual(['Ölwechsel']);
    expect(view.vin).toBe(v.vin);
    expect(view.source).toBe('share');
    assertNoPrivateData(res.body, { plate: v.plate, orderNumber: v.wo.orderNumber });
    await call(h, 'GET', `/public/shares/${token}`);
    const [counted] = await h.db.select().from(vehicleShares).where(eq(vehicleShares.id, share.id));
    expect(counted!.accessCount).toBe(2);

    // Ablauf
    h.clock.advance(3 * 86_400_000);
    expectStatus(await call(h, 'GET', `/public/shares/${token}`), 410, 'share_expired');
    h.clock.advance(-3 * 86_400_000);
    // Widerruf
    const revoked = expectOk(await call(h, 'POST', `/shares/${share.id}/revoke`, { token: v.customer.token }), VehicleShareSchema);
    expect(revoked.revokedAt).not.toBeNull();
    expectStatus(await call(h, 'GET', `/public/shares/${token}`), 410, 'share_revoked');
    expectStatus(await call(h, 'GET', '/public/shares/gibtesnichtgibtesnicht123'), 404);
  });
});
