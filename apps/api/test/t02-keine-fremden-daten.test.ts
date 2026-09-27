import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  DocumentSchema,
  FileRefSchema,
  InvoiceSchema,
  PageSchema,
  PhotoSchema,
  WorkOrderSummarySchema,
} from '@werkstatt/contracts';
import { SAMPLE_PDF, SAMPLE_PNG, call, createHarness, expectOk, expectStatus, uploadFile, type Harness } from './support/harness';
import { createAndSendApproval, createWorkOrder, customerWithVehicle, issueInvoice, line, setupWorkshop, type Workshop } from './support/scenario';

let h: Harness;
let w: Workshop;
beforeAll(async () => {
  h = await createHarness();
  w = await setupWorkshop(h);
});
afterAll(async () => h?.close());

async function seedCustomerData(lastName: string) {
  const { customer, vehicleId } = await customerWithVehicle(h, lastName);
  const wo = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId, title: `[TEST] Auftrag ${lastName}` });
  const pdf = expectOk(await uploadFile(h, w.service.token, 'bericht.pdf', 'application/pdf', SAMPLE_PDF), FileRefSchema, 201);
  const internalDoc = expectOk(
    await call(h, 'POST', '/documents', { token: w.service.token, body: { kind: 'report', title: 'Interner Prüfbericht', fileId: pdf.id, workOrderId: wo.id } }),
    DocumentSchema,
    201,
  );
  const pdf2 = expectOk(await uploadFile(h, w.service.token, 'angebot.pdf', 'application/pdf', SAMPLE_PDF), FileRefSchema, 201);
  const publicDoc = expectOk(
    await call(h, 'POST', '/documents', { token: w.service.token, body: { kind: 'offer', title: 'Angebot', fileId: pdf2.id, workOrderId: wo.id } }),
    DocumentSchema,
    201,
  );
  expectOk(await call(h, 'POST', `/documents/${publicDoc.id}/publish`, { token: w.service.token }), DocumentSchema);
  const png = expectOk(await uploadFile(h, w.service.token, 'foto.png', 'image/png', SAMPLE_PNG), FileRefSchema, 201);
  const internalPhoto = expectOk(
    await call(h, 'POST', `/work-orders/${wo.id}/photos`, { token: w.service.token, body: { fileId: png.id, context: 'work' } }),
    PhotoSchema,
    201,
  );
  const png2 = expectOk(await uploadFile(h, w.service.token, 'foto2.png', 'image/png', SAMPLE_PNG), FileRefSchema, 201);
  const sharedPhoto = expectOk(
    await call(h, 'POST', `/work-orders/${wo.id}/photos`, { token: w.service.token, body: { fileId: png2.id, context: 'work' } }),
    PhotoSchema,
    201,
  );
  expectOk(await call(h, 'PUT', `/photos/${sharedPhoto.id}/visibility`, { token: w.service.token, body: { visibility: 'customer' } }), PhotoSchema);
  const invoice = await issueInvoice(h, w.service.token, { customerId: customer.customerId!, workOrderId: wo.id, totalGrossCents: 11900, withPdf: true });
  const approval = await createAndSendApproval(h, w.service.token, wo.id, [line('Bremsbeläge', 12000)]);
  await call(h, 'POST', `/work-orders/${wo.id}/messages`, { token: customer.token, body: { clientMessageId: `msg-${lastName}-1`, body: 'Hallo Werkstatt' } });
  return { customer, vehicleId, wo, internalDoc, publicDoc, internalPhoto, sharedPhoto, invoice, approval };
}

