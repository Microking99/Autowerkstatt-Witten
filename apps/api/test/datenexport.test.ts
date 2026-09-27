import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { DocumentSchema, FileRefSchema, MessageSchema, WorkOrderDetailSchema } from '@werkstatt/contracts';
import { SAMPLE_PDF, call, createCustomer, createStaff, createVehicle, expectOk, expectStatus, uploadFile, type Harness, createHarness } from './support/harness';
import { createAndSendApproval, createWorkOrder, customerWithVehicle, issueInvoice, item, line, setupWorkshop, type Workshop } from './support/scenario';

let h: Harness;
let w: Workshop;
beforeAll(async () => {
  h = await createHarness();
  w = await setupWorkshop(h);
});
afterAll(async () => h?.close());

type ExportData = Record<'vehicles' | 'workOrders' | 'messages' | 'invoices' | 'internalNotes' | 'documents', unknown[]>;

function unzip(body: Buffer): { files: Record<string, Uint8Array>; data: ExportData } {
  const files = unzipSync(new Uint8Array(body));
  const json = files['daten.json'];
  if (!json) throw new Error('daten.json fehlt');
  return { files, data: JSON.parse(strFromU8(json)) };
}

describe('Datenexport für Betroffene (DSGVO Art. 15/20)', () => {
  it('Kunde erhält nur eigene, für ihn sichtbare Daten; Werkstatt erhält den vollständigen Export', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Exportkundin');
    const other = await customerWithVehicle(h, 'Fremdkunde');
    const secondVehicle = await createVehicle(h, customer.customerId!);

    const wo = await createWorkOrder(h, w.service.token, {
      customerId: customer.customerId!,
      vehicleId,
      assigneeIds: [w.mechanic.id],
      items: [item('Ölwechsel', { maintenanceTypeId: w.oilChangeTypeId })],
    });
    expectOk(
      await call(h, 'PATCH', `/work-orders/${wo.id}`, { token: w.service.token, body: { notesInternal: '[TEST] Interne Notiz: Kunde zahlt oft spät' } }),
      WorkOrderDetailSchema,
    );
    await createAndSendApproval(h, w.service.token, wo.id, [line('Wischerblätter', 2490)]);
    expectOk(
      await call(h, 'POST', `/work-orders/${wo.id}/messages`, { token: customer.token, body: { clientMessageId: 'export-msg-0001', body: 'Wann ist der Wagen fertig?' } }),
      MessageSchema,
      201,
    );
    await call(h, 'POST', `/work-orders/${wo.id}/internal-notes`, { token: w.service.token, body: { body: '[TEST] nur intern' } });
    await issueInvoice(h, w.service.token, { customerId: customer.customerId!, workOrderId: wo.id, totalGrossCents: 12990, withPdf: true });

    const pdf = expectOk(await uploadFile(h, w.service.token, 'pruefbericht.pdf', 'application/pdf', SAMPLE_PDF), FileRefSchema, 201);
    const published = expectOk(
      await call(h, 'POST', '/documents', { token: w.service.token, body: { kind: 'report', title: 'Prüfbericht', fileId: pdf.id, customerId: customer.customerId } }),
      DocumentSchema,
      201,
    );
    expectOk(await call(h, 'POST', `/documents/${published.id}/publish`, { token: w.service.token }), DocumentSchema);
    const internalPdf = expectOk(await uploadFile(h, w.service.token, 'intern.pdf', 'application/pdf', SAMPLE_PDF), FileRefSchema, 201);
    expectOk(
      await call(h, 'POST', '/documents', { token: w.service.token, body: { kind: 'other', title: 'Interne Kalkulation', fileId: internalPdf.id, customerId: customer.customerId } }),
      DocumentSchema,
      201,
    );
    // Daten eines anderen Kunden dürfen nie enthalten sein
    await createWorkOrder(h, w.service.token, { customerId: other.customer.customerId!, vehicleId: other.vehicleId, items: [item('Fremdauftrag')] });
    // Entwurf ist für den Kunden unsichtbar
    const draft = expectOk(
      await call(h, 'POST', '/work-orders', {
        token: w.service.token,
        query: { draft: 'true' },
        body: { customerId: customer.customerId, vehicleId: secondVehicle, title: '[TEST] Entwurf', items: [] },
      }),
      WorkOrderDetailSchema,
      201,
    );

    // Selbstauskunft
    const selfRes = await call(h, 'GET', '/me/export', { token: customer.token });
    expect(selfRes.statusCode).toBe(200);
    expect(selfRes.headers['content-type']).toContain('application/zip');
    expect(String(selfRes.headers['content-disposition'])).toMatch(/attachment; filename="datenexport-/);
    const self = unzip(selfRes.rawPayload);
    expect(self.files['LIESMICH.txt']).toBeDefined();
    const text = strFromU8(self.files['daten.json']!);
    expect(self.data.vehicles).toHaveLength(2);
    expect(self.data.workOrders.map((o) => (o as { id: string }).id)).toEqual([wo.id]);
    expect(self.data.workOrders.map((o) => (o as { id: string }).id)).not.toContain(draft.id);
    expect(self.data.messages).toHaveLength(1);
    expect(self.data.invoices).toHaveLength(1);
    expect(self.data.internalNotes).toHaveLength(0);
    // veröffentlichter Prüfbericht und das Rechnungs-PDF (für Kunden sichtbar), kein internes Dokument
    const titles = self.data.documents.map((d) => (d as { title: string }).title);
    expect(titles).toContain('Prüfbericht');
    expect(titles).toHaveLength(2);
    expect(Object.keys(self.files).filter((f) => f.startsWith('dokumente/'))).toHaveLength(2);
    // keine internen Inhalte, keine Geheimnisse, keine Fremddaten
    expect(text).not.toContain('Interne Notiz');
    expect(text).not.toContain('nur intern');
    expect(text).not.toContain('Interne Kalkulation');
    expect(text).not.toContain('Fremdauftrag');
    expect(text).not.toContain(other.customer.customerId!);
    expect(text).not.toMatch(/passwordHash|tokenHash|qrToken|pushToken|storageKey/);

    // Werkstatt: vollständiger Export (mit interner Notiz, internem Dokument und Entwurf)
    const fullRes = await call(h, 'GET', `/customers/${customer.customerId}/export`, { token: w.service.token });
    expect(fullRes.statusCode).toBe(200);
    const full = unzip(fullRes.rawPayload);
    const fullText = strFromU8(full.files['daten.json']!);
    expect(fullText).toContain('Interne Notiz');
    expect(full.data.internalNotes).toHaveLength(1);
    expect(full.data.documents).toHaveLength(3);
    expect(full.data.workOrders).toHaveLength(2);
    expect(fullText).not.toContain('Fremdauftrag');
    expect(fullText).not.toMatch(/passwordHash|tokenHash|qrToken|pushToken|storageKey/);
  });

  it('Rechte: Mechaniker und Service ohne Exportrecht erhalten 403, fremde Kunden 404, Mitarbeiter keinen Selbstexport', async () => {
    const { customer } = await customerWithVehicle(h, 'Rechtetest');
    const other = await createCustomer(h, 'Andere');
    expectStatus(await call(h, 'GET', `/customers/${customer.customerId}/export`, { token: w.mechanic.token }), 403);
    const serviceWithoutExport = await createStaff(h, 'service', { overrides: [{ permission: 'reports.export', granted: false }] });
    expectStatus(await call(h, 'GET', `/customers/${customer.customerId}/export`, { token: serviceWithoutExport.token }), 403);
    expectStatus(await call(h, 'GET', `/customers/${customer.customerId}/export`, { token: other.token }), 404);
    expectStatus(await call(h, 'GET', '/me/export', { token: w.service.token }), 403);
    expectStatus(await call(h, 'GET', '/me/export'), 401);
  });
});
