/**
 * API-3 Mechaniker-Schnittstellen: zuweisbare Mitarbeiter, verbaute Teile und laufende Zeit je
 * Position (Feldfilter je Rolle), Zeitpunkt vom Gerät (`occurredAt`) für Start, Pause,
 * Abschluss und "nicht durchgeführt". Nur [TEST]-Daten.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  AssignableStaffSchema,
  OCCURRED_AT_MAX_FUTURE_MS,
  OCCURRED_AT_MAX_PAST_MS,
  WorkItemSchema,
  WorkOrderDetailSchema,
  type WorkItem,
} from '@werkstatt/contracts';
import { auditLog, odometerReadings, timeEntries, users } from '../src/db/schema/index';
import { call, createCustomer, createHarness, createStaff, createVehicle, expectOk, expectStatus, type Harness, type TestUser } from './support/harness';
import { createWorkOrder, customerWithVehicle, item, setupWorkshop, type Workshop } from './support/scenario';

let h: Harness;
let w: Workshop;
beforeAll(async () => {
  h = await createHarness();
  w = await setupWorkshop(h);
});
afterAll(async () => h?.close());

const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(h.clock.now().getTime() + offsetMs).toISOString();

async function orderWithItems(customer: TestUser, vehicleId: string, items = [item('Ölwechsel', { maintenanceTypeId: w.oilChangeTypeId }), item('Probefahrt')]) {
  return createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId, assigneeIds: [w.mechanic.id], items });
}

async function itemOf(token: string, workOrderId: string, itemId: string): Promise<WorkItem> {
  const detail = expectOk(await call(h, 'GET', `/work-orders/${workOrderId}`, { token }), WorkOrderDetailSchema);
  return detail.items.find((i) => i.id === itemId)!;
}

describe('Zuweisbare Mitarbeiter (GET /staff/assignable)', () => {
  it('Service: aktive und eingeladene Werkstattmitarbeiter, sortiert, ohne E-Mail und Rechte; Deaktivierte und Kunden fehlen', async () => {
    const invited = await createStaff(h, 'mechanic', { name: '[TEST] Ärger Eingeladen' });
    await h.db.update(users).set({ status: 'invited' }).where(eq(users.id, invited.id));
    const disabled = await createStaff(h, 'mechanic', { name: '[TEST] Deaktiviert' });
    await h.db.update(users).set({ status: 'disabled' }).where(eq(users.id, disabled.id));
    const customer = await createCustomer(h, 'Zuweisung');

    const res = await call(h, 'GET', '/staff/assignable', { token: w.service.token });
    const list = expectOk(res, z.array(AssignableStaffSchema));
    const ids = list.map((s) => s.userId);
    expect(ids).toEqual(expect.arrayContaining([w.admin.id, w.service.id, w.mechanic.id, invited.id]));
    expect(ids).not.toContain(disabled.id);
    expect(ids).not.toContain(customer.id);
    expect(list.find((s) => s.userId === w.mechanic.id)).toEqual({ userId: w.mechanic.id, displayName: '[TEST] mechanic', role: 'mechanic' });
    // Sortiert nach Anzeigename (deutsche Sortierung: "Ä" wie "A")
    const names = list.map((s) => s.displayName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'de')));
    expect(names.indexOf('[TEST] Ärger Eingeladen')).toBeLessThan(names.indexOf('[TEST] mechanic'));
    // Keine E-Mail-Adressen, keine Rechte, kein Status
    for (const raw of res.json() as Record<string, unknown>[]) expect(Object.keys(raw).sort()).toEqual(['displayName', 'role', 'userId']);
    expect(res.body).not.toContain('@beispiel.test');
  });

  it('Mechaniker: 403; Kunde: wie andere Mitarbeiterrouten (404); ohne Anmeldung 401', async () => {
    expectStatus(await call(h, 'GET', '/staff/assignable', { token: w.mechanic.token }), 403);
    const customer = await createCustomer(h, 'Zuweisung2');
    const own = await call(h, 'GET', '/staff/assignable', { token: customer.token });
    expectStatus(own, 404);
    expect((await call(h, 'GET', '/users', { token: customer.token })).statusCode).toBe(own.statusCode);
    expectStatus(await call(h, 'GET', '/staff/assignable'), 401);
  });

  it('workOrders.write oder appointments.write genügt; ohne beide 403', async () => {
    const onlyAppointments = await createStaff(h, 'service', { overrides: [{ permission: 'workOrders.write', granted: false }] });
    expectOk(await call(h, 'GET', '/staff/assignable', { token: onlyAppointments.token }), z.array(AssignableStaffSchema));
    const onlyOrders = await createStaff(h, 'service', { overrides: [{ permission: 'appointments.write', granted: false }] });
    expectOk(await call(h, 'GET', '/staff/assignable', { token: onlyOrders.token }), z.array(AssignableStaffSchema));
    const neither = await createStaff(h, 'service', {
      overrides: [
        { permission: 'workOrders.write', granted: false },
        { permission: 'appointments.write', granted: false },
      ],
    });
    expectStatus(await call(h, 'GET', '/staff/assignable', { token: neither.token }), 403);
  });
});

describe('Teile und laufende Zeit je Position', () => {
  it('Service sieht Teile mit Preis, Mechaniker ohne Preis, Kunde weder Teile noch laufende Zeit', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Teile');
    const wo = await orderWithItems(customer, vehicleId);
    const oil = wo.items[0]!;
    expect(oil.runningSince).toBeNull();
    expect(oil.parts).toEqual([]);

    const started = expectOk(await call(h, 'POST', `/work-items/${oil.id}/start`, { token: w.mechanic.token }), WorkItemSchema);
    const [entry] = await h.db.select().from(timeEntries).where(eq(timeEntries.workItemId, oil.id));
    expect(started.runningSince).toBe(entry!.startedAt.toISOString());
    expect(started.parts).toEqual([]);

    // Mechaniker erfasst ein Teil (ein mitgesendeter Preis wird nicht gespeichert), Inhaber eins mit Preis
    // (Service führt standardmäßig keine Positionen aus: workItems.execute nur zuweisbar)
    const mechPart = await call(h, 'POST', `/work-items/${oil.id}/parts`, {
      token: w.mechanic.token,
      body: { partNumber: 'OF-TEST-1', description: '[TEST] Ölfilter', quantity: 1, unitPriceCents: 999 },
    });
    const afterMech = expectOk(mechPart, WorkItemSchema, 201);
    expect(afterMech.parts).toHaveLength(1);
    expect(afterMech.parts![0]).not.toHaveProperty('unitPriceCents');
    expect(afterMech).not.toHaveProperty('unitPriceCents');
    h.clock.advance(1000);
    const afterService = expectOk(
      await call(h, 'POST', `/work-items/${oil.id}/parts`, { token: w.admin.token, body: { description: '[TEST] Motoröl 5W-30', quantity: 4.5, unitPriceCents: 1_490 } }),
      WorkItemSchema,
      201,
    );
    expect(afterService.parts?.map((p) => p.unitPriceCents)).toEqual([null, 1_490]);

    // Service: Auftrag mit Teilen (älteste zuerst) und Preisen
    const serviceView = await itemOf(w.service.token, wo.id, oil.id);
    expect(serviceView.runningSince).toBe(entry!.startedAt.toISOString());
    expect(serviceView.parts).toMatchObject([
      { partNumber: 'OF-TEST-1', description: '[TEST] Ölfilter', quantity: 1, unitPriceCents: null },
      { partNumber: null, description: '[TEST] Motoröl 5W-30', quantity: 4.5, unitPriceCents: 1_490 },
    ]);
    expect(Date.parse(serviceView.parts![0]!.recordedAt)).toBeLessThanOrEqual(Date.parse(serviceView.parts![1]!.recordedAt));

    // Mechaniker: Teile ohne Preis, laufende Zeit sichtbar
    const mechRes = await call(h, 'GET', `/work-orders/${wo.id}`, { token: w.mechanic.token });
    const mechView = expectOk(mechRes, WorkOrderDetailSchema).items.find((i) => i.id === oil.id)!;
    expect(mechView.runningSince).toBe(entry!.startedAt.toISOString());
    expect(mechView.parts?.map((p) => p.description)).toEqual(['[TEST] Ölfilter', '[TEST] Motoröl 5W-30']);
    for (const p of mechView.parts!) expect(p).not.toHaveProperty('unitPriceCents');
    expect(mechRes.body).not.toContain('1490');

    // Kunde: Positionen ohne laufende Zeit und ohne Teile
    const custRes = await call(h, 'GET', `/work-orders/${wo.id}`, { token: customer.token });
    const custView = expectOk(custRes, WorkOrderDetailSchema);
    for (const i of custView.items) {
      expect(i).not.toHaveProperty('runningSince');
      expect(i).not.toHaveProperty('parts');
    }
    expect(custRes.body).not.toContain('Ölfilter');
    expect(custRes.body).not.toContain('OF-TEST-1');

    // Pause: keine laufende Zeit mehr
    const paused = expectOk(await call(h, 'POST', `/work-items/${oil.id}/pause`, { token: w.mechanic.token }), WorkItemSchema);
    expect(paused.runningSince).toBeNull();
    expect(paused.parts).toHaveLength(2);
  });

  it('Kunde erreicht die Positionsrouten nicht (keine Teile über Umwege)', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'TeileUmweg');
    const wo = await orderWithItems(customer, vehicleId);
    const oil = wo.items[0]!;
    expectOk(await call(h, 'POST', `/work-items/${oil.id}/parts`, { token: w.mechanic.token, body: { description: '[TEST] Dichtring', quantity: 1 } }), WorkItemSchema, 201);
    for (const [path, body] of [
      [`/work-items/${oil.id}/parts`, { description: '[TEST] fremd', quantity: 1 }],
      [`/work-items/${oil.id}/start`, undefined],
      [`/work-items/${oil.id}/pause`, { occurredAt: iso(0) }],
    ] as const) {
      const res = await call(h, 'POST', path, { token: customer.token, body });
      expect([403, 404]).toContain(res.statusCode);
      expect(res.body).not.toContain('Dichtring');
    }
  });
});

describe('Zeitpunkt vom Gerät (occurredAt)', () => {
  it('Start vor 2 h, Abschluss vor 1 h: 60 erfasste Minuten, doneAt und km-Stand mit Gerätezeit, Audit mit occurredAt', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Geraetezeit');
    const wo = await orderWithItems(customer, vehicleId);
    const oil = wo.items[0]!;
    const startAt = iso(-2 * HOUR);
    const doneAt = iso(-1 * HOUR);

    const started = expectOk(await call(h, 'POST', `/work-items/${oil.id}/start`, { token: w.mechanic.token, body: { occurredAt: startAt } }), WorkItemSchema);
    expect(started.runningSince).toBe(startAt);
    expect(started.trackedMinutes).toBe(120);

    const finished = expectOk(
      await call(h, 'POST', `/work-items/${oil.id}/finish`, { token: w.mechanic.token, body: { occurredAt: doneAt, odometerKm: 72_345, resultNotes: '[TEST] offline erfasst' } }),
      WorkItemSchema,
    );
    expect(finished.trackedMinutes).toBe(60);
    expect(finished.doneAt).toBe(doneAt);
    expect(finished.runningSince).toBeNull();

    const entries = await h.db.select().from(timeEntries).where(eq(timeEntries.workItemId, oil.id));
    expect(entries.map((e) => [e.startedAt.toISOString(), e.endedAt?.toISOString()])).toEqual([[startAt, doneAt]]);

    const [reading] = await h.db.select().from(odometerReadings).where(and(eq(odometerReadings.vehicleId, vehicleId), eq(odometerReadings.valueKm, 72_345)));
    expect(reading!.recordedAt.toISOString()).toBe(doneAt);
    expect(reading!.source).toBe('work_completion');

    const audits = await h.db.select().from(auditLog).where(eq(auditLog.entityId, oil.id)).orderBy(asc(auditLog.id));
    expect(audits.find((a) => a.action === 'work_item.started')?.data).toMatchObject({ workOrderId: wo.id, occurredAt: startAt });
    expect(audits.find((a) => a.action === 'work_item.finished')?.data).toMatchObject({ workOrderId: wo.id, occurredAt: doneAt });

    // Service sieht dieselben Werte
    const serviceView = await itemOf(w.service.token, wo.id, oil.id);
    expect(serviceView).toMatchObject({ executionStatus: 'done', doneAt, doneOdometerKm: 72_345, trackedMinutes: 60 });
  });

  it('Pause und "nicht durchgeführt" mit Gerätezeit; ohne occurredAt bzw. mit leerem Körper gilt die Serverzeit ohne Audit-Zusatz', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Pause');
    const wo = await orderWithItems(customer, vehicleId);
    const [oil, test] = wo.items;
    expectOk(await call(h, 'POST', `/work-items/${test!.id}/start`, { token: w.mechanic.token, body: { occurredAt: iso(-90 * 60_000) } }), WorkItemSchema);
    const paused = expectOk(await call(h, 'POST', `/work-items/${test!.id}/pause`, { token: w.mechanic.token, body: { occurredAt: iso(-60 * 60_000) } }), WorkItemSchema);
    expect(paused.trackedMinutes).toBe(30);
    expectOk(await call(h, 'POST', `/work-items/${test!.id}/start`, { token: w.mechanic.token, body: { occurredAt: iso(-45 * 60_000) } }), WorkItemSchema);
    const notDone = expectOk(
      await call(h, 'POST', `/work-items/${test!.id}/not-done`, { token: w.mechanic.token, body: { reason: '[TEST] Kunde verzichtet', occurredAt: iso(-30 * 60_000) } }),
      WorkItemSchema,
    );
    expect(notDone).toMatchObject({ executionStatus: 'not_done', trackedMinutes: 45, runningSince: null });

    // Bestehende Clients: ohne Körper bzw. mit leerem Körper
    expectOk(await call(h, 'POST', `/work-items/${oil!.id}/start`, { token: w.mechanic.token }), WorkItemSchema);
    expectOk(await call(h, 'POST', `/work-items/${oil!.id}/pause`, { token: w.mechanic.token, body: {} }), WorkItemSchema);
    const audits = await h.db.select().from(auditLog).where(eq(auditLog.entityId, oil!.id));
    for (const a of audits.filter((x) => x.action === 'work_item.started' || x.action === 'work_item.paused')) expect(a.data).not.toHaveProperty('occurredAt');
  });

  it('mehr als 5 Minuten in der Zukunft oder mehr als 72 Stunden zurück: 422 invalid_occurred_at, nichts geändert', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Grenzen');
    const wo = await orderWithItems(customer, vehicleId);
    const oil = wo.items[0]!;
    const future = await call(h, 'POST', `/work-items/${oil.id}/start`, { token: w.mechanic.token, body: { occurredAt: iso(OCCURRED_AT_MAX_FUTURE_MS + 60_000) } });
    expectStatus(future, 422, 'invalid_occurred_at');
    expect(future.json().error.message).toContain('Zukunft');
    expect(future.json().error.details).toMatchObject({ reason: 'in_future' });
    const old = await call(h, 'POST', `/work-items/${oil.id}/start`, { token: w.mechanic.token, body: { occurredAt: iso(-OCCURRED_AT_MAX_PAST_MS - 60_000) } });
    expectStatus(old, 422, 'invalid_occurred_at');
    expect(old.json().error.message).toContain('72 Stunden');
    expect(await h.db.select().from(timeEntries).where(eq(timeEntries.workItemId, oil.id))).toHaveLength(0);
    expect((await itemOf(w.service.token, wo.id, oil.id)).executionStatus).toBe('planned');

    // Innerhalb der Grenzen (Geräteuhr 2 Minuten vor, 71 Stunden zurück) wird angenommen
    expectOk(await call(h, 'POST', `/work-items/${oil.id}/start`, { token: w.mechanic.token, body: { occurredAt: iso(-71 * HOUR) } }), WorkItemSchema);
    expectOk(await call(h, 'POST', `/work-items/${oil.id}/pause`, { token: w.mechanic.token, body: { occurredAt: iso(2 * 60_000) } }), WorkItemSchema);
    // Ungültiges Format: Schemaprüfung (400)
    expectStatus(await call(h, 'POST', `/work-items/${oil.id}/start`, { token: w.mechanic.token, body: { occurredAt: 'gestern' } }), 400);
  });

  it('vor dem letzten erfassten Zeitpunkt der Position: 422, Position bleibt unverändert', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Reihenfolge');
    const wo = await orderWithItems(customer, vehicleId);
    const oil = wo.items[0]!;
    expectOk(await call(h, 'POST', `/work-items/${oil.id}/start`, { token: w.mechanic.token, body: { occurredAt: iso(-2 * HOUR) } }), WorkItemSchema);
    const before = await call(h, 'POST', `/work-items/${oil.id}/pause`, { token: w.mechanic.token, body: { occurredAt: iso(-3 * HOUR) } });
    expectStatus(before, 422, 'invalid_occurred_at');
    expect(before.json().error.message).toContain('letzten Zeiterfassung');
    expect(before.json().error.details).toMatchObject({ reason: 'before_last_record' });
    const finishBefore = await call(h, 'POST', `/work-items/${oil.id}/finish`, { token: w.mechanic.token, body: { occurredAt: iso(-2 * HOUR - 1000), odometerKm: 10_000 } });
    expectStatus(finishBefore, 422, 'invalid_occurred_at');
    const still = await itemOf(w.service.token, wo.id, oil.id);
    expect(still).toMatchObject({ executionStatus: 'in_progress', doneAt: null });
    expect(await h.db.select().from(odometerReadings).where(and(eq(odometerReadings.vehicleId, vehicleId), eq(odometerReadings.valueKm, 10_000)))).toHaveLength(0);

    // Gleicher Zeitpunkt wie der letzte ist erlaubt; danach ist das Ende der neue letzte Zeitpunkt
    expectOk(await call(h, 'POST', `/work-items/${oil.id}/pause`, { token: w.mechanic.token, body: { occurredAt: iso(-1 * HOUR) } }), WorkItemSchema);
    expectStatus(await call(h, 'POST', `/work-items/${oil.id}/start`, { token: w.mechanic.token, body: { occurredAt: iso(-90 * 60_000) } }), 422, 'invalid_occurred_at');
  });

  it('Übergangsfehler haben Vorrang vor dem Zeitpunkt; Idempotenz unverändert', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Idempotenz');
    const wo = await orderWithItems(customer, vehicleId);
    const oil = wo.items[0]!;
    // Pause einer nicht laufenden Position: 409, auch wenn der Zeitpunkt ungültig wäre
    expectStatus(await call(h, 'POST', `/work-items/${oil.id}/pause`, { token: w.mechanic.token, body: { occurredAt: iso(-100 * HOUR) } }), 409, 'invalid_status');

    const key = 'geraetezeit-test-0001';
    const body = { occurredAt: iso(10 * 60_000) };
    const first = await call(h, 'POST', `/work-items/${oil.id}/start`, { token: w.mechanic.token, body, headers: { 'idempotency-key': key } });
    expectStatus(first, 422, 'invalid_occurred_at');
    // Gleicher Schlüssel, gleicher Inhalt: gespeicherte Antwort; anderer Inhalt: Schlüssel schon verwendet
    const replay = await call(h, 'POST', `/work-items/${oil.id}/start`, { token: w.mechanic.token, body, headers: { 'idempotency-key': key } });
    expectStatus(replay, 422, 'invalid_occurred_at');
    expect(replay.headers['idempotent-replay']).toBe('true');
    expectStatus(await call(h, 'POST', `/work-items/${oil.id}/start`, { token: w.mechanic.token, body: {}, headers: { 'idempotency-key': key } }), 422, 'idempotency_key_reused');
    // Neuer Schlüssel ohne Gerätezeit (so sendet die Warteschlange "ohne Gerätezeit" erneut)
    const ok = expectOk(await call(h, 'POST', `/work-items/${oil.id}/start`, { token: w.mechanic.token, body: {}, headers: { 'idempotency-key': `${key}.1` } }), WorkItemSchema);
    expect(ok.executionStatus).toBe('in_progress');
    const again = await call(h, 'POST', `/work-items/${oil.id}/start`, { token: w.mechanic.token, body: {}, headers: { 'idempotency-key': `${key}.1` } });
    expect(again.statusCode).toBe(200);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(await h.db.select().from(timeEntries).where(eq(timeEntries.workItemId, oil.id))).toHaveLength(1);
  });
});

describe('Fahrzeug eines anderen Kunden', () => {
  it('fremder Kunde sieht den Auftrag nicht (Teile bleiben verborgen)', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Eigen');
    const other = await createCustomer(h, 'Fremd');
    await createVehicle(h, other.customerId!);
    const wo = await orderWithItems(customer, vehicleId);
    expectOk(await call(h, 'POST', `/work-items/${wo.items[0]!.id}/parts`, { token: w.mechanic.token, body: { description: '[TEST] Zündkerze', quantity: 4 } }), WorkItemSchema, 201);
    const res = await call(h, 'GET', `/work-orders/${wo.id}`, { token: other.token });
    expectStatus(res, 404);
    expect(res.body).not.toContain('Zündkerze');
  });
});
