import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AuditEntrySchema,
  DocumentSchema,
  FileRefSchema,
  InvoiceSchema,
  MessageSchema,
  WorkOrderDetailSchema,
} from '@werkstatt/contracts';
import { SAMPLE_PDF, call, createHarness, expectOk, uploadFile, type Harness } from './support/harness';
import { createWorkOrder, customerWithVehicle, issueInvoice, item, setupWorkshop, type Workshop } from './support/scenario';

let h: Harness;
let w: Workshop;
beforeAll(async () => {
  h = await createHarness();
  w = await setupWorkshop(h);
});
afterAll(async () => h?.close());

describe('T-12 Daten bleiben nach Neustart erhalten', () => {
  it('App-Instanz schließen, neue Instanz gegen dieselbe Datenbank: Daten, Dateien und Sitzungen vorhanden', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Neustart');
    const wo = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId, items: [item('Diagnose')] });
    const pdf = expectOk(await uploadFile(h, w.service.token, 'protokoll.pdf', 'application/pdf', SAMPLE_PDF), FileRefSchema, 201);
    const doc = expectOk(
      await call(h, 'POST', '/documents', { token: w.service.token, body: { kind: 'intake_protocol', title: 'Annahmeprotokoll', fileId: pdf.id, workOrderId: wo.id } }),
      DocumentSchema,
      201,
    );
    expectOk(await call(h, 'POST', `/documents/${doc.id}/publish`, { token: w.service.token }), DocumentSchema);
    expectOk(
      await call(h, 'POST', `/work-orders/${wo.id}/messages`, { token: customer.token, body: { clientMessageId: 'neustart-0001', body: 'Vor dem Neustart' } }),
      MessageSchema,
      201,
    );
    const invoice = await issueInvoice(h, w.service.token, { customerId: customer.customerId!, workOrderId: wo.id, totalGrossCents: 9900 });

    await h.restart();

    // Sitzungen sind persistent (nur Hash in der Datenbank)
    const after = expectOk(await call(h, 'GET', `/work-orders/${wo.id}`, { token: customer.token }), WorkOrderDetailSchema);
    expect(after.orderNumber).toBe(wo.orderNumber);
    expect(after.items.map((i) => i.title)).toEqual(['Diagnose']);
    const dl = await call(h, 'GET', `/documents/${doc.id}/download`, { token: customer.token });
    expect(dl.statusCode).toBe(200);
    expect(dl.rawPayload.equals(SAMPLE_PDF)).toBe(true);
    const messages = expectOk(await call(h, 'GET', `/work-orders/${wo.id}/messages`, { token: w.service.token }), z.array(MessageSchema));
    expect(messages.map((m) => m.body)).toEqual(['Vor dem Neustart']);
    const inv = expectOk(await call(h, 'GET', `/invoices/${invoice.id}`, { token: customer.token }), InvoiceSchema);
    expect(inv).toMatchObject({ status: 'issued', paymentStatus: 'open', totalGrossCents: 9900 });
    const audit = expectOk(await call(h, 'GET', '/audit', { token: w.admin.token, query: { entityType: 'invoice', entityId: invoice.id } }), z.array(AuditEntrySchema));
    expect(audit.map((a) => a.action).sort()).toEqual(['invoice.created', 'invoice.issued']);
    // Wiederholtes Senden nach dem Neustart erzeugt keine Dublette
    const resend = await call(h, 'POST', `/work-orders/${wo.id}/messages`, { token: customer.token, body: { clientMessageId: 'neustart-0001', body: 'Vor dem Neustart' } });
    expect(resend.statusCode).toBe(200);
    expect(expectOk(await call(h, 'GET', `/work-orders/${wo.id}/messages`, { token: customer.token }), z.array(MessageSchema))).toHaveLength(1);
  });
});
