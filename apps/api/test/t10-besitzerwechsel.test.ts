import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  DocumentSchema,
  FileRefSchema,
  InvoiceSchema,
  MessageSchema,
  OwnershipSchema,
  PageSchema,
  QrResolutionSchema,
  ServiceEntrySchema,
  VehicleDetailSchema,
  VehicleShareSchema,
  VehicleSummarySchema,
  WorkOrderDetailSchema,
  WorkOrderSummarySchema,
} from '@werkstatt/contracts';
import { vehicles } from '../src/db/schema/index';
import { SAMPLE_PDF, call, createCustomer, createHarness, expectOk, expectStatus, uploadFile, type Harness } from './support/harness';
import { createAndSendApproval, createWorkOrder, customerWithVehicle, issueInvoice, item, line, setupWorkshop, type Workshop } from './support/scenario';

let h: Harness;
let w: Workshop;
beforeAll(async () => {
  h = await createHarness();
  w = await setupWorkshop(h);
});
afterAll(async () => h?.close());

describe('T-10 Besitzerwechsel', () => {
  it('neuer Halter sieht Fahrzeug und technische Historie ohne Auftragsbezug, nichts Privates des Vorbesitzers', async () => {
    // Vorbesitzer mit Auftrag, Serviceeintrag, Rechnung, Dokument, Nachricht, Freigabe
    const { customer: previous, vehicleId } = await customerWithVehicle(h, 'Vorbesitzer');
    const wo = await createWorkOrder(h, w.service.token, {
      customerId: previous.customerId!,
      vehicleId,
      assigneeIds: [w.mechanic.id],
      items: [item('Ölwechsel', { maintenanceTypeId: w.oilChangeTypeId })],
    });
    const approval = await createAndSendApproval(h, w.service.token, wo.id, [line('Scheibenwischer', 2000)]);
    await call(h, 'POST', `/work-items/${wo.items[0]!.id}/finish`, { token: w.mechanic.token, body: { odometerKm: 70000 } });
    expectOk(await call(h, 'POST', `/work-orders/${wo.id}/complete-review`, { token: w.service.token, body: { confirm: true } }), WorkOrderDetailSchema);
    const invoice = await issueInvoice(h, w.service.token, { customerId: previous.customerId!, workOrderId: wo.id, totalGrossCents: 15000, withPdf: true });
    const pdf = expectOk(await uploadFile(h, w.service.token, 'bericht.pdf', 'application/pdf', SAMPLE_PDF), FileRefSchema, 201);
    const doc = expectOk(
      await call(h, 'POST', '/documents', { token: w.service.token, body: { kind: 'report', title: 'Prüfbericht', fileId: pdf.id, workOrderId: wo.id } }),
      DocumentSchema,
      201,
    );
    expectOk(await call(h, 'POST', `/documents/${doc.id}/publish`, { token: w.service.token }), DocumentSchema);
    expectOk(
      await call(h, 'POST', `/work-orders/${wo.id}/messages`, { token: previous.token, body: { clientMessageId: 'vorbesitzer-0001', body: 'Private Frage' } }),
      MessageSchema,
      201,
    );
    expectOk(await call(h, 'PUT', `/vehicles/${vehicleId}/qr-public-view`, { token: previous.token, body: { enabled: true } }), VehicleDetailSchema);
    const [entry] = expectOk(await call(h, 'GET', `/vehicles/${vehicleId}/service-entries`, { token: previous.token }), z.array(ServiceEntrySchema));
    const share = expectOk(
      await call(h, 'POST', `/vehicles/${vehicleId}/shares`, {
        token: previous.token,
        body: { label: 'Verkauf', serviceEntryIds: [entry!.id], expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
      }),
      VehicleShareSchema,
      201,
    );
    expect(entry!.workOrderId).toBe(wo.id);

    // Halterwechsel
    const next = await createCustomer(h, 'Neuhalter');
    expectStatus(
      await call(h, 'POST', `/vehicles/${vehicleId}/ownership-transfer`, { token: w.mechanic.token, body: { newCustomerId: next.customerId, effectiveAt: new Date().toISOString() } }),
      403,
    );
    expectOk(
      await call(h, 'POST', `/vehicles/${vehicleId}/ownership-transfer`, {
        token: w.service.token,
        body: { newCustomerId: next.customerId, effectiveAt: new Date(Date.now() - 1000).toISOString(), note: 'Verkauf [TEST]' },
      }),
      VehicleDetailSchema,
    );
    const periods = expectOk(await call(h, 'GET', `/vehicles/${vehicleId}/ownerships`, { token: w.service.token }), z.array(OwnershipSchema));
    expect(periods).toHaveLength(2);
    expect(periods.filter((p) => p.endedAt === null).map((p) => p.customerId)).toEqual([next.customerId]);

    // Neuer Halter: Fahrzeug und technische Historie, Auftragsbezug ausgeblendet
    const nextVehicles = expectOk(await call(h, 'GET', '/vehicles', { token: next.token }), PageSchema(VehicleSummarySchema));
    expect(nextVehicles.items.map((v) => v.id)).toEqual([vehicleId]);
    const history = expectOk(await call(h, 'GET', `/vehicles/${vehicleId}/service-entries`, { token: next.token }), z.array(ServiceEntrySchema));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ title: 'Ölwechsel', odometerKm: 70000, workOrderId: null });
    const single = expectOk(await call(h, 'GET', `/service-entries/${entry!.id}`, { token: next.token }), ServiceEntrySchema);
    expect(single.workOrderId).toBeNull();
    for (const url of [
      `/work-orders/${wo.id}`,
      `/work-orders/${wo.id}/messages`,
      `/invoices/${invoice.id}`,
      `/documents/${doc.id}/download`,
      `/approvals/${approval.id}`,
    ]) {
      expect((await call(h, 'GET', url, { token: next.token })).statusCode, url).toBe(404);
    }
    expect(expectOk(await call(h, 'GET', '/work-orders', { token: next.token }), PageSchema(WorkOrderSummarySchema)).items).toHaveLength(0);
    expect(expectOk(await call(h, 'GET', '/invoices', { token: next.token }), z.array(InvoiceSchema))).toHaveLength(0);
    expect(expectOk(await call(h, 'GET', '/documents', { token: next.token }), z.array(DocumentSchema))).toHaveLength(0);

    // Vorbesitzer: Fahrzeug weg, eigene Unterlagen bleiben
    const prevVehicles = expectOk(await call(h, 'GET', '/vehicles', { token: previous.token }), PageSchema(VehicleSummarySchema));
    expect(prevVehicles.items).toHaveLength(0);
    expectStatus(await call(h, 'GET', `/vehicles/${vehicleId}`, { token: previous.token }), 404);
    expectStatus(await call(h, 'GET', `/vehicles/${vehicleId}/service-entries`, { token: previous.token }), 404);
    expectOk(await call(h, 'GET', `/work-orders/${wo.id}`, { token: previous.token }), WorkOrderDetailSchema);
    expectOk(await call(h, 'GET', `/invoices/${invoice.id}`, { token: previous.token }), InvoiceSchema);
    expect((await call(h, 'GET', `/documents/${doc.id}/download`, { token: previous.token })).statusCode).toBe(200);
    expect(expectOk(await call(h, 'GET', `/work-orders/${wo.id}/messages`, { token: previous.token }), z.array(MessageSchema))).toHaveLength(1);

    // Entscheidungen des Vorbesitzers enden: Freigabelink widerrufen, QR-Kurzansicht aus
    const shareToken = share.shareUrl!.split('/f/')[1]!;
    expectStatus(await call(h, 'GET', `/public/shares/${shareToken}`), 410, 'share_revoked');
    const [v] = await h.db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
    expect(v!.qrPublicViewEnabled).toBe(false);
    expect(expectOk(await call(h, 'GET', `/public/qr/${v!.qrToken}`), QrResolutionSchema).mode).toBe('login_required');
    expect(expectOk(await call(h, 'GET', `/public/qr/${v!.qrToken}`, { token: previous.token }), QrResolutionSchema).mode).toBe('login_required');
    expect(expectOk(await call(h, 'GET', `/public/qr/${v!.qrToken}`, { token: next.token }), QrResolutionSchema).mode).toBe('authorized');

    // Neuer Auftrag gehört dem neuen Halter
    const newWo = await createWorkOrder(h, w.service.token, { customerId: next.customerId!, vehicleId, items: [item('Durchsicht')] });
    expectOk(await call(h, 'GET', `/work-orders/${newWo.id}`, { token: next.token }), WorkOrderDetailSchema);
    expectStatus(await call(h, 'GET', `/work-orders/${newWo.id}`, { token: previous.token }), 404);
    // Auftrag für den Vorbesitzer mit diesem Fahrzeug ist nicht mehr möglich
    expectStatus(await call(h, 'POST', '/work-orders', { token: w.service.token, body: { customerId: previous.customerId, vehicleId, title: 'x' } }), 422);
  });
});
