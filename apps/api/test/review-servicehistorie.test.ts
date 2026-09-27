/**
 * Review (Claude-Unteragent, 27.09.2026): Angriffsszenarien Servicehistorie und Fälligkeiten (C-03).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  ApprovalRequestSchema,
  AuditEntrySchema,
  MaintenanceDueSchema,
  OdometerReadingSchema,
  PublicVehicleViewSchema,
  QrResolutionSchema,
  ServiceEntrySchema,
  VehicleDetailSchema,
  VehicleShareSchema,
  WorkItemSchema,
  WorkOrderDetailSchema,
} from '@werkstatt/contracts';
import { evaluateMaintenanceDue, type ServiceEntryRecord } from '@werkstatt/domain';
import { serviceEntries, vehicles } from '../src/db/schema/index';
import { call, createHarness, createStaff, expectOk, expectStatus, type Harness } from './support/harness';
import {
  createAndSendApproval,
  createWorkOrder,
  customerWithVehicle,
  decide,
  issueInvoice,
  item,
  line,
  setupWorkshop,
  workOrderWithFinishedMaintenance,
  type Workshop,
} from './support/scenario';

let h: Harness;
let w: Workshop;
beforeAll(async () => {
  h = await createHarness();
  w = await setupWorkshop(h);
});
afterAll(async () => h?.close());

const iso = (offsetMs = 0) => new Date(h.clock.now().getTime() + offsetMs).toISOString();
const entriesOf = (woId: string) => h.db.select().from(serviceEntries).where(eq(serviceEntries.workOrderId, woId));
const complete = (woId: string, token = w.service.token, headers: Record<string, string> = {}) =>
  call(h, 'POST', `/work-orders/${woId}/complete-review`, { token, headers, body: { confirm: true } });

describe('H01 kein Eintrag ohne fachlichen Abschluss', () => {
  it('Freigabe, Positionsabschluss, Rechnung, Zahlung, Abholbereit: kein Eintrag', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'OhneAbschluss');
    const wo = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId, assigneeIds: [w.mechanic.id] });
    const approval = await createAndSendApproval(h, w.service.token, wo.id, [line('Ölwechsel', 9000, { maintenanceTypeId: w.oilChangeTypeId })]);
    expectOk(await decide(h, customer.token, approval.id, approval.currentVersion.id, approval.currentVersion.contentHash, 'approved'), ApprovalRequestSchema);
    const detail = expectOk(await call(h, 'GET', `/work-orders/${wo.id}`, { token: w.service.token }), WorkOrderDetailSchema);
    const oil = detail.items.find((i) => i.approvalRequestId === approval.id)!;
    expectOk(await call(h, 'POST', `/work-items/${oil.id}/finish`, { token: w.mechanic.token, body: { odometerKm: 30000 } }), WorkItemSchema);
    const invoice = await issueInvoice(h, w.service.token, { customerId: customer.customerId!, workOrderId: wo.id, totalGrossCents: 10710 });
    expectOk(
      await call(h, 'POST', `/invoices/${invoice.id}/payments/manual`, {
        token: w.admin.token,
        body: { method: 'cash', amountCents: 10710, receivedAt: iso(-60_000), referenceText: 'Bar' },
      }),
      z.any(),
    );
    expectOk(await call(h, 'POST', `/work-orders/${wo.id}/ready-for-pickup`, { token: w.service.token }), WorkOrderDetailSchema);
    expectStatus(await call(h, 'POST', `/work-orders/${wo.id}/picked-up`, { token: w.service.token }), 409);
    expect(await entriesOf(wo.id)).toHaveLength(0);
    // es gibt keinen Endpunkt, um Einträge direkt anzulegen oder zu ändern
    expectStatus(await call(h, 'POST', `/vehicles/${vehicleId}/service-entries`, { token: w.admin.token, body: {} }), 404);
    expectStatus(await call(h, 'POST', '/service-entries', { token: w.admin.token, body: {} }), 404);
  });
});

describe('H02 nur ausgeführte, vereinbarte/freigegebene Wartungsarbeit', () => {
  it('abgelehnte, zurückgezogene, wartende und nicht durchgeführte Positionen erzeugen keinen Eintrag', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Auswahl');
    const wo = await createWorkOrder(h, w.service.token, {
      customerId: customer.customerId!,
      vehicleId,
      assigneeIds: [w.mechanic.id],
      items: [item('Ölwechsel', { maintenanceTypeId: w.oilChangeTypeId }), item('Bremsflüssigkeit', { maintenanceTypeId: w.brakeFluidTypeId }), item('Reparatur ohne Wartungsart')],
    });
    const rejected = await createAndSendApproval(h, w.service.token, wo.id, [line('Abgelehnt Öl', 100, { maintenanceTypeId: w.oilChangeTypeId })]);
    expectOk(await decide(h, customer.token, rejected.id, rejected.currentVersion.id, rejected.currentVersion.contentHash, 'rejected'), ApprovalRequestSchema);
    const withdrawn = await createAndSendApproval(h, w.service.token, wo.id, [line('Zurückgezogen Bremse', 100, { maintenanceTypeId: w.brakeFluidTypeId })]);
    expectOk(await call(h, 'POST', `/approvals/${withdrawn.id}/withdraw`, { token: w.service.token }), ApprovalRequestSchema);
    await createAndSendApproval(h, w.service.token, wo.id, [line('Wartet Öl', 100, { maintenanceTypeId: w.oilChangeTypeId })]);
    const [oil, brake, repair] = wo.items;
    expectOk(await call(h, 'POST', `/work-items/${oil!.id}/finish`, { token: w.mechanic.token, body: { odometerKm: 80000 } }), WorkItemSchema);
    expectOk(await call(h, 'POST', `/work-items/${brake!.id}/not-done`, { token: w.mechanic.token, body: { reason: 'Kunde wollte nicht' } }), WorkItemSchema);
    expectOk(await call(h, 'POST', `/work-items/${repair!.id}/finish`, { token: w.mechanic.token, body: {} }), WorkItemSchema);
    expectOk(await complete(wo.id), WorkOrderDetailSchema);
    const rows = await entriesOf(wo.id);
    expect(rows.map((r) => r.workItemId)).toEqual([oil!.id]);
    expect(rows[0]!.odometerKm).toBe(80000);
  });
});

describe('H03 genau einmal', () => {
  it('gleichzeitiger und wiederholter Abschluss (auch mit Idempotency-Key): ein Eintrag je Position, ein Audit-Eintrag', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Einmal');
    const { wo, itemId } = await workOrderWithFinishedMaintenance(h, w, customer.customerId!, vehicleId);
    const results = await Promise.all([complete(wo.id), complete(wo.id), complete(wo.id, w.admin.token), complete(wo.id)]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200]);
    const key = 'abschluss-schluessel-01';
    const first = await complete(wo.id, w.service.token, { 'idempotency-key': key });
    const replay = await complete(wo.id, w.service.token, { 'idempotency-key': key });
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(first.json());
    const rows = await entriesOf(wo.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.workItemId).toBe(itemId);
    const audit = expectOk(await call(h, 'GET', '/audit', { token: w.admin.token, query: { action: 'service_entry.created', entityId: rows[0]!.id } }), z.array(AuditEntrySchema));
    expect(audit).toHaveLength(1);
    const statusChanges = expectOk(await call(h, 'GET', '/audit', { token: w.admin.token, query: { action: 'work_order.completion_reviewed', entityId: wo.id } }), z.array(AuditEntrySchema));
    expect(statusChanges).toHaveLength(1);
  });

  it('Abschluss nur aus "Arbeiten erledigt"; stornierter Auftrag erzeugt nichts', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Storno');
    const wo = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId, assigneeIds: [w.mechanic.id], items: [item('Öl', { maintenanceTypeId: w.oilChangeTypeId }), item('Rest')] });
    expectOk(await call(h, 'POST', `/work-items/${wo.items[0]!.id}/finish`, { token: w.mechanic.token, body: { odometerKm: 1000 } }), WorkItemSchema);
    expectStatus(await complete(wo.id), 409);
    expectOk(await call(h, 'POST', `/work-orders/${wo.id}/transition`, { token: w.service.token, body: { to: 'cancelled', reason: 'Abbruch' } }), WorkOrderDetailSchema);
    expectStatus(await complete(wo.id), 409);
    expect(await entriesOf(wo.id)).toHaveLength(0);
  });
});

describe('H04 Recht für den Abschluss', () => {
  it('Mechaniker ohne workOrders.completeReview: 403; mit Recht nur für sichtbare Aufträge', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Abschlussrecht');
    const { wo } = await workOrderWithFinishedMaintenance(h, w, customer.customerId!, vehicleId);
    expectStatus(await complete(wo.id, w.mechanic.token), 403);
    const unassigned = await createStaff(h, 'mechanic', { overrides: [{ permission: 'workOrders.completeReview', granted: true }] });
    expectStatus(await complete(wo.id, unassigned.token), 403);
    expectStatus(await complete(wo.id, customer.token), 404);
    expect(await entriesOf(wo.id)).toHaveLength(0);
  });
});

describe('H05 Korrekturen', () => {
  it('gleichzeitige Korrekturen verzweigen nicht; alte Fassung nicht erneut korrigierbar; Stornierung ist Revision', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Korrektur');
    const { wo } = await workOrderWithFinishedMaintenance(h, w, customer.customerId!, vehicleId, 55000);
    expectOk(await complete(wo.id), WorkOrderDetailSchema);
    const [original] = await entriesOf(wo.id);
    const results = await Promise.all([
      call(h, 'POST', `/service-entries/${original!.id}/corrections`, { token: w.admin.token, body: { odometerKm: 55500, reason: 'Ablesefehler' } }),
      call(h, 'POST', `/service-entries/${original!.id}/corrections`, { token: w.admin.token, body: { odometerKm: 56000, reason: 'anderer Ablesefehler' } }),
    ]);
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode !== 201).every((r) => r.statusCode === 422 || r.statusCode === 409)).toBe(true);
    const rows = await h.db.select().from(serviceEntries).where(eq(serviceEntries.revisionOfId, original!.id));
    expect(rows).toHaveLength(1);
    expectStatus(await call(h, 'POST', `/service-entries/${original!.id}/corrections`, { token: w.admin.token, body: { title: 'x', reason: 'y' } }), 422, 'not_current');
    expectStatus(await call(h, 'POST', `/service-entries/${rows[0]!.id}/corrections`, { token: w.admin.token, body: { title: 'x' } }), 400);
    expectStatus(await call(h, 'PATCH', `/service-entries/${rows[0]!.id}`, { token: w.admin.token, body: { title: 'x' } }), 404);
    expectStatus(await call(h, 'DELETE', `/service-entries/${rows[0]!.id}`, { token: w.admin.token }), 404);
    const voided = expectOk(
      await call(h, 'POST', `/service-entries/${rows[0]!.id}/corrections`, { token: w.admin.token, body: { void: true, reason: 'falsches Fahrzeug' } }),
      ServiceEntrySchema,
      201,
    );
    expect(voided.status).toBe('voided');
    expect(voided.revisionNo).toBe(3);
    const all = await h.db.select().from(serviceEntries).where(eq(serviceEntries.workItemId, original!.workItemId!));
    expect(all.map((e) => e.status).sort()).toEqual(['superseded', 'superseded', 'voided']);
    const due = expectOk(await call(h, 'GET', `/vehicles/${vehicleId}/maintenance-due`, { token: customer.token }), z.array(MaintenanceDueSchema));
    expect(due).toHaveLength(0);
    const audit = expectOk(await call(h, 'GET', '/audit', { token: w.admin.token, query: { action: 'service_entry.corrected' } }), z.array(AuditEntrySchema));
    expect(audit.filter((a) => a.data.vehicleId === vehicleId)).toHaveLength(2);
  });

  it('Freigabe für Dritte und QR zeigen die gültige Revision; stornierte Einträge nie', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Revisionsansicht');
    const { wo } = await workOrderWithFinishedMaintenance(h, w, customer.customerId!, vehicleId, 70000);
    expectOk(await complete(wo.id), WorkOrderDetailSchema);
    const [original] = await entriesOf(wo.id);
    const share = expectOk(
      await call(h, 'POST', `/vehicles/${vehicleId}/shares`, { token: customer.token, body: { label: 'Käufer', serviceEntryIds: [original!.id], expiresAt: iso(86_400_000) } }),
      VehicleShareSchema,
      201,
    );
    const token = share.shareUrl!.split('/').pop()!;
    const corrected = expectOk(
      await call(h, 'POST', `/service-entries/${original!.id}/corrections`, { token: w.admin.token, body: { odometerKm: 70500, reason: 'Ablesefehler' } }),
      ServiceEntrySchema,
      201,
    );
    let view = expectOk(await call(h, 'GET', `/public/shares/${token}`), PublicVehicleViewSchema);
    expect(view.entries.map((e) => e.odometerKm)).toEqual([70500]);
    expectOk(await call(h, 'PUT', `/vehicles/${vehicleId}/qr-public-view`, { token: customer.token, body: { enabled: true } }), VehicleDetailSchema);
    const [veh] = await h.db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
    let qr = expectOk(await call(h, 'GET', `/public/qr/${veh!.qrToken}`), QrResolutionSchema);
    expect(qr.mode === 'public' && qr.view.entries.map((e) => e.odometerKm)).toEqual([70500]);
    expectOk(await call(h, 'POST', `/service-entries/${corrected.id}/corrections`, { token: w.admin.token, body: { void: true, reason: 'doppelt' } }), ServiceEntrySchema, 201);
    view = expectOk(await call(h, 'GET', `/public/shares/${token}`), PublicVehicleViewSchema);
    expect(view.entries).toHaveLength(0);
    qr = expectOk(await call(h, 'GET', `/public/qr/${veh!.qrToken}`), QrResolutionSchema);
    expect(qr.mode === 'public' && qr.view.entries).toEqual([]);
    expect(JSON.stringify(qr)).not.toMatch(/EN-T|licensePlate|vin"\s*:\s*"[A-Z0-9]|workOrderId|Kunde/);
  });
});

describe('H06 Fälligkeiten', () => {
  const base: ServiceEntryRecord = {
    id: '00000000-0000-4000-8000-000000000001',
    vehicleId: '00000000-0000-4000-8000-000000000002',
    workOrderId: null,
    maintenanceTypeId: '00000000-0000-4000-8000-000000000003',
    maintenanceTypeName: 'Ölwechsel',
    performedOn: '2026-01-15',
    odometerKm: 50000,
    title: 'Ölwechsel',
    details: null,
    workshopName: 'Autowerkstatt Witten [TEST]',
    intervalKm: 15000,
    intervalMonths: 12,
    nextDueDate: '2027-01-15',
    nextDueKm: 65000,
    status: 'valid',
    revisionOfId: null,
    revisionNo: 1,
  };

  it('km-Grenze zuerst erreicht (erfasst): maßgeblich km', () => {
    const due = evaluateMaintenanceDue({ entry: base, odometerReadings: [{ valueKm: 65200, recordedAt: '2026-09-01T10:00:00Z' }], today: '2026-09-27' })!;
    expect(due.governingLimit).toBe('km');
    expect(due.basis).toBe('km_recorded');
    expect(due.state).toBe('overdue');
  });

  it('Datum zuerst erreicht: maßgeblich Datum, auch wenn km noch weit weg', () => {
    const due = evaluateMaintenanceDue({ entry: base, odometerReadings: [{ valueKm: 52000, recordedAt: '2027-01-10T10:00:00Z' }], today: '2027-01-20' })!;
    expect(due.governingLimit).toBe('date');
    expect(due.state).toBe('overdue');
  });

  it('kein km-Stand nach dem Eintrag und zu wenige Daten: keine km-Fälligkeit als sicher ausgegeben', () => {
    const due = evaluateMaintenanceDue({ entry: base, odometerReadings: [], today: '2026-03-01' })!;
    expect(due.basis).not.toBe('km_recorded');
    expect(due.estimatedCurrentKm).toBeNull();
    expect(due.explanation).toMatch(/nicht beurteilbar/);
  });

  it('Schätzung ist gekennzeichnet und erklärt', () => {
    const due = evaluateMaintenanceDue({
      entry: { ...base, nextDueDate: '2027-06-15', intervalMonths: 17 },
      odometerReadings: [{ valueKm: 40000, recordedAt: '2025-06-01T10:00:00Z' }],
      today: '2026-09-27',
    })!;
    expect(due.basis).toBe('km_estimated');
    expect(due.estimatedCurrentKm).not.toBeNull();
    expect(due.explanation).toMatch(/geschätzt/);
  });

  it('unplausibler km-Stand wird gespeichert, markiert und verfälscht die Fälligkeit nicht', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Unplausibel');
    const { wo } = await workOrderWithFinishedMaintenance(h, w, customer.customerId!, vehicleId, 90000);
    expectOk(await complete(wo.id), WorkOrderDetailSchema);
    const low = expectOk(await call(h, 'POST', `/vehicles/${vehicleId}/odometer`, { token: customer.token, body: { valueKm: 10 } }), OdometerReadingSchema, 201);
    expect(low.plausibility).toBe('lower_than_previous');
    const due = expectOk(await call(h, 'GET', `/vehicles/${vehicleId}/maintenance-due`, { token: customer.token }), z.array(MaintenanceDueSchema));
    const oil = due.find((d) => d.maintenanceTypeId === w.oilChangeTypeId)!;
    expect(oil.dueKm).toBe(105000);
    expect(oil.basis).not.toBe('km_recorded');
    const readings = expectOk(await call(h, 'GET', `/vehicles/${vehicleId}/odometer`, { token: customer.token }), z.array(OdometerReadingSchema));
    expect(readings.find((r) => r.id === low.id)).toBeDefined();
  });
});

describe('H07 Sichtbarkeit nach Halterwechsel', () => {
  it('Einträge ohne Auftragsbezug für den neuen Halter; auch Einzelabruf', async () => {
    const { customer: prev, vehicleId } = await customerWithVehicle(h, 'HistVorbesitz');
    const next = await customerWithVehicle(h, 'HistNeu');
    const { wo } = await workOrderWithFinishedMaintenance(h, w, prev.customerId!, vehicleId);
    expectOk(await complete(wo.id), WorkOrderDetailSchema);
    expectOk(
      await call(h, 'POST', `/vehicles/${vehicleId}/ownership-transfer`, { token: w.service.token, body: { newCustomerId: next.customer.customerId, effectiveAt: iso(-1000) } }),
      VehicleDetailSchema,
    );
    const list = expectOk(await call(h, 'GET', `/vehicles/${vehicleId}/service-entries`, { token: next.customer.token }), z.array(ServiceEntrySchema));
    expect(list).toHaveLength(1);
    expect(list[0]!.workOrderId).toBeNull();
    const single = expectOk(await call(h, 'GET', `/service-entries/${list[0]!.id}`, { token: next.customer.token }), ServiceEntrySchema);
    expect(single.workOrderId).toBeNull();
    expectStatus(await call(h, 'GET', `/service-entries/${list[0]!.id}`, { token: prev.token }), 404);
    const [row] = await h.db.select().from(serviceEntries).where(and(eq(serviceEntries.vehicleId, vehicleId)));
    expect(row!.workOrderId).toBe(wo.id);
  });
});