describe('T-02 keine Einsicht in fremde Kundenakten', () => {
  it('fremde Akten, Aufträge, Dokumente, Fotos, Rechnungen, Freigaben und Nachrichten liefern 404', async () => {
    const a = await seedCustomerData('Alpha');
    const b = await seedCustomerData('Beta');
    const t = b.customer.token;

    const foreign = [
      `/customers/${a.customer.customerId}`,
      `/vehicles/${a.vehicleId}`,
      `/vehicles/${a.vehicleId}/service-entries`,
      `/vehicles/${a.vehicleId}/odometer`,
      `/work-orders/${a.wo.id}`,
      `/work-orders/${a.wo.id}/messages`,
      `/work-orders/${a.wo.id}/photos`,
      `/work-orders/${a.wo.id}/approvals`,
      `/work-orders/${a.wo.id}/intake`,
      `/documents/${a.publicDoc.id}/download`,
      `/documents/${a.internalDoc.id}/download`,
      `/photos/${a.sharedPhoto.id}/content`,
      `/photos/${a.internalPhoto.id}/content`,
      `/invoices/${a.invoice.id}`,
      `/approvals/${a.approval.id}`,
    ];
    for (const url of foreign) {
      const res = await call(h, 'GET', url, { token: t });
      expect(res.statusCode, url).toBe(404);
      expect(res.json().error.code, url).toBe('not_found');
    }
    // Schreibende Zugriffe auf Fremdes ebenfalls 404
    expectStatus(await call(h, 'POST', `/invoices/${a.invoice.id}/checkout`, { token: t }), 404);
    expectStatus(
      await call(h, 'POST', `/approvals/${a.approval.id}/decision`, {
        token: t,
        body: { versionId: a.approval.currentVersion.id, contentHash: a.approval.currentVersion.contentHash, decision: 'approved', channel: 'web' },
      }),
      404,
    );
    expectStatus(await call(h, 'POST', `/work-orders/${a.wo.id}/messages`, { token: t, body: { clientMessageId: 'fremd-0001', body: 'x' } }), 404);
    // Nicht vorhandene IDs verhalten sich gleich (keine Existenzpreisgabe)
    expectStatus(await call(h, 'GET', '/work-orders/00000000-0000-4000-8000-000000000000', { token: t }), 404);
    expectStatus(await call(h, 'GET', '/work-orders/keine-uuid', { token: t }), 404);
  });

  it('eigene interne Dokumente und Fotos sind auch über die direkte URL nicht abrufbar', async () => {
    const c = await seedCustomerData('Gamma');
    const t = c.customer.token;
    expectStatus(await call(h, 'GET', `/documents/${c.internalDoc.id}/download`, { token: t }), 404);
    expectStatus(await call(h, 'GET', `/photos/${c.internalPhoto.id}/content`, { token: t }), 404);
    // veröffentlichte Dokumente und freigegebene Fotos schon
    const dl = await call(h, 'GET', `/documents/${c.publicDoc.id}/download`, { token: t });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-disposition']).toContain('attachment');
    expect(dl.headers['content-type']).toBe('application/pdf');
    const photo = await call(h, 'GET', `/photos/${c.sharedPhoto.id}/content`, { token: t });
    expect(photo.statusCode).toBe(200);
    expect(photo.headers['content-type']).toBe('image/png');

    // Listen sind serverseitig gefiltert
    const docs = expectOk(await call(h, 'GET', '/documents', { token: t }), z.array(DocumentSchema));
    // Angebot + gestellte Rechnung (PDF wird beim Stellen bereitgestellt); kein interner Bericht
    expect(docs.map((d) => d.id)).toContain(c.publicDoc.id);
    expect(docs.map((d) => d.id)).not.toContain(c.internalDoc.id);
    expect(docs.every((d) => d.visibility === 'customer' && d.customerId === c.customer.customerId)).toBe(true);
    const photos = expectOk(await call(h, 'GET', `/work-orders/${c.wo.id}/photos`, { token: t }), z.array(PhotoSchema));
    expect(photos.map((p) => p.id)).toEqual([c.sharedPhoto.id]);
    const orders = expectOk(await call(h, 'GET', '/work-orders', { token: t }), PageSchema(WorkOrderSummarySchema));
    expect(orders.items.map((o) => o.id)).toEqual([c.wo.id]);
    const invoices = expectOk(await call(h, 'GET', '/invoices', { token: t }), z.array(InvoiceSchema));
    expect(invoices.map((i) => i.id)).toEqual([c.invoice.id]);
    expect(invoices[0]!.checkouts).toBeUndefined();
    // Kunde sieht keine internen Notizen und keine Feststellungen
    expectStatus(await call(h, 'GET', `/work-orders/${c.wo.id}/internal-notes`, { token: t }), 404);
    expectStatus(await call(h, 'GET', `/work-orders/${c.wo.id}/findings`, { token: t }), 404);
    const detail = await call(h, 'GET', `/work-orders/${c.wo.id}`, { token: t });
    expect(detail.json()).not.toHaveProperty('notesInternal');
  });
});
