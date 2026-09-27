/**
 * Review (Claude-Unteragent, 27.09.2026): allgemeine Angriffe (SQL, Dateien, Uploads,
 * Massenzuweisung, Idempotenz, Tokens, Audit-Abdeckung).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  ApprovalRequestSchema,
  AuditEntrySchema,
  CustomerDetailSchema,
  DocumentSchema,
  FileRefSchema,
  InvoiceSchema,
  LoginResponseSchema,
  PhotoSchema,
  StaffUserSchema,
  VehicleDetailSchema,
  VehicleShareSchema,
  WorkItemSchema,
  WorkOrderDetailSchema,
  WorkshopSettingsSchema,
} from '@werkstatt/contracts';
import { customers, files, users, vehicles, workItems, workOrders } from '../src/db/schema/index';
import { LocalFileStorage } from '../src/storage/fileStorage';
import { contentDisposition } from '../src/storage/fileSignature';
import { SAMPLE_PDF, SAMPLE_PNG, call, createCustomer, createHarness, createStaff, expectOk, expectStatus, uploadFile, type Harness } from './support/harness';
import { createAndSendApproval, createWorkOrder, customerWithVehicle, decide, issueInvoice, item, line, setupWorkshop, workOrderWithFinishedMaintenance, type Workshop } from './support/scenario';

let h: Harness;
let w: Workshop;
beforeAll(async () => {
  h = await createHarness();
  w = await setupWorkshop(h);
});
afterAll(async () => h?.close());

const iso = (offsetMs = 0) => new Date(h.clock.now().getTime() + offsetMs).toISOString();

describe('A01 SQL-Injektion und Platzhalter in Suchen', () => {
  it('Suchbegriffe werden als Daten behandelt; keine 500, keine fremden Treffer', async () => {
    const a = await customerWithVehicle(h, 'Sqlkunde');
    await customerWithVehicle(h, 'Andererkunde');
    const payloads = ["' OR '1'='1", "%' OR 1=1 --", '%', '_', "\\'; DROP TABLE users; --", '%%%%', "' UNION SELECT password_hash FROM users --"];
    for (const q of payloads) {
      for (const [token, url] of [
        [a.customer.token, '/vehicles'],
        [a.customer.token, '/work-orders'],
        [a.customer.token, '/customers'],
        [w.service.token, '/customers'],
        [w.service.token, '/vehicles'],
        [w.service.token, '/work-orders'],
      ] as const) {
        const res = await call(h, 'GET', url, { token, query: { q } });
        expect(res.statusCode, `${url} ${q}`).toBe(200);
        const items = res.json().items as Array<{ id: string }>;
        if (token === a.customer.token && url === '/vehicles') expect(items.every((v) => v.id === a.vehicleId)).toBe(true);
        if (token === w.service.token) expect(items, `${url} ${q}`).toHaveLength(0);
      }
    }
    const audit = await call(h, 'GET', '/audit', { token: w.admin.token, query: { entityType: "x' OR '1'='1", action: "'; DELETE FROM audit_log; --" } });
    expectStatus(audit, 200);
    expect(audit.json()).toEqual([]);
    expect((await h.db.select().from(users)).length).toBeGreaterThan(0);
  });
});

describe('A02 Dateispeicher und Dateinamen', () => {
  it('Speicherschlüssel außerhalb des Musters werden abgewiesen (kein Pfad-Traversal)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'review-storage-'));
    try {
      const storage = new LocalFileStorage(dir);
      for (const key of ['../../etc/passwd', '2026/09/../../../../etc/passwd', '/etc/passwd', '2026/09/abc', '2026/09/' + 'a'.repeat(30) + '/../x', '2026\\09\\' + 'a'.repeat(24)]) {
        await expect(storage.read(key), key).rejects.toThrow();
        await expect(storage.put(key, Buffer.from('x')), key).rejects.toThrow();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('hochgeladene Dateinamen werden bereinigt; Content-Disposition ohne Kopfzeilen-Einschleusung', async () => {
    const res = await uploadFile(h, w.service.token, '../../..\\evil"\r\nX-Injected: 1.png', 'image/png', SAMPLE_PNG);
    const ref = expectOk(res, FileRefSchema, 201);
    expect(ref.originalName).not.toMatch(/[\\/"\r\n]/);
    const [row] = await h.db.select().from(files).where(eq(files.id, ref.id));
    expect(row!.storageKey).toMatch(/^\d{4}\/\d{2}\/[A-Za-z0-9_-]{20,64}$/);
    const header = contentDisposition('attachment', 'a"\r\nSet-Cookie: x=1.pdf');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header.split('filename="')[1]!.split('"')[0]).not.toContain('"');
  });
});

describe('A03 Upload-Prüfung', () => {
  it('SVG, HTML und Skripte werden trotz Bild-Content-Type abgelehnt; Auslieferung nur mit erkanntem Typ und nosniff', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expectStatus(await uploadFile(h, w.service.token, 'bild.png', 'image/png', svg), 415);
    expectStatus(await uploadFile(h, w.service.token, 'seite.png', 'image/png', Buffer.from('<!doctype html><script>alert(1)</script>')), 415);
    expectStatus(await uploadFile(h, w.service.token, 'x.pdf', 'application/pdf', Buffer.from('#!/bin/sh\nrm -rf /')), 415);
    // Polyglot: PNG-Signatur mit angehängtem HTML wird als PNG ausgeliefert, nie als HTML
    const poly = Buffer.concat([SAMPLE_PNG, Buffer.from('<html><script>alert(1)</script></html>')]);
    const ref = expectOk(await uploadFile(h, w.service.token, 'poly.html', 'text/html', poly), FileRefSchema, 201);
    expect(ref.mimeType).toBe('image/png');
    const { customer, vehicleId } = await customerWithVehicle(h, 'Upload');
    const wo = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId });
    const photo = expectOk(await call(h, 'POST', `/work-orders/${wo.id}/photos`, { token: w.service.token, body: { fileId: ref.id, context: 'work' } }), PhotoSchema, 201);
    const content = await call(h, 'GET', `/photos/${photo.id}/content`, { token: w.service.token });
    expect(content.headers['content-type']).toBe('image/png');
    expect(content.headers['x-content-type-options']).toBe('nosniff');
    expect(String(content.headers['content-security-policy'])).toContain("default-src 'none'");
    // PDF als Foto: abgelehnt
    const pdf = expectOk(await uploadFile(h, w.service.token, 'd.pdf', 'application/pdf', SAMPLE_PDF), FileRefSchema, 201);
    expectStatus(await call(h, 'POST', `/work-orders/${wo.id}/photos`, { token: w.service.token, body: { fileId: pdf.id, context: 'work' } }), 422, 'not_an_image');
  });
});

describe('A04 Massenzuweisung über PATCH/PUT', () => {
  it('Status, Kunde, Fahrzeug, Freigabestand, Nummern, QR-Token und Kontostatus lassen sich nicht einschleusen', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Masse');
    const other = await customerWithVehicle(h, 'MasseFremd');
    const wo = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId, items: [item('Position')] });
    const patchedWo = await call(h, 'PATCH', `/work-orders/${wo.id}`, {
      token: w.service.token,
      body: { title: 'neu', status: 'completed', customerId: other.customer.customerId, vehicleId: other.vehicleId, orderNumber: 'A-0000-9999', completionReviewedAt: iso() },
    });
    expectStatus(patchedWo, 200);
    const [woRow] = await h.db.select().from(workOrders).where(eq(workOrders.id, wo.id));
    expect(woRow).toMatchObject({ title: 'neu', status: 'open', customerId: customer.customerId, vehicleId, orderNumber: wo.orderNumber, completionReviewedAt: null });

    const patchedItem = await call(h, 'PATCH', `/work-items/${wo.items[0]!.id}`, {
      token: w.service.token,
      body: { title: 'x', authorization: 'approved', executionStatus: 'done', approvalRequestId: wo.id, workOrderId: other.vehicleId, doneBy: w.admin.id },
    });
    expectStatus(patchedItem, 200);
    const [itemRow] = await h.db.select().from(workItems).where(eq(workItems.id, wo.items[0]!.id));
    expect(itemRow).toMatchObject({ title: 'x', authorization: 'agreed', executionStatus: 'planned', approvalRequestId: null, workOrderId: wo.id, doneBy: null });

    const [before] = await h.db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
    expectOk(
      await call(h, 'PATCH', `/vehicles/${vehicleId}`, { token: w.service.token, body: { color: 'rot', qrToken: 'selbstgewaehlt-1234567890', qrPublicViewEnabled: true, archivedAt: iso() } }),
      VehicleDetailSchema,
    );
    const [after] = await h.db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
    expect(after).toMatchObject({ color: 'rot', qrToken: before!.qrToken, qrPublicViewEnabled: false, archivedAt: null });

    expectOk(
      await call(h, 'PATCH', `/customers/${customer.customerId}`, { token: w.service.token, body: { city: 'Witten', customerNumber: 'K-1', archivedAt: iso(), id: other.customer.customerId } }),
      CustomerDetailSchema,
    );
    const [cust] = await h.db.select().from(customers).where(eq(customers.id, customer.customerId!));
    expect(cust).toMatchObject({ city: 'Witten', archivedAt: null });
    expect(cust!.customerNumber).not.toBe('K-1');

    const mech = await createStaff(h, 'mechanic');
    await call(h, 'POST', `/users/${mech.id}/disable`, { token: w.admin.token });
    const staffPatch = await call(h, 'PATCH', `/users/${mech.id}`, { token: w.admin.token, body: { displayName: '[TEST] Neu', status: 'active', email: 'uebernahme@beispiel.test', passwordHash: 'x' } });
    expectOk(staffPatch, StaffUserSchema);
    const [mechRow] = await h.db.select().from(users).where(eq(users.id, mech.id));
    expect(mechRow).toMatchObject({ status: 'disabled', email: mech.email });
    expectStatus(await call(h, 'PATCH', `/users/${mech.id}`, { token: w.admin.token, body: { role: 'customer' } }), 400);

    const settings = expectOk(await call(h, 'GET', '/settings/workshop', { token: w.admin.token }), WorkshopSettingsSchema);
    const { paymentProviderConfigured: _c, ...input } = settings;
    const put = expectOk(await call(h, 'PUT', '/settings/workshop', { token: w.admin.token, body: { ...input, id: 2, paymentProviderConfigured: false } }), WorkshopSettingsSchema);
    expect(put.paymentProviderConfigured).toBe(true);
  });
});

describe('A05 Idempotency-Key', () => {
  it('gleicher Schlüssel mit anderem Inhalt: 422; ungültiger Schlüssel: 400; anderer Pfad: unabhängig', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Idempotenz');
    const wo = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId });
    const key = 'review-key-00000001';
    const send = (body: string, id: string) =>
      call(h, 'POST', `/work-orders/${wo.id}/messages`, { token: customer.token, headers: { 'idempotency-key': key }, body: { clientMessageId: id, body } });
    expectStatus(await send('eins', 'idem-review-0001'), 201);
    expectStatus(await send('zwei', 'idem-review-0002'), 422, 'idempotency_key_reused');
    expectStatus(await call(h, 'POST', `/work-orders/${wo.id}/messages/read`, { token: customer.token, headers: { 'idempotency-key': key } }), 204);
    expectStatus(
      await call(h, 'POST', `/work-orders/${wo.id}/messages`, { token: customer.token, headers: { 'idempotency-key': 'x' }, body: { clientMessageId: 'idem-review-0003', body: 'drei' } }),
      400,
      'invalid_idempotency_key',
    );
  });
});

describe('A06 Einladungs- und Rücksetz-Tokens', () => {
  const tokenFromMail = (to: string, kind: 'einladung' | 'passwort-neu') => {
    const mail = [...h.mailer.sent].reverse().find((m) => m.to === to);
    if (!mail) throw new Error(`Keine Mail an ${to}`);
    return new RegExp(`${kind}/([A-Za-z0-9_-]+)`).exec(mail.text)![1]!;
  };

  it('Einladung gleichzeitig zweimal angenommen: genau eine Sitzung; neue Einladung macht die alte ungültig', async () => {
    const email = `einladung.${Date.now()}@beispiel.test`;
    expectOk(await call(h, 'POST', '/users/invite', { token: w.admin.token, body: { email, displayName: '[TEST] Doppelt', role: 'service' } }), StaffUserSchema, 201);
    const token = tokenFromMail(email, 'einladung');
    const results = await Promise.all([
      call(h, 'POST', '/auth/invitations/accept', { body: { token, password: 'Passwort-Eins-111' } }),
      call(h, 'POST', '/auth/invitations/accept', { body: { token, password: 'Passwort-Zwei-222' } }),
    ]);
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 400)).toHaveLength(1);

    const record = await createCustomer(h, 'Einladungswechsel');
    await h.db.update(users).set({ status: 'invited', passwordHash: null }).where(eq(users.id, record.id));
    await call(h, 'POST', `/customers/${record.customerId}/account/invite`, { token: w.service.token, body: { email: record.email } });
    const first = tokenFromMail(record.email, 'einladung');
    await call(h, 'POST', `/customers/${record.customerId}/account/invite`, { token: w.service.token, body: { email: record.email } });
    const second = tokenFromMail(record.email, 'einladung');
    expect(second).not.toBe(first);
    expectStatus(await call(h, 'POST', '/auth/invitations/accept', { body: { token: first, password: 'Passwort-Alt-333' } }), 400, 'invitation_invalid');
    expectOk(await call(h, 'POST', '/auth/invitations/accept', { body: { token: second, password: 'Passwort-Neu-444' } }), LoginResponseSchema);
  });

  it('Rücksetz-Link: gleichzeitig nur einmal, nach Ablauf ungültig, älterer Link verfällt mit neuem', async () => {
    const customer = await createCustomer(h, 'Ruecksetz');
    await call(h, 'POST', '/auth/password/forgot', { body: { email: customer.email } });
    await new Promise((r) => setTimeout(r, 20));
    const older = tokenFromMail(customer.email, 'passwort-neu');
    await call(h, 'POST', '/auth/password/forgot', { body: { email: customer.email } });
    await new Promise((r) => setTimeout(r, 20));
    const token = tokenFromMail(customer.email, 'passwort-neu');
    expectStatus(await call(h, 'POST', '/auth/password/reset', { body: { token: older, password: 'Passwort-Alt-5555' } }), 400, 'reset_invalid');
    const results = await Promise.all([
      call(h, 'POST', '/auth/password/reset', { body: { token, password: 'Passwort-Eins-5555' } }),
      call(h, 'POST', '/auth/password/reset', { body: { token, password: 'Passwort-Zwei-5555' } }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([204, 400]);
    await call(h, 'POST', '/auth/password/forgot', { body: { email: customer.email } });
    await new Promise((r) => setTimeout(r, 20));
    const late = tokenFromMail(customer.email, 'passwort-neu');
    h.clock.advance(61 * 60_000);
    const expired = await call(h, 'POST', '/auth/password/reset', { body: { token: late, password: 'Passwort-Spaet-5555' } });
    h.clock.advance(-61 * 60_000);
    expectStatus(expired, 400, 'reset_invalid');
  });
});

describe('A07 Audit-Abdeckung (docs/rollen-und-rechte.md Abschnitt 5)', () => {
  it('Freigabe-, Rechnungs-, Zahlungs-, Dokument-, Freigabelink-, Einstellungs- und Exportaktionen werden protokolliert', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Auditabdeckung');
    const { wo } = await workOrderWithFinishedMaintenance(h, w, customer.customerId!, vehicleId);
    const approval = await createAndSendApproval(h, w.service.token, wo.id, [line('A', 100)]);
    const revised = expectOk(
      await call(h, 'PUT', `/approvals/${approval.id}`, { token: w.service.token, body: { kind: 'additional_work', title: 'x', summaryCustomer: 'y', lines: [line('A', 200)], photoIds: [] } }),
      ApprovalRequestSchema,
    );
    expectOk(await decide(h, customer.token, approval.id, revised.currentVersion.id, revised.currentVersion.contentHash, 'rejected'), ApprovalRequestSchema);
    const second = await createAndSendApproval(h, w.service.token, wo.id, [line('B', 100)]);
    expectOk(await call(h, 'POST', `/approvals/${second.id}/withdraw`, { token: w.service.token }), ApprovalRequestSchema);
    const invoice = await issueInvoice(h, w.service.token, { customerId: customer.customerId!, workOrderId: wo.id, totalGrossCents: 500, withPdf: true });
    expectOk(
      await call(h, 'POST', `/invoices/${invoice.id}/payments/manual`, { token: w.admin.token, body: { method: 'cash', amountCents: 500, receivedAt: iso(-1000), referenceText: 'bar' } }),
      InvoiceSchema,
    );
    const paid = expectOk(await call(h, 'GET', `/invoices/${invoice.id}`, { token: w.admin.token }), InvoiceSchema);
    expectOk(await call(h, 'POST', `/payments/${paid.payments[0]!.id}/refunds`, { token: w.admin.token, body: { amountCents: 100, idempotencyKey: 'audit-erst-0001', reason: 'Kulanz' } }), InvoiceSchema);
    expectOk(await call(h, 'POST', `/invoices/${invoice.id}/cancel`, { token: w.service.token, body: {} }), InvoiceSchema);
    const pdf = expectOk(await uploadFile(h, w.service.token, 'doc.pdf', 'application/pdf', SAMPLE_PDF), FileRefSchema, 201);
    const doc = expectOk(await call(h, 'POST', '/documents', { token: w.service.token, body: { kind: 'report', title: 'D', fileId: pdf.id, workOrderId: wo.id } }), DocumentSchema, 201);
    expectOk(await call(h, 'POST', `/documents/${doc.id}/publish`, { token: w.service.token }), DocumentSchema);
    expectOk(await call(h, 'POST', `/documents/${doc.id}/unpublish`, { token: w.service.token }), DocumentSchema);
    expectOk(await call(h, 'POST', `/work-orders/${wo.id}/complete-review`, { token: w.service.token, body: { confirm: true } }), WorkOrderDetailSchema);
    const entries = await call(h, 'GET', `/vehicles/${vehicleId}/service-entries`, { token: customer.token });
    const share = expectOk(
      await call(h, 'POST', `/vehicles/${vehicleId}/shares`, { token: customer.token, body: { label: 'L', serviceEntryIds: [entries.json()[0].id], expiresAt: iso(86_400_000) } }),
      VehicleShareSchema,
      201,
    );
    await call(h, 'GET', `/public/shares/${share.shareUrl!.split('/').pop()}`);
    expectOk(await call(h, 'POST', `/shares/${share.id}/revoke`, { token: customer.token }), VehicleShareSchema);
    const settings = expectOk(await call(h, 'GET', '/settings/workshop', { token: w.admin.token }), WorkshopSettingsSchema);
    const { paymentProviderConfigured: _p, ...settingsInput } = settings;
    expectOk(await call(h, 'PUT', '/settings/workshop', { token: w.admin.token, body: { ...settingsInput, paymentTermDays: 21 } }), WorkshopSettingsSchema);
    await call(h, 'GET', '/exports/invoices.csv', { token: w.admin.token });
    await call(h, 'GET', `/customers/${customer.customerId}/export`, { token: w.admin.token });

    const expected: Array<[string, string | undefined]> = [
      ['approval.sent', approval.id],
      ['approval.version_sent', approval.id],
      ['approval.decided', approval.id],
      ['approval.withdrawn', second.id],
      ['invoice.issued', invoice.id],
      ['invoice.cancelled', invoice.id],
      ['payment.manual_recorded', paid.payments[0]!.id],
      ['refund.requested', undefined],
      ['refund.succeeded', undefined],
      ['document.published', doc.id],
      ['document.unpublished', doc.id],
      ['service_entry.created', undefined],
      ['vehicle_share.created', share.id],
      ['vehicle_share.accessed', share.id],
      ['vehicle_share.revoked', share.id],
      ['settings.updated', '1'],
      ['export.invoices_csv', undefined],
      ['export.customer_data', customer.customerId!],
    ];
    for (const [action, entityId] of expected) {
      const rows = expectOk(await call(h, 'GET', '/audit', { token: w.admin.token, query: { action, ...(entityId ? { entityId } : {}) } }), z.array(AuditEntrySchema));
      expect(rows.length, action).toBeGreaterThan(0);
    }
    const decided = expectOk(await call(h, 'GET', '/audit', { token: w.admin.token, query: { action: 'approval.decided', entityId: approval.id } }), z.array(AuditEntrySchema));
    expect(decided[0]!.data).toMatchObject({ decision: 'rejected', versionId: revised.currentVersion.id, contentHash: revised.currentVersion.contentHash, versionNo: 2 });
    expect(decided[0]!.actorRole).toBe('customer');
  });
});

describe('A08 Mechaniker und fremde Dateien im Chat', () => {
  it('Chat-Anhänge von Kunden nur aus eigenen Uploads; Mechaniker ohne Chat-Recht nicht', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'ChatDatei');
    const wo = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId, assigneeIds: [w.mechanic.id] });
    const staffPng = expectOk(await uploadFile(h, w.service.token, 'intern.png', 'image/png', SAMPLE_PNG), FileRefSchema, 201);
    expectStatus(
      await call(h, 'POST', `/work-orders/${wo.id}/messages`, { token: customer.token, body: { clientMessageId: 'chat-datei-0001', body: 'x', fileIds: [staffPng.id] } }),
      404,
    );
    expectStatus(
      await call(h, 'POST', `/work-orders/${wo.id}/messages`, { token: w.mechanic.token, body: { clientMessageId: 'chat-datei-0002', body: 'x', fileIds: [staffPng.id] } }),
      403,
    );
    expect(await call(h, 'GET', `/work-orders/${wo.id}/photos`, { token: customer.token }).then((r) => r.json())).toEqual([]);
  });
});

void WorkItemSchema;
