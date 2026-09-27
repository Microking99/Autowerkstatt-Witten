/**
 * Abdeckung der übrigen Endpunkte aus packages/contracts/src/api.ts; jede Antwort wird gegen
 * das Vertrags-Schema geprüft.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ApprovalRequestSchema,
  AppointmentSchema,
  ConversationSchema,
  CustomerDetailSchema,
  CustomerSummarySchema,
  DashboardTileSchema,
  DocumentSchema,
  FileRefSchema,
  FindingSchema,
  IntakeSchema,
  InternalNoteSchema,
  InvoiceSchema,
  MaintenanceDueSchema,
  MaintenanceTypeSchema,
  NotificationPreferencesRequestSchema,
  OdometerReadingSchema,
  PageSchema,
  PhotoSchema,
  ResourceSchema,
  SchedulingConflictSchema,
  StaffUserSchema,
  TimelineEntrySchema,
  VehicleDetailSchema,
  WorkItemSchema,
  WorkOrderDetailSchema,
  WorkshopSettingsSchema,
  endpoints,
} from '@werkstatt/contracts';
import { partDemands, workshopSettings } from '../src/db/schema/index';
import { SAMPLE_PDF, SAMPLE_PNG, call, createHarness, createStaff, expectOk, expectStatus, uploadFile, type Harness } from './support/harness';
import { createAndSendApproval, createWorkOrder, customerWithVehicle, issueInvoice, item, line, setupWorkshop, type Workshop } from './support/scenario';

let h: Harness;
let w: Workshop;
beforeAll(async () => {
  h = await createHarness();
  w = await setupWorkshop(h);
});
afterAll(async () => h?.close());

describe('Vertrag', () => {
  it('jeder Endpunkt aus api.ts ist registriert', () => {
    const missing = Object.entries(endpoints).filter(([, def]) => {
      const url = `/api/v1${def.path}`;
      return !h.app.hasRoute({ method: def.method, url });
    });
    expect(missing.map(([name]) => name)).toEqual([]);
  });
});

describe('Kunden und Fahrzeuge', () => {
  it('Suche, Änderung, Archiv, Zugang sperren; km-Historie mit Plausibilität; QR', async () => {
    const created = expectOk(
      await call(h, 'POST', '/customers', { token: w.service.token, body: { kind: 'business', companyName: '[TEST] Suchfirma GmbH', email: 'suche@beispiel.test', isTestData: true } }),
      CustomerDetailSchema,
      201,
    );
    const found = expectOk(await call(h, 'GET', '/customers', { token: w.service.token, query: { q: 'Suchfirma' } }), PageSchema(CustomerSummarySchema));
    expect(found.items.map((c) => c.id)).toEqual([created.id]);
    const patched = expectOk(await call(h, 'PATCH', `/customers/${created.id}`, { token: w.service.token, body: { phone: '02302 123' } }), CustomerDetailSchema);
    expect(patched).toMatchObject({ phone: '02302 123', isTestData: true, companyName: '[TEST] Suchfirma GmbH' });
    expectStatus(await call(h, 'PATCH', `/customers/${created.id}`, { token: w.service.token, body: { companyName: null } }), 400, 'validation_failed');
    expectStatus(await call(h, 'PATCH', `/customers/${created.id}`, { token: w.mechanic.token, body: { phone: '1' } }), 403);

    const vehicle = expectOk(
      await call(h, 'POST', '/vehicles', { token: w.service.token, body: { licensePlate: 'EN-SU 7', make: 'Mercedes', model: 'Sprinter', ownerCustomerId: created.id } }),
      VehicleDetailSchema,
      201,
    );
    const byPlate = expectOk(await call(h, 'GET', '/customers', { token: w.service.token, query: { q: 'en su 7' } }), PageSchema(CustomerSummarySchema));
    expect(byPlate.items.map((c) => c.id)).toContain(created.id);
    const updated = expectOk(await call(h, 'PATCH', `/vehicles/${vehicle.id}`, { token: w.service.token, body: { color: 'weiß' } }), VehicleDetailSchema);
    expect(updated.color).toBe('weiß');

    const r1 = expectOk(await call(h, 'POST', `/vehicles/${vehicle.id}/odometer`, { token: w.service.token, body: { valueKm: 120000 } }), OdometerReadingSchema, 201);
    expect(r1.plausibility).toBe('ok');
    const r2 = expectOk(await call(h, 'POST', `/vehicles/${vehicle.id}/odometer`, { token: w.service.token, body: { valueKm: 110000 } }), OdometerReadingSchema, 201);
    expect(r2.plausibility).toBe('lower_than_previous');
    const history = expectOk(await call(h, 'GET', `/vehicles/${vehicle.id}/odometer`, { token: w.service.token }), z.array(OdometerReadingSchema));
    expect(history).toHaveLength(2);
    const detail = expectOk(await call(h, 'GET', `/vehicles/${vehicle.id}`, { token: w.service.token }), VehicleDetailSchema);
    expect(detail.lastOdometerKm).toBe(120000);
    expect(detail.qrUrl).toMatch(/^https:\/\/app\.werkstatt\.test\/q\//);

    const rotated = expectOk(await call(h, 'POST', `/vehicles/${vehicle.id}/qr/rotate`, { token: w.service.token }), VehicleDetailSchema);
    expect(rotated.qrUrl).not.toBe(detail.qrUrl);
    const oldToken = detail.qrUrl!.split('/q/')[1]!;
    expectStatus(await call(h, 'GET', `/public/qr/${oldToken}`), 404);
    const sticker = await call(h, 'GET', `/vehicles/${vehicle.id}/qr/sticker.svg`, { token: w.service.token });
    expect(sticker.statusCode).toBe(200);
    expect(sticker.headers['content-type']).toContain('image/svg+xml');
    expect(sticker.body).toContain('<svg');
    expect(sticker.body).not.toContain('EN-SU 7');

    expectOk(await call(h, 'POST', `/customers/${created.id}/archive`, { token: w.service.token }), CustomerDetailSchema);
    const active = expectOk(await call(h, 'GET', '/customers', { token: w.service.token, query: { q: 'Suchfirma' } }), PageSchema(CustomerSummarySchema));
    expect(active.items).toHaveLength(0);

    const { customer } = await customerWithVehicle(h, 'Sperre');
    const disabled = expectOk(await call(h, 'POST', `/customers/${customer.customerId}/account/disable`, { token: w.service.token }), CustomerDetailSchema);
    expect(disabled.accessStatus).toBe('disabled');
    expectStatus(await call(h, 'GET', '/auth/me', { token: customer.token }), 401);
  });
});

describe('Termine', () => {
  it('Konfliktprüfung: Speichern bei Konflikt nur mit Begründung; Alternative annehmen/ablehnen; absagen', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Termin');
    const lift = expectOk(await call(h, 'PUT', `/settings/resources/${randomUUID()}`, { token: w.admin.token, body: { name: 'Hebebühne 1', kind: 'lift', active: true } }), ResourceSchema);
    const resources = expectOk(await call(h, 'GET', '/resources', { token: w.service.token }), z.array(ResourceSchema));
    expect(resources.map((r) => r.id)).toContain(lift.id);
    const slot = { startsAt: '2027-04-06T07:00:00.000Z', endsAt: '2027-04-06T09:00:00.000Z' };
    const first = expectOk(
      await call(h, 'POST', '/appointments', {
        token: w.service.token,
        body: { kind: 'service', customerId: customer.customerId, vehicleId, ...slot, resourceId: lift.id, assigneeIds: [w.mechanic.id] },
      }),
      AppointmentSchema,
      201,
    );
    expect(first.status).toBe('confirmed');
    const conflicts = expectOk(
      await call(h, 'POST', '/appointments/conflicts', { token: w.service.token, body: { ...slot, resourceId: lift.id, assigneeIds: [w.mechanic.id] } }),
      z.array(SchedulingConflictSchema),
    );
    expect(conflicts.map((c) => c.kind).sort()).toEqual(['assignee_double_booked', 'resource_double_booked']);
    const blocked = await call(h, 'POST', '/appointments', {
      token: w.service.token,
      body: { kind: 'repair', customerId: customer.customerId, vehicleId, ...slot, resourceId: lift.id },
    });
    expectStatus(blocked, 409, 'scheduling_conflicts');
    expect(z.array(SchedulingConflictSchema).parse(blocked.json().error.details)).toHaveLength(1);
    const forced = expectOk(
      await call(h, 'POST', '/appointments', {
        token: w.service.token,
        body: { kind: 'repair', customerId: customer.customerId, vehicleId, ...slot, resourceId: lift.id, overrideConflictsReason: 'Kurzer Check, passt dazwischen' },
      }),
      AppointmentSchema,
      201,
    );
    expect(forced.internalNote).toBeNull();
    // Kunde sieht keine internen Felder
    const customerView = expectOk(await call(h, 'GET', `/appointments/${first.id}`, { token: customer.token }), AppointmentSchema);
    expect(customerView).not.toHaveProperty('resourceId');
    expect(customerView).not.toHaveProperty('internalNote');

    // Anfrage → Alternative → Ablehnung → neue Alternative → Annahme
    const request = expectOk(
      await call(h, 'POST', '/appointments/requests', {
        token: customer.token,
        body: { kind: 'service', vehicleId, preferredStart: '2027-05-03T07:00:00.000Z', preferredEnd: '2027-05-03T08:00:00.000Z', customerNote: 'vormittags' },
      }),
      AppointmentSchema,
      201,
    );
    expectStatus(await call(h, 'POST', '/appointments/requests', { token: w.service.token, body: { kind: 'service', vehicleId, preferredStart: '2027-05-03T07:00:00.000Z', preferredEnd: '2027-05-03T08:00:00.000Z' } }), 403);
    const proposed = expectOk(
      await call(h, 'POST', `/appointments/${request.id}/proposals`, { token: w.service.token, body: { startsAt: '2027-05-04T07:00:00.000Z', endsAt: '2027-05-04T08:00:00.000Z' } }),
      AppointmentSchema,
    );
    const p1 = proposed.proposals[0]!;
    // Werkstatt kann die eigene Alternative nicht für den Kunden annehmen
    expectStatus(await call(h, 'POST', `/appointments/${request.id}/proposals/${p1.id}/accept`, { token: w.service.token }), 403);
    const declined = expectOk(await call(h, 'POST', `/appointments/${request.id}/proposals/${p1.id}/decline`, { token: customer.token, body: {} }), AppointmentSchema);
    expect(declined.status).toBe('requested');
    const proposed2 = expectOk(
      await call(h, 'POST', `/appointments/${request.id}/proposals`, { token: w.service.token, body: { startsAt: '2027-05-05T07:00:00.000Z', endsAt: '2027-05-05T08:00:00.000Z' } }),
      AppointmentSchema,
    );
    const p2 = proposed2.proposals.find((p) => p.status === 'open')!;
    const accepted = expectOk(await call(h, 'POST', `/appointments/${request.id}/proposals/${p2.id}/accept`, { token: customer.token }), AppointmentSchema);
    expect(accepted).toMatchObject({ status: 'confirmed', startsAt: '2027-05-05T07:00:00.000Z' });
    const cancelled = expectOk(await call(h, 'POST', `/appointments/${request.id}/cancel`, { token: customer.token, body: { reason: 'Verhindert' } }), AppointmentSchema);
    expect(cancelled.status).toBe('cancelled');
    const list = expectOk(await call(h, 'GET', '/appointments', { token: customer.token, query: { status: 'cancelled' } }), z.array(AppointmentSchema));
    expect(list.map((a) => a.id)).toEqual([request.id]);
    const confirmBooked = await call(h, 'POST', `/appointments/${first.id}/confirm`, { token: w.service.token, body: {} });
    expectStatus(confirmBooked, 409);
  });

  it('fehlende Teile und Öffnungszeiten werden als Konflikt gemeldet', async () => {
    await h.db.update(workshopSettings).set({ openingHours: [{ weekday: 1, opens: '08:00', closes: '17:00' }] });
    const { customer, vehicleId } = await customerWithVehicle(h, 'Teile');
    const wo = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId });
    // Teilebedarf hat im Vertrag noch keinen Endpunkt; hier direkt angelegt
    await h.db.insert(partDemands).values({ workOrderId: wo.id, description: 'Zahnriemensatz', status: 'ordered' });
    const conflicts = expectOk(
      await call(h, 'POST', '/appointments/conflicts', {
        token: w.service.token,
        // Sonntag 03:00 Uhr Berliner Zeit: außerhalb der Öffnungszeiten (Test-Werkstatt: Mo 08-17 Uhr)
        body: { startsAt: '2027-06-06T01:00:00.000Z', endsAt: '2027-06-06T02:00:00.000Z', assigneeIds: [], workOrderId: wo.id },
      }),
      z.array(SchedulingConflictSchema),
    );
    expect(conflicts.map((c) => c.kind).sort()).toEqual(['outside_opening_hours', 'parts_missing']);
    expect(conflicts.find((c) => c.kind === 'parts_missing')!.message).toContain('Zahnriemensatz');
  });
});

describe('Aufträge im Detail', () => {
  it('Annahme mit Inhalts-Hash, Positionen, Teile, Feststellungen, Fotos, Verlauf, Abholung', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Detail');
    const wo = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId, items: [item('Klimaservice')] });
    const patched = expectOk(
      await call(h, 'PATCH', `/work-orders/${wo.id}`, { token: w.service.token, body: { notesInternal: 'Kunde wartet', costLimitCents: 30000 } }),
      WorkOrderDetailSchema,
    );
    expect(patched.notesInternal).toBe('Kunde wartet');
    expectOk(await call(h, 'PUT', `/work-orders/${wo.id}/assignees`, { token: w.service.token, body: { assigneeIds: [w.mechanic.id] } }), WorkOrderDetailSchema);

    const intakeBody = {
      odometerKm: 64000,
      fuelLevel: '1/2',
      customerComplaint: 'Klima kühlt nicht',
      damages: [{ area: 'Stoßfänger vorne', description: 'Kratzer', photoId: null }],
      agreedServices: 'Klimaservice',
      notesInternal: 'Kunde ist Stammkunde',
      notesCustomer: 'Abholung ab 16 Uhr',
    };
    const intake = expectOk(await call(h, 'PUT', `/work-orders/${wo.id}/intake`, { token: w.service.token, body: intakeBody }), IntakeSchema);
    expect(intake.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const customerIntake = expectOk(await call(h, 'GET', `/work-orders/${wo.id}/intake`, { token: customer.token }), IntakeSchema);
    expect(customerIntake).not.toHaveProperty('notesInternal');
    expectStatus(
      await call(h, 'POST', `/work-orders/${wo.id}/intake/confirm`, { token: customer.token, body: { method: 'app', contentHash: 'a'.repeat(64) } }),
      409,
      'intake_changed',
    );
    const confirmed = expectOk(
      await call(h, 'POST', `/work-orders/${wo.id}/intake/confirm`, { token: customer.token, body: { method: 'app', contentHash: intake.contentHash } }),
      IntakeSchema,
    );
    expect(confirmed).toMatchObject({ confirmationMethod: 'app', contentHash: intake.contentHash });
    // Nach bestätigter Annahme: weitere Arbeiten nur als Freigabeanfrage
    expectStatus(await call(h, 'POST', `/work-orders/${wo.id}/items`, { token: w.service.token, body: item('Zusatz') }), 409, 'approval_required');

    const approval = await createAndSendApproval(h, w.service.token, wo.id, [line('Kondensator', 25000)]);
    const withItems = expectOk(await call(h, 'GET', `/work-orders/${wo.id}`, { token: w.service.token }), WorkOrderDetailSchema);
    const approvalItem = withItems.items.find((i) => i.approvalRequestId === approval.id)!;
    expectStatus(await call(h, 'PATCH', `/work-items/${approvalItem.id}`, { token: w.service.token, body: { unitPriceCents: 1 } }), 409, 'approval_bound');
    const withdrawn = expectOk(await call(h, 'POST', `/approvals/${approval.id}/withdraw`, { token: w.service.token }), ApprovalRequestSchema);
    expect(withdrawn.status).toBe('withdrawn');
    const afterWithdraw = expectOk(await call(h, 'GET', `/work-orders/${wo.id}`, { token: w.service.token }), WorkOrderDetailSchema);
    expect(afterWithdraw.items.find((i) => i.id === approvalItem.id)!.authorization).toBe('withdrawn');

    const klima = wo.items[0]!;
    const patchedItem = expectOk(await call(h, 'PATCH', `/work-items/${klima.id}`, { token: w.service.token, body: { description: 'inkl. Desinfektion' } }), WorkItemSchema);
    expect(patchedItem).toMatchObject({ quantity: 1, unit: 'Std', description: 'inkl. Desinfektion' });
    expectOk(await call(h, 'POST', `/work-items/${klima.id}/start`, { token: w.mechanic.token }), WorkItemSchema);
    expectOk(await call(h, 'POST', `/work-items/${klima.id}/pause`, { token: w.mechanic.token }), WorkItemSchema);
    const part = expectOk(
      await call(h, 'POST', `/work-items/${klima.id}/parts`, { token: w.mechanic.token, body: { partNumber: 'KM-1', description: 'Kältemittel', quantity: 0.5, unitPriceCents: 999 } }),
      WorkItemSchema,
      201,
    );
    expect(part).not.toHaveProperty('unitPriceCents');

    const png = expectOk(await uploadFile(h, w.mechanic.token, 'befund.png', 'image/png', SAMPLE_PNG), FileRefSchema, 201);
    const photoId = randomUUID();
    const photo = expectOk(await call(h, 'POST', `/work-orders/${wo.id}/photos`, { token: w.mechanic.token, body: { id: photoId, fileId: png.id, context: 'finding' } }), PhotoSchema, 201);
    expect(photo).toMatchObject({ id: photoId, visibility: 'internal' });
    // Offline-Wiederholung mit gleicher ID
    expectOk(await call(h, 'POST', `/work-orders/${wo.id}/photos`, { token: w.mechanic.token, body: { id: photoId, fileId: png.id, context: 'finding' } }), PhotoSchema, 200);
    expectStatus(await call(h, 'PUT', `/photos/${photo.id}/visibility`, { token: w.mechanic.token, body: { visibility: 'customer' } }), 403);
    const findingId = randomUUID();
    const finding = expectOk(
      await call(h, 'POST', `/work-orders/${wo.id}/findings`, {
        token: w.mechanic.token,
        body: { id: findingId, description: 'Leitung porös', severity: 'recommended', photoIds: [photo.id], dictated: true },
      }),
      FindingSchema,
      201,
    );
    expect(finding.photoIds).toEqual([photo.id]);
    const findings = expectOk(await call(h, 'GET', `/work-orders/${wo.id}/findings`, { token: w.service.token }), z.array(FindingSchema));
    expect(findings).toHaveLength(1);
    expectStatus(await call(h, 'POST', `/findings/${finding.id}/dismiss`, { token: w.mechanic.token }), 403);
    const dismissed = expectOk(await call(h, 'POST', `/findings/${finding.id}/dismiss`, { token: w.service.token }), FindingSchema);
    expect(dismissed.status).toBe('dismissed');

    expectOk(await call(h, 'POST', `/work-items/${klima.id}/finish`, { token: w.mechanic.token, body: { resultNotes: 'erledigt' } }), WorkItemSchema);
    const done = expectOk(await call(h, 'GET', `/work-orders/${wo.id}`, { token: w.service.token }), WorkOrderDetailSchema);
    expect(done.status.work).toBe('work_completed');
    expect(done.items.find((i) => i.id === klima.id)!.trackedMinutes).toBeGreaterThanOrEqual(0);
    expectStatus(await call(h, 'POST', `/work-orders/${wo.id}/picked-up`, { token: w.service.token }), 409);
    expectOk(await call(h, 'POST', `/work-orders/${wo.id}/complete-review`, { token: w.service.token, body: { confirm: true } }), WorkOrderDetailSchema);
    const picked = expectOk(await call(h, 'POST', `/work-orders/${wo.id}/picked-up`, { token: w.service.token }), WorkOrderDetailSchema);
    expect(picked.status.work).toBe('picked_up');
    expect(picked.pickedUpAt).not.toBeNull();

    const timeline = expectOk(await call(h, 'GET', `/work-orders/${wo.id}/timeline`, { token: w.service.token }), z.array(TimelineEntrySchema));
    const actions = timeline.map((t) => t.action);
    for (const a of ['work_order.created', 'intake.confirmed', 'approval.sent', 'approval.withdrawn', 'work_item.finished', 'work_order.completion_reviewed']) {
      expect(actions, a).toContain(a);
    }
    expect(timeline.find((t) => t.action === 'work_order.status_changed')!.summary).toMatch(/^Arbeitsstatus: /);
    expectStatus(await call(h, 'GET', `/work-orders/${wo.id}/timeline`, { token: customer.token }), 404);
    // Stornieren nach Abschluss nicht mehr möglich
    expectStatus(await call(h, 'POST', `/work-orders/${wo.id}/transition`, { token: w.service.token, body: { to: 'cancelled' } }), 409);
  });
});

describe('Dokumente, Chat, Rechnungen', () => {
  it('Versionen und Veröffentlichung, Gespräche mit Ungelesen-Zähler, interne Notizen, Storno', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Doku');
    const wo = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId });
    const f1 = expectOk(await uploadFile(h, w.service.token, 'v1.pdf', 'application/pdf', SAMPLE_PDF), FileRefSchema, 201);
    const f2 = expectOk(await uploadFile(h, w.service.token, 'v2.pdf', 'application/pdf', SAMPLE_PDF), FileRefSchema, 201);
    const doc = expectOk(await call(h, 'POST', '/documents', { token: w.service.token, body: { kind: 'offer', title: 'Angebot', fileId: f1.id, workOrderId: wo.id } }), DocumentSchema, 201);
    expect(doc).toMatchObject({ visibility: 'internal', customerId: customer.customerId, versionCount: 1 });
    const v2 = expectOk(await call(h, 'POST', `/documents/${doc.id}/versions`, { token: w.service.token, body: { fileId: f2.id, note: 'Preis korrigiert' } }), DocumentSchema, 201);
    expect(v2.currentVersion.versionNo).toBe(2);
    expect(v2.versionCount).toBe(2);
    expectStatus(await call(h, 'POST', `/documents/${doc.id}/publish`, { token: w.mechanic.token }), 403);
    expectOk(await call(h, 'POST', `/documents/${doc.id}/publish`, { token: w.service.token }), DocumentSchema);
    expect(expectOk(await call(h, 'GET', '/documents', { token: customer.token, query: { workOrderId: wo.id } }), z.array(DocumentSchema))).toHaveLength(1);
    expectOk(await call(h, 'POST', `/documents/${doc.id}/unpublish`, { token: w.service.token }), DocumentSchema);
    expect(expectOk(await call(h, 'GET', '/documents', { token: customer.token }), z.array(DocumentSchema))).toHaveLength(0);
    // Veröffentlichen verlangt Kundenbezug
    const vf = expectOk(await uploadFile(h, w.service.token, 'fz.pdf', 'application/pdf', SAMPLE_PDF), FileRefSchema, 201);
    const vehicleDoc = expectOk(await call(h, 'POST', '/documents', { token: w.service.token, body: { kind: 'report', title: 'Fahrzeugschein', fileId: vf.id, vehicleId } }), DocumentSchema, 201);
    expectStatus(await call(h, 'POST', `/documents/${vehicleDoc.id}/publish`, { token: w.service.token }), 422, 'customer_required');

    await call(h, 'POST', `/work-orders/${wo.id}/messages`, { token: w.service.token, body: { clientMessageId: 'doku-msg-0001', body: 'Angebot liegt vor' } });
    await call(h, 'POST', `/work-orders/${wo.id}/messages`, { token: w.service.token, body: { clientMessageId: 'doku-msg-0002', body: 'Bitte prüfen' } });
    const conv = expectOk(await call(h, 'GET', '/conversations', { token: customer.token }), z.array(ConversationSchema));
    expect(conv).toHaveLength(1);
    expect(conv[0]).toMatchObject({ workOrderId: wo.id, unreadCount: 2, counterpartDisplayName: 'Autowerkstatt Witten' });
    expectStatus(await call(h, 'POST', `/work-orders/${wo.id}/messages/read`, { token: customer.token }), 204);
    const after = expectOk(await call(h, 'GET', '/conversations', { token: customer.token }), z.array(ConversationSchema));
    expect(after[0]!.unreadCount).toBe(0);
    const note = expectOk(await call(h, 'POST', `/work-orders/${wo.id}/internal-notes`, { token: w.service.token, body: { body: 'Nur intern' } }), InternalNoteSchema, 201);
    expect(expectOk(await call(h, 'GET', `/work-orders/${wo.id}/internal-notes`, { token: w.service.token }), z.array(InternalNoteSchema)).map((n) => n.id)).toEqual([note.id]);
    const messages = await call(h, 'GET', `/work-orders/${wo.id}/messages`, { token: customer.token });
    expect(messages.body).not.toContain('Nur intern');

    const invoice = await issueInvoice(h, w.service.token, { customerId: customer.customerId!, workOrderId: wo.id, totalGrossCents: 5000 });
    expect(invoice.bankTransfer).toMatchObject({ iban: 'DE02120300000000202051', reference: invoice.invoiceNumber });
    expect(invoice.onlinePaymentAvailable).toBe(true);
    const open = expectOk(await call(h, 'GET', '/invoices', { token: w.service.token, query: { paymentStatus: 'open' } }), z.array(InvoiceSchema));
    expect(open.map((i) => i.id)).toContain(invoice.id);
    h.clock.advance(20 * 86_400_000);
    const overdue = expectOk(await call(h, 'GET', '/invoices', { token: w.service.token, query: { overdue: 'true' } }), z.array(InvoiceSchema));
    h.clock.advance(-20 * 86_400_000);
    expect(overdue.map((i) => i.id)).toContain(invoice.id);
    const cancelled = expectOk(await call(h, 'POST', `/invoices/${invoice.id}/cancel`, { token: w.service.token, body: { reason: 'Falscher Betrag' } }), InvoiceSchema);
    expect(cancelled).toMatchObject({ status: 'cancelled', paymentStatus: 'cancelled' });
    expectStatus(await call(h, 'POST', `/invoices/${invoice.id}/checkout`, { token: customer.token }), 409);
    // Entwurf: für Kunden unsichtbar
    const draft = expectOk(await call(h, 'POST', '/invoices', { token: w.service.token, body: { customerId: customer.customerId, totalGrossCents: 100 } }), InvoiceSchema, 201);
    expectStatus(await call(h, 'GET', `/invoices/${draft.id}`, { token: customer.token }), 404);
  });
});

describe('Einstellungen, Benachrichtigungen, Dashboard, Benutzer', () => {
  it('Werkstattdaten, Wartungsarten, Hebebühnen, Geräte, Präferenzen, Kacheln', async () => {
    const settings = expectOk(await call(h, 'GET', '/settings/workshop', { token: w.admin.token }), WorkshopSettingsSchema);
    expect(settings.paymentProviderConfigured).toBe(true);
    expectStatus(await call(h, 'GET', '/settings/workshop', { token: w.service.token }), 403);
    const { paymentProviderConfigured: _c, ...input } = settings;
    const saved = expectOk(
      await call(h, 'PUT', '/settings/workshop', { token: w.admin.token, body: { ...input, phone: '02302 999', openingHours: [{ weekday: 1, opens: '08:00', closes: '17:00' }] } }),
      WorkshopSettingsSchema,
    );
    expect(saved.phone).toBe('02302 999');
    expect(JSON.stringify(saved)).not.toMatch(/sup_sk_/);

    const types = expectOk(await call(h, 'GET', '/settings/maintenance-types', { token: w.mechanic.token }), z.array(MaintenanceTypeSchema));
    expect(types.map((t) => t.key)).toContain('oil_change');
    const newType = expectOk(
      await call(h, 'PUT', `/settings/maintenance-types/${randomUUID()}`, {
        token: w.admin.token,
        body: { key: 'air_filter', name: 'Luftfilter', defaultIntervalKm: 30000, defaultIntervalMonths: 24, intervalOptions: [{ km: 30000, months: null, label: 'alle 30.000 km' }], active: true },
      }),
      MaintenanceTypeSchema,
    );
    expect(newType.key).toBe('air_filter');
    expectStatus(
      await call(h, 'PUT', `/settings/maintenance-types/${randomUUID()}`, {
        token: w.admin.token,
        body: { key: 'air_filter', name: 'Doppelt', defaultIntervalKm: null, defaultIntervalMonths: null, intervalOptions: [], active: true },
      }),
      409,
    );
    expectStatus(await call(h, 'GET', '/settings/maintenance-types', { token: (await customerWithVehicle(h, 'Typen')).customer.token }), 403);

    const { customer } = await customerWithVehicle(h, 'Geraet');
    expectStatus(await call(h, 'POST', '/devices', { token: customer.token, body: { platform: 'android', pushToken: 'ExponentPushToken[geraet-0001]' } }), 204);
    const prefs = expectOk(await call(h, 'GET', '/notification-preferences', { token: customer.token }), NotificationPreferencesRequestSchema);
    expect(prefs.preferences.length).toBeGreaterThan(10);
    const updated = expectOk(
      await call(h, 'PUT', '/notification-preferences', { token: customer.token, body: { preferences: [{ eventType: 'message.received', channel: 'email', enabled: false }] } }),
      NotificationPreferencesRequestSchema,
    );
    expect(updated.preferences.find((p) => p.eventType === 'message.received' && p.channel === 'email')!.enabled).toBe(false);

    for (const user of [w.admin, w.service, w.mechanic, customer]) {
      const tiles = expectOk(await call(h, 'GET', '/dashboard', { token: user.token }), z.array(DashboardTileSchema));
      expect(tiles.length, user.role).toBeGreaterThan(0);
      const area = user.role === 'customer' ? '/kunde' : user.role === 'mechanic' ? '/mechaniker' : '/werkstatt';
      expect(tiles.every((t) => t.targetPath.startsWith(area)), user.role).toBe(true);
    }
    const serviceTiles = expectOk(await call(h, 'GET', '/dashboard', { token: w.service.token }), z.array(DashboardTileSchema));
    expect(serviceTiles.find((t) => t.key === 'pending_approvals')!.targetPath).toBe('/werkstatt/auftraege?freigabe=pending');
    const due = expectOk(await call(h, 'GET', '/maintenance-due', { token: w.service.token }), z.array(MaintenanceDueSchema));
    expect(Array.isArray(due)).toBe(true);

    const staff = await createStaff(h, 'service');
    expectOk(await call(h, 'GET', `/users/${staff.id}`, { token: w.admin.token }), StaffUserSchema);
    expectOk(await call(h, 'POST', `/users/${staff.id}/disable`, { token: w.admin.token }), StaffUserSchema);
    const enabled = expectOk(await call(h, 'POST', `/users/${staff.id}/enable`, { token: w.admin.token }), StaffUserSchema);
    expect(enabled.status).toBe('active');
    expectStatus(await call(h, 'GET', `/users/${customer.id}`, { token: w.admin.token }), 404);
  });
});
