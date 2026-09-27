/**
 * Review (Claude-Unteragent, 27.09.2026): Angriffsszenarien Rechte und Objektregeln (C-01).
 * Jeder Test prüft das SOLL-Verhalten. `it.fails` markiert bestätigte, noch offene Befunde
 * (siehe docs/uebergaben/2026-09-27-review-claude.md); wird der Befund behoben, schlägt der
 * Test fehl und muss auf `it` umgestellt werden.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  AppointmentSchema,
  AuditEntrySchema,
  CustomerDetailSchema,
  DocumentSchema,
  FileRefSchema,
  InvoiceSchema,
  OdometerReadingSchema,
  PageSchema,
  PhotoSchema,
  QrResolutionSchema,
  ServiceEntrySchema,
  StaffUserSchema,
  VehicleDetailSchema,
  VehicleShareSchema,
  VehicleSummarySchema,
  WorkOrderDetailSchema,
  WorkOrderSummarySchema,
  safeNextPath,
} from '@werkstatt/contracts';
import { effectivePermissions } from '@werkstatt/domain';
import { sessions, userPermissionOverrides, users, vehicles } from '../src/db/schema/index';
import { SAMPLE_PDF, SAMPLE_PNG, TEST_PASSWORD, call, createCustomer, createHarness, createStaff, createVehicle, expectOk, expectStatus, uploadFile, type Harness } from './support/harness';
import {
  createAndSendApproval,
  createWorkOrder,
  customerWithVehicle,
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

/** Kunde mit vollständiger Akte: Auftrag (abgeschlossen), Freigabe, Nachricht, Foto, Dokument, Rechnung, Termin, Serviceeintrag, Freigabe für Dritte. */
async function seedFullCustomer(lastName: string) {
  const { customer, vehicleId } = await customerWithVehicle(h, lastName);
  const { wo } = await workOrderWithFinishedMaintenance(h, w, customer.customerId!, vehicleId, 42000);
  expectOk(await call(h, 'POST', `/work-orders/${wo.id}/complete-review`, { token: w.service.token, body: { confirm: true } }), WorkOrderDetailSchema);
  expectOk(
    await call(h, 'PUT', `/work-orders/${wo.id}/intake`, {
      token: w.service.token,
      body: { odometerKm: 41990, customerComplaint: 'Geräusch vorne', agreedServices: 'Ölwechsel', notesInternal: '[TEST] intern' },
    }),
    z.any(),
  );
  const openWo = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId, items: [item('Diagnose')] });
  const approval = await createAndSendApproval(h, w.service.token, openWo.id, [line('Bremsscheiben', 25000)]);
  await call(h, 'POST', `/work-orders/${openWo.id}/messages`, { token: customer.token, body: { clientMessageId: `msg-${lastName}-0001`, body: 'Frage' } });
  const png = expectOk(await uploadFile(h, w.service.token, 'foto.png', 'image/png', SAMPLE_PNG), FileRefSchema, 201);
  const photo = expectOk(await call(h, 'POST', `/work-orders/${openWo.id}/photos`, { token: w.service.token, body: { fileId: png.id, context: 'work' } }), PhotoSchema, 201);
  expectOk(await call(h, 'PUT', `/photos/${photo.id}/visibility`, { token: w.service.token, body: { visibility: 'customer' } }), PhotoSchema);
  const pdf = expectOk(await uploadFile(h, w.service.token, 'bericht.pdf', 'application/pdf', SAMPLE_PDF), FileRefSchema, 201);
  const doc = expectOk(await call(h, 'POST', '/documents', { token: w.service.token, body: { kind: 'report', title: 'Bericht', fileId: pdf.id, workOrderId: openWo.id } }), DocumentSchema, 201);
  expectOk(await call(h, 'POST', `/documents/${doc.id}/publish`, { token: w.service.token }), DocumentSchema);
  const invoice = await issueInvoice(h, w.service.token, { customerId: customer.customerId!, workOrderId: wo.id, totalGrossCents: 18900, withPdf: true });
  const appointment = expectOk(
    await call(h, 'POST', '/appointments', {
      token: w.service.token,
      body: { kind: 'service', customerId: customer.customerId, vehicleId, startsAt: iso(86_400_000), endsAt: iso(90_000_000), assigneeIds: [], overrideConflictsReason: '[TEST]' },
    }),
    AppointmentSchema,
    201,
  );
  const [entry] = expectOk(await call(h, 'GET', `/vehicles/${vehicleId}/service-entries`, { token: customer.token }), z.array(ServiceEntrySchema));
  const share = expectOk(
    await call(h, 'POST', `/vehicles/${vehicleId}/shares`, { token: customer.token, body: { label: 'Käufer', serviceEntryIds: [entry!.id], expiresAt: iso(7 * 86_400_000) } }),
    VehicleShareSchema,
    201,
  );
  return { customer, vehicleId, wo, openWo, approval, photo, doc, invoice, appointment, entry: entry!, share };
}

describe('R01 IDOR: Kunde A auf Objekte von Kunde B (alle Routen mit ID)', () => {
  it('liefert überall 404 wie bei nicht vorhandener ID, ohne Daten und ohne Wirkung', async () => {
    const a = await seedFullCustomer('Angreifer');
    const b = await seedFullCustomer('Opfer');
    const t = a.customer.token;
    const reads: string[] = [
      `/work-orders/${b.wo.id}`,
      `/work-orders/${b.wo.id}/intake`,
      `/work-orders/${b.openWo.id}/approvals`,
      `/work-orders/${b.openWo.id}/messages`,
      `/work-orders/${b.openWo.id}/photos`,
      `/work-orders/${b.openWo.id}/internal-notes`,
      `/work-orders/${b.openWo.id}/findings`,
      `/work-orders/${b.openWo.id}/timeline`,
      `/approvals/${b.approval.id}`,
      `/photos/${b.photo.id}/content`,
      `/documents/${b.doc.id}/download`,
      `/invoices/${b.invoice.id}`,
      `/appointments/${b.appointment.id}`,
      `/vehicles/${b.vehicleId}`,
      `/vehicles/${b.vehicleId}/odometer`,
      `/vehicles/${b.vehicleId}/service-entries`,
      `/vehicles/${b.vehicleId}/maintenance-due`,
      `/vehicles/${b.vehicleId}/shares`,
      `/vehicles/${b.vehicleId}/qr/sticker.svg`,
      `/customers/${b.customer.customerId}`,
      `/customers/${b.customer.customerId}/export`,
      `/service-entries/${b.entry.id}`,
    ];
    for (const path of reads) {
      const res = await call(h, 'GET', path, { token: t });
      expect(res.statusCode, path).toBe(404);
      const missing = await call(h, 'GET', path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, randomUUID()), { token: t });
      expect(missing.statusCode, `${path} (unbekannt)`).toBe(404);
      expect(res.json().error.code, path).toBe(missing.json().error.code);
      expect(res.body, path).not.toContain(b.customer.customerId!);
    }
    const writes: Array<[string, string, unknown]> = [
      ['POST', `/work-orders/${b.openWo.id}/messages`, { clientMessageId: 'idor-000001', body: 'x' }],
      ['POST', `/work-orders/${b.openWo.id}/messages/read`, undefined],
      ['POST', `/approvals/${b.approval.id}/decision`, { versionId: b.approval.currentVersion.id, contentHash: b.approval.currentVersion.contentHash, decision: 'approved', channel: 'web' }],
      ['POST', `/invoices/${b.invoice.id}/checkout`, undefined],
      ['POST', `/invoices/${b.invoice.id}/payment-status/refresh`, undefined],
      ['POST', `/work-orders/${b.wo.id}/intake/confirm`, { method: 'app', contentHash: '0'.repeat(64) }],
      ['POST', `/appointments/${b.appointment.id}/cancel`, { reason: 'weg damit' }],
      ['POST', `/vehicles/${b.vehicleId}/odometer`, { valueKm: 1 }],
      ['POST', `/vehicles/${b.vehicleId}/shares`, { label: 'x', serviceEntryIds: [b.entry.id], expiresAt: iso(86_400_000) }],
      ['PUT', `/vehicles/${b.vehicleId}/qr-public-view`, { enabled: true }],
      ['POST', `/shares/${b.share.id}/revoke`, undefined],
    ];
    for (const [method, path, body] of writes) {
      const res = await call(h, method as 'POST', path, { token: t, body });
      expect(res.statusCode, `${method} ${path}`).toBe(404);
    }
    // keine Wirkung: Freigabe weiter offen, Termin nicht storniert, Freigabe-Link nicht widerrufen
    const approval = await call(h, 'GET', `/approvals/${b.approval.id}`, { token: b.customer.token });
    expect(approval.json().status).toBe('pending_customer');
    const appt = expectOk(await call(h, 'GET', `/appointments/${b.appointment.id}`, { token: b.customer.token }), AppointmentSchema);
    expect(appt.status).toBe('confirmed');
    const shares = expectOk(await call(h, 'GET', `/vehicles/${b.vehicleId}/shares`, { token: b.customer.token }), z.array(VehicleShareSchema));
    expect(shares[0]!.revokedAt).toBeNull();
  });
});

describe('R02 Listen mit fremden Filtern', () => {
  it('Filter ?customerId= und ?vehicleId= auf fremde Kunden liefern nichts Fremdes', async () => {
    const a = await customerWithVehicle(h, 'ListeA');
    const b = await customerWithVehicle(h, 'ListeB');
    const woB = await createWorkOrder(h, w.service.token, { customerId: b.customer.customerId!, vehicleId: b.vehicleId });
    await issueInvoice(h, w.service.token, { customerId: b.customer.customerId!, workOrderId: woB.id, totalGrossCents: 1000, withPdf: true });
    const q = { customerId: b.customer.customerId!, vehicleId: b.vehicleId };
    const wos = expectOk(await call(h, 'GET', '/work-orders', { token: a.customer.token, query: q }), PageSchema(WorkOrderSummarySchema));
    expect(wos.items).toHaveLength(0);
    const vs = expectOk(await call(h, 'GET', '/vehicles', { token: a.customer.token, query: { customerId: b.customer.customerId! } }), PageSchema(VehicleSummarySchema));
    expect(vs.items.map((v) => v.id)).toEqual([a.vehicleId]);
    const inv = expectOk(await call(h, 'GET', '/invoices', { token: a.customer.token, query: { customerId: b.customer.customerId! } }), z.array(InvoiceSchema));
    expect(inv).toHaveLength(0);
    const docs = expectOk(await call(h, 'GET', '/documents', { token: a.customer.token, query: { customerId: b.customer.customerId!, workOrderId: woB.id } }), z.array(DocumentSchema));
    expect(docs).toHaveLength(0);
    const cust = await call(h, 'GET', '/customers', { token: a.customer.token, query: { q: 'ListeB' } });
    expectStatus(cust, 200);
    expect(cust.json().items).toHaveLength(0);
  });
});

describe('R03 IDOR in Anfragekörpern', () => {
  it('Terminanfrage mit fremder vehicleId: 404, kein Termin', async () => {
    const a = await customerWithVehicle(h, 'TerminA');
    const b = await customerWithVehicle(h, 'TerminB');
    const res = await call(h, 'POST', '/appointments/requests', {
      token: a.customer.token,
      body: { kind: 'service', vehicleId: b.vehicleId, preferredStart: iso(86_400_000), preferredEnd: iso(90_000_000) },
    });
    expectStatus(res, 404);
    const list = expectOk(await call(h, 'GET', '/appointments', { token: w.service.token }), z.array(AppointmentSchema));
    expect(list.filter((x) => x.vehicleId === b.vehicleId)).toHaveLength(0);
  });

  it('Freigabe für Dritte mit Serviceeintrag eines anderen Fahrzeugs: 422', async () => {
    const a = await customerWithVehicle(h, 'ShareA');
    const b = await customerWithVehicle(h, 'ShareB');
    const { wo } = await workOrderWithFinishedMaintenance(h, w, b.customer.customerId!, b.vehicleId);
    expectOk(await call(h, 'POST', `/work-orders/${wo.id}/complete-review`, { token: w.service.token, body: { confirm: true } }), WorkOrderDetailSchema);
    const [entryB] = expectOk(await call(h, 'GET', `/vehicles/${b.vehicleId}/service-entries`, { token: b.customer.token }), z.array(ServiceEntrySchema));
    const res = await call(h, 'POST', `/vehicles/${a.vehicleId}/shares`, {
      token: a.customer.token,
      body: { label: 'Trick', serviceEntryIds: [entryB!.id], expiresAt: iso(86_400_000) },
    });
    expectStatus(res, 422, 'invalid_entries');
  });

  it('Rechnung zu Auftrag eines anderen Kunden: 422', async () => {
    const a = await customerWithVehicle(h, 'RechA');
    const b = await customerWithVehicle(h, 'RechB');
    const woB = await createWorkOrder(h, w.service.token, { customerId: b.customer.customerId!, vehicleId: b.vehicleId });
    const res = await call(h, 'POST', '/invoices', { token: w.service.token, body: { customerId: a.customer.customerId, workOrderId: woB.id, totalGrossCents: 100 } });
    expectStatus(res, 422, 'work_order_mismatch');
  });
});

describe('R04 Halterwechsel: Vorbesitzer', () => {
  it('verliert Fahrzeug, Historie, QR-Direktzugang und Terminanfragen; behält eigene Aufträge', async () => {
    const { customer: prev, vehicleId } = await customerWithVehicle(h, 'Vorbesitz');
    const next = await createCustomer(h, 'Neuhalter');
    const wo = await createWorkOrder(h, w.service.token, { customerId: prev.customerId!, vehicleId });
    const [veh] = await h.db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
    expectOk(
      await call(h, 'POST', `/vehicles/${vehicleId}/ownership-transfer`, { token: w.service.token, body: { newCustomerId: next.customerId, effectiveAt: iso(-1000) } }),
      VehicleDetailSchema,
    );
    const newWo = await createWorkOrder(h, w.service.token, { customerId: next.customerId!, vehicleId });
    for (const path of [`/vehicles/${vehicleId}`, `/vehicles/${vehicleId}/service-entries`, `/vehicles/${vehicleId}/odometer`, `/vehicles/${vehicleId}/maintenance-due`, `/work-orders/${newWo.id}`]) {
      expectStatus(await call(h, 'GET', path, { token: prev.token }), 404);
    }
    expectStatus(
      await call(h, 'POST', '/appointments/requests', {
        token: prev.token,
        body: { kind: 'service', vehicleId, preferredStart: iso(86_400_000), preferredEnd: iso(90_000_000) },
      }),
      404,
    );
    const qr = expectOk(await call(h, 'GET', `/public/qr/${veh!.qrToken}`, { token: prev.token }), QrResolutionSchema);
    expect(qr.mode).not.toBe('authorized');
    expectOk(await call(h, 'GET', `/work-orders/${wo.id}`, { token: prev.token }), WorkOrderDetailSchema);
  });
});

describe('R05 Halterwechsel: neuer Halter sieht keine Auftragsbezüge des Vorbesitzers', () => {
  it('km-Historie enthält keine Auftrags-IDs des Vorbesitzers', async () => {
    const { customer: prev, vehicleId } = await customerWithVehicle(h, 'KmVorbesitz');
    const next = await createCustomer(h, 'KmNeu');
    const { wo } = await workOrderWithFinishedMaintenance(h, w, prev.customerId!, vehicleId, 61000);
    expectOk(
      await call(h, 'POST', `/vehicles/${vehicleId}/ownership-transfer`, { token: w.service.token, body: { newCustomerId: next.customerId, effectiveAt: iso(-1000) } }),
      VehicleDetailSchema,
    );
    const readings = expectOk(await call(h, 'GET', `/vehicles/${vehicleId}/odometer`, { token: next.token }), z.array(OdometerReadingSchema));
    expect(readings.length).toBeGreaterThan(0);
    expect(readings.map((r) => r.workOrderId)).not.toContain(wo.id);
    // Mitarbeiter sehen den Bezug weiterhin
    const staff = expectOk(await call(h, 'GET', `/vehicles/${vehicleId}/odometer`, { token: w.service.token }), z.array(OdometerReadingSchema));
    expect(staff.map((r) => r.workOrderId)).toContain(wo.id);
  });
});

describe('R06 Mechaniker', () => {
  it('nicht zugewiesen: 403; zugewiesen: keine Preise, keine Kostenrahmen, keine Rechnungen, keine Freigabeanfragen, keine Kundenakte', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Mechsicht');
    const other = await createStaff(h, 'mechanic');
    const wo = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId, assigneeIds: [w.mechanic.id], items: [item('Inspektion', { unitPriceCents: 12345 })] });
    await call(h, 'PATCH', `/work-orders/${wo.id}`, { token: w.service.token, body: { costLimitCents: 50000 } });
    await call(h, 'PUT', `/work-orders/${wo.id}/intake`, { token: w.service.token, body: { odometerKm: 1000, customerComplaint: 'x', agreedServices: 'y', costLimitCents: 40000 } });
    const inv = await issueInvoice(h, w.service.token, { customerId: customer.customerId!, workOrderId: wo.id, totalGrossCents: 14690 });
    await createAndSendApproval(h, w.service.token, wo.id, [line('Zusatz', 9900)]);

    const PRICE_FIELDS = /unitPriceCents|costLimitCents|totalGrossCents|totalNetCents|amountCents|paidCents|openCents/;
    expectStatus(await call(h, 'GET', `/work-orders/${wo.id}`, { token: other.token }), 403);
    const detail = await call(h, 'GET', `/work-orders/${wo.id}`, { token: w.mechanic.token });
    expectStatus(detail, 200);
    expect(detail.body).not.toMatch(PRICE_FIELDS);
    expect(detail.json().items.length).toBeGreaterThanOrEqual(2);
    const intake = await call(h, 'GET', `/work-orders/${wo.id}/intake`, { token: w.mechanic.token });
    expectStatus(intake, 200);
    expect(intake.body).not.toMatch(PRICE_FIELDS);
    expect(intake.json().notesInternal === undefined).toBe(false);
    expectStatus(await call(h, 'GET', `/invoices/${inv.id}`, { token: w.mechanic.token }), 403);
    expectStatus(await call(h, 'GET', '/invoices', { token: w.mechanic.token }), 403);
    expectStatus(await call(h, 'GET', `/work-orders/${wo.id}/approvals`, { token: w.mechanic.token }), 403);
    expectStatus(await call(h, 'GET', `/customers/${customer.customerId}`, { token: w.mechanic.token }), 403);
    const list = await call(h, 'GET', '/work-orders', { token: w.mechanic.token });
    expect(list.body).not.toMatch(PRICE_FIELDS);
    expect(list.body).not.toMatch(/"email"|"phone"|"mobile"/);
    const timeline = await call(h, 'GET', `/work-orders/${wo.id}/timeline`, { token: w.mechanic.token });
    expectStatus(timeline, 200);
    expect(timeline.body).not.toMatch(PRICE_FIELDS);
    expect(timeline.body).not.toMatch(/146,90|99,00|146\.90/);
  });

  it('kann zurückgezogene Positionen nicht starten und nicht über den Kunden entscheiden', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Mechzurueck');
    const wo = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId, assigneeIds: [w.mechanic.id] });
    const approval = await createAndSendApproval(h, w.service.token, wo.id, [line('Zurückgezogen', 5000)]);
    const decide = await call(h, 'POST', `/approvals/${approval.id}/decision`, {
      token: w.mechanic.token,
      body: { versionId: approval.currentVersion.id, contentHash: approval.currentVersion.contentHash, decision: 'approved', channel: 'web' },
    });
    expectStatus(decide, 403);
    for (const staff of [w.admin, w.service]) {
      const res = await call(h, 'POST', `/approvals/${approval.id}/decision`, {
        token: staff.token,
        body: { versionId: approval.currentVersion.id, contentHash: approval.currentVersion.contentHash, decision: 'approved', channel: 'web' },
      });
      expectStatus(res, 403, 'not_customer');
    }
    expectOk(await call(h, 'POST', `/approvals/${approval.id}/withdraw`, { token: w.service.token }), z.any());
    const detail = expectOk(await call(h, 'GET', `/work-orders/${wo.id}`, { token: w.service.token }), WorkOrderDetailSchema);
    const withdrawn = detail.items.find((i) => i.approvalRequestId === approval.id)!;
    expect(withdrawn.authorization).toBe('withdrawn');
    for (const actor of [w.mechanic, w.admin]) {
      expectStatus(await call(h, 'POST', `/work-items/${withdrawn.id}/start`, { token: actor.token }), 403);
    }
  });
});

describe('R07 fehlende Einzelrechte', () => {
  it('Service ohne payments.recordManual und serviceHistory.correct: 403; Kunde: 404', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'Einzelrecht');
    const inv = await issueInvoice(h, w.service.token, { customerId: customer.customerId!, totalGrossCents: 5000 });
    const body = { method: 'bank_transfer', amountCents: 5000, receivedAt: iso(-60_000), referenceText: 'Kontoauszug 1' };
    expectStatus(await call(h, 'POST', `/invoices/${inv.id}/payments/manual`, { token: w.service.token, body }), 403);
    expectStatus(await call(h, 'POST', `/invoices/${inv.id}/payments/manual`, { token: customer.token, body }), 404);
    const { wo } = await workOrderWithFinishedMaintenance(h, w, customer.customerId!, vehicleId);
    expectOk(await call(h, 'POST', `/work-orders/${wo.id}/complete-review`, { token: w.service.token, body: { confirm: true } }), WorkOrderDetailSchema);
    const [entry] = expectOk(await call(h, 'GET', `/vehicles/${vehicleId}/service-entries`, { token: w.service.token }), z.array(ServiceEntrySchema));
    const corr = { title: 'geändert', reason: 'Tippfehler' };
    expectStatus(await call(h, 'POST', `/service-entries/${entry!.id}/corrections`, { token: w.service.token, body: corr }), 403);
    expectStatus(await call(h, 'POST', `/service-entries/${entry!.id}/corrections`, { token: customer.token, body: corr }), 404);
    expectStatus(await call(h, 'POST', `/service-entries/${entry!.id}/corrections`, { token: w.mechanic.token, body: corr }), 403);
  });

  it('Kunde erreicht keine Mitarbeiter-Endpunkte', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'KeinStaff');
    const checks: Array<[string, string, unknown]> = [
      ['POST', '/work-orders', { customerId: customer.customerId, vehicleId, title: 'x' }],
      ['POST', '/invoices', { customerId: customer.customerId, totalGrossCents: 1 }],
      ['GET', '/users', undefined],
      ['GET', '/audit', undefined],
      ['GET', '/settings/workshop', undefined],
      ['GET', '/exports/invoices.csv', undefined],
      ['GET', '/maintenance-due', undefined],
      ['POST', `/vehicles/${vehicleId}/ownership-transfer`, { newCustomerId: customer.customerId, effectiveAt: iso(-1000) }],
      ['POST', `/vehicles/${vehicleId}/qr/rotate`, undefined],
    ];
    for (const [method, path, body] of checks) {
      const res = await call(h, method as 'GET', path, { token: customer.token, body });
      expect([403, 404], `${method} ${path}`).toContain(res.statusCode);
    }
  });
});

describe('R08 letzter aktiver Admin', () => {
  /** Anzahl aktiver Konten mit wirksamem users.manage */
  async function managers(h2: Harness): Promise<number> {
    const rows = await h2.db.select().from(users).where(eq(users.status, 'active'));
    let n = 0;
    for (const u of rows) {
      const overrides = await h2.db.select().from(userPermissionOverrides).where(eq(userPermissionOverrides.userId, u.id));
      if (effectivePermissions(u.role, overrides).has('users.manage')) n += 1;
    }
    return n;
  }

  // Race: mehrere Runden, jeweils frische Datenbank mit genau zwei Admins
  for (const variant of ['gegenseitig deaktivieren', 'Rollenwechsel und Rechteentzug'] as const) {
    it(`zwei Admins gleichzeitig (${variant}): mindestens ein aktiver Admin mit users.manage bleibt`, async () => {
      for (let round = 0; round < 3; round++) {
        const h2 = await createHarness();
        try {
          const a1 = await createStaff(h2, 'admin');
          const a2 = await createStaff(h2, 'admin');
          const results =
            variant === 'gegenseitig deaktivieren'
              ? await Promise.all([
                  call(h2, 'POST', `/users/${a2.id}/disable`, { token: a1.token }),
                  call(h2, 'POST', `/users/${a1.id}/disable`, { token: a2.token }),
                ])
              : await Promise.all([
                  call(h2, 'PATCH', `/users/${a2.id}`, { token: a1.token, body: { role: 'service' } }),
                  call(h2, 'PATCH', `/users/${a1.id}`, { token: a2.token, body: { permissionOverrides: [{ permission: 'users.manage', granted: false }] } }),
                ]);
          expect(await managers(h2), `Runde ${round}: ${results.map((r) => r.statusCode).join(',')}`).toBeGreaterThanOrEqual(1);
        } finally {
          await h2.close();
        }
      }
    });
  }
});

describe('R09 Konten und Sitzungen', () => {
  it('gesperrtes Kundenkonto: Sitzung sofort ungültig, keine Anmeldung; eingeladenes Konto: keine Anmeldung', async () => {
    const customer = await createCustomer(h, 'Gesperrt');
    expectStatus(await call(h, 'GET', '/auth/me', { token: customer.token }), 200);
    expectOk(await call(h, 'POST', `/customers/${customer.customerId}/account/disable`, { token: w.service.token }), CustomerDetailSchema);
    expectStatus(await call(h, 'GET', '/work-orders', { token: customer.token }), 401);
    expectStatus(await call(h, 'POST', '/auth/login', { body: { email: customer.email, password: TEST_PASSWORD } }), 403, 'account_disabled');

    const invitedRecord = await createCustomer(h, 'Eingeladen');
    await h.db.update(users).set({ status: 'invited' }).where(eq(users.id, invitedRecord.id));
    expectStatus(await call(h, 'GET', '/auth/me', { token: invitedRecord.token }), 401);
    expectStatus(await call(h, 'POST', '/auth/login', { body: { email: invitedRecord.email, password: TEST_PASSWORD } }), 401, 'invalid_credentials');
  });

  it('abgelaufene Sitzung: 401', async () => {
    const customer = await createCustomer(h, 'Abgelaufen');
    await h.db.update(sessions).set({ expiresAt: new Date(h.clock.now().getTime() - 1000) }).where(eq(sessions.userId, customer.id));
    expectStatus(await call(h, 'GET', '/auth/me', { token: customer.token }), 401);
  });

  it.fails('Anmeldung verrät nicht über die Sperre, ob eine E-Mail-Adresse existiert (BEFUND, offen)', async () => {
    const known = await createCustomer(h, 'Enumeration');
    const unknown = `niemand.${randomUUID()}@beispiel.test`;
    let lastKnown = 0;
    let lastUnknown = 0;
    for (let i = 0; i < 6; i++) {
      lastKnown = (await call(h, 'POST', '/auth/login', { body: { email: known.email, password: 'falsch-falsch-1' } })).statusCode;
      lastUnknown = (await call(h, 'POST', '/auth/login', { body: { email: unknown, password: 'falsch-falsch-1' } })).statusCode;
    }
    expect(lastKnown).toBe(lastUnknown);
  });
});

describe('R10 Audit für Rechte- und Kontenaktionen', () => {
  it('Rechteänderung, Deaktivierung, Halterwechsel und Anmeldungen stehen im Protokoll', async () => {
    const mech = await createStaff(h, 'mechanic');
    expectOk(await call(h, 'PATCH', `/users/${mech.id}`, { token: w.admin.token, body: { permissionOverrides: [{ permission: 'customers.read', granted: true }] } }), StaffUserSchema);
    expectOk(await call(h, 'POST', `/users/${mech.id}/disable`, { token: w.admin.token }), StaffUserSchema);
    const { vehicleId } = await customerWithVehicle(h, 'AuditHalter');
    const next = await createCustomer(h, 'AuditNeu');
    expectOk(await call(h, 'POST', `/vehicles/${vehicleId}/ownership-transfer`, { token: w.service.token, body: { newCustomerId: next.customerId, effectiveAt: iso(-1000) } }), VehicleDetailSchema);
    const has = async (action: string, entityId: string) => {
      const rows = expectOk(await call(h, 'GET', '/audit', { token: w.admin.token, query: { action, entityId } }), z.array(AuditEntrySchema));
      return rows.length > 0;
    };
    expect(await has('user.permissions_changed', mech.id)).toBe(true);
    expect(await has('user.disabled', mech.id)).toBe(true);
    expect(await has('vehicle.ownership_transferred', vehicleId)).toBe(true);
    expect(await has('auth.login_succeeded', mech.id)).toBe(true);
  });
});

describe('R11 Datenexport (Selbstauskunft)', () => {
  it('enthält keine IP-Adressen und Browserkennungen von Mitarbeitern', async () => {
    const customer = await createCustomer(h, 'ExportIp');
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/customers/${customer.customerId}`,
      headers: { authorization: `Bearer ${w.service.token}`, 'user-agent': 'Werkstatt-PC-Buero-Chrome/123', 'x-forwarded-for': '10.1.2.3' },
      payload: { phone: '+49 2302 000000' },
    });
    expect(res.statusCode).toBe(200);
    const exp = await h.app.inject({ method: 'GET', url: '/api/v1/me/export', headers: { authorization: `Bearer ${customer.token}` } });
    expect(exp.statusCode).toBe(200);
    const files = unzipSync(new Uint8Array(exp.rawPayload));
    const json = strFromU8(files['daten.json']!);
    const data = JSON.parse(json) as { activityLog: Array<Record<string, unknown>> };
    const staffEntries = data.activityLog.filter((e) => e.actorUserId !== customer.id);
    expect(staffEntries.length).toBeGreaterThan(0);
    expect(json).not.toContain('Werkstatt-PC-Buero-Chrome');
    for (const e of staffEntries) {
      expect(e.ip ?? null).toBeNull();
      expect(e.userAgent ?? null).toBeNull();
    }
  });
});

describe('R11b Datenexport (Selbstauskunft) ohne interne Mitarbeitertexte', () => {
  it('Zahlungsnotiz, Erstattungsgrund, Konflikt-Begründung und Halterwechsel-Notiz nur im vollständigen Export', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'ExportIntern');
    const prevOwner = await customerWithVehicle(h, 'ExportVorbesitz');
    // Fahrzeug des Vorbesitzers geht an den Kunden, Notiz nennt den Vorbesitzer
    expectOk(
      await call(h, 'POST', `/vehicles/${prevOwner.vehicleId}/ownership-transfer`, {
        token: w.service.token,
        body: { newCustomerId: customer.customerId, effectiveAt: iso(-1000), note: '[TEST] INTERN-HALTER Verkauf durch Herrn Vorbesitz' },
      }),
      VehicleDetailSchema,
    );
    const invoice = await issueInvoice(h, w.service.token, { customerId: customer.customerId!, totalGrossCents: 5000 });
    const paid = expectOk(
      await call(h, 'POST', `/invoices/${invoice.id}/payments/manual`, {
        token: w.admin.token,
        body: { method: 'cash', amountCents: 5000, receivedAt: iso(-60_000), referenceText: 'Beleg 9', note: '[TEST] INTERN-ZAHLUNG zahlt nur nach Mahnung' },
      }),
      InvoiceSchema,
    );
    expectOk(
      await call(h, 'POST', `/payments/${paid.payments[0]!.id}/refunds`, {
        token: w.admin.token,
        body: { amountCents: 100, idempotencyKey: 'export-intern-01', reason: '[TEST] INTERN-ERSTATTUNG schwieriger Kunde' },
      }),
      InvoiceSchema,
    );
    // echter Konflikt: dieselbe Hebebühne zur selben Zeit
    const liftId = randomUUID();
    expectStatus(await call(h, 'PUT', `/settings/resources/${liftId}`, { token: w.admin.token, body: { name: '[TEST] Bühne Export', kind: 'lift', active: true } }), 200);
    const slot = { kind: 'service', customerId: customer.customerId, vehicleId, startsAt: iso(3 * 86_400_000), endsAt: iso(3 * 86_400_000 + 3600_000), assigneeIds: [], resourceId: liftId };
    expectOk(await call(h, 'POST', '/appointments', { token: w.service.token, body: { ...slot, overrideConflictsReason: '[TEST] erster Termin' } }), AppointmentSchema, 201);
    expectOk(
      await call(h, 'POST', '/appointments', { token: w.service.token, body: { ...slot, overrideConflictsReason: '[TEST] INTERN-KONFLIKT Kunde ist unwichtig' } }),
      AppointmentSchema,
      201,
    );
    const exp = await h.app.inject({ method: 'GET', url: '/api/v1/me/export', headers: { authorization: `Bearer ${customer.token}` } });
    expect(exp.statusCode).toBe(200);
    const json = strFromU8(unzipSync(new Uint8Array(exp.rawPayload))['daten.json']!);
    for (const marker of ['INTERN-HALTER', 'INTERN-ZAHLUNG', 'INTERN-ERSTATTUNG', 'INTERN-KONFLIKT']) expect(json, marker).not.toContain(marker);
    // vollständiger Export der Werkstatt enthält sie weiterhin
    const full = await h.app.inject({ method: 'GET', url: `/api/v1/customers/${customer.customerId}/export`, headers: { authorization: `Bearer ${w.admin.token}` } });
    const fullJson = strFromU8(unzipSync(new Uint8Array(full.rawPayload))['daten.json']!);
    for (const marker of ['INTERN-HALTER', 'INTERN-ZAHLUNG', 'INTERN-ERSTATTUNG', 'INTERN-KONFLIKT']) expect(fullJson, marker).toContain(marker);
  });
});

describe('R12 Weiterleitung nach Anmeldung (safeNextPath)', () => {
  it('lehnt Steuerzeichen ab, die Browser beim URL-Parsen entfernen (//-Umgehung)', () => {
    for (const bad of ['/\t/boese.example', '/\n/boese.example', '/\r/boese.example', ' //boese.example', '/%09/boese.example'.replace('%09', '\t')]) {
      const next = safeNextPath(bad);
      if (next !== null) {
        // was der Browser daraus macht, muss auf derselben Herkunft bleiben
        expect(new URL(next, 'https://app.werkstatt.test').origin, JSON.stringify(bad)).toBe('https://app.werkstatt.test');
      }
    }
    expect(safeNextPath('/kunde/rechnungen/1?x=1')).toBe('/kunde/rechnungen/1?x=1');
  });
});

describe('R13 Idempotency-Key über Benutzergrenzen', () => {
  it('gleicher Schlüssel eines anderen Benutzers liefert keine fremde Antwort', async () => {
    const a = await customerWithVehicle(h, 'IdemA');
    const b = await customerWithVehicle(h, 'IdemB');
    const woA = await createWorkOrder(h, w.service.token, { customerId: a.customer.customerId!, vehicleId: a.vehicleId });
    const key = 'gemeinsamer-schluessel-0001';
    const first = await call(h, 'POST', `/work-orders/${woA.id}/messages`, {
      token: a.customer.token,
      headers: { 'idempotency-key': key },
      body: { clientMessageId: 'idem-a-00001', body: 'Geheim A' },
    });
    expectStatus(first, 201);
    const second = await call(h, 'POST', `/work-orders/${woA.id}/messages`, {
      token: b.customer.token,
      headers: { 'idempotency-key': key },
      body: { clientMessageId: 'idem-a-00001', body: 'Geheim A' },
    });
    expectStatus(second, 404);
    expect(second.body).not.toContain('Geheim A');
    expect(second.headers['idempotent-replay']).toBeUndefined();
  });
});

describe('R14 Echtzeit (WebSocket)', () => {
  type Ws = Awaited<ReturnType<Harness['app']['injectWS']>>;
  const next = (ws: Ws, ms = 1500): Promise<Record<string, unknown> | null> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), ms);
      ws.once('message', (data) => {
        clearTimeout(timer);
        resolve(JSON.parse(String(data)) as Record<string, unknown>);
      });
    });
  const closed = (ws: Ws, ms = 1500): Promise<number | null> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), ms);
      ws.once('close', (code: number) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
  async function subscribe(token: string, workOrderId: string) {
    const ws = await h.app.injectWS('/api/v1/realtime');
    ws.send(JSON.stringify({ type: 'auth', token }));
    await next(ws);
    ws.send(JSON.stringify({ type: 'subscribe', workOrderId }));
    return { ws, reply: await next(ws) };
  }

  it('Kunde kann Entwurf nicht abonnieren; Token in der URL wird nicht akzeptiert', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'WsEntwurf');
    const draft = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId }, { draft: 'true' });
    const { ws, reply } = await subscribe(customer.token, draft.id);
    expect(reply).toMatchObject({ type: 'error', code: 'not_found' });
    ws.terminate();
    const viaUrl = await h.app.injectWS(`/api/v1/realtime?token=${customer.token}`);
    viaUrl.send(JSON.stringify({ type: 'subscribe', workOrderId: draft.id }));
    expect(await closed(viaUrl)).toBe(4401);
  });

  it('Deaktivierung beendet offene Echtzeitverbindungen sofort', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'WsDeaktiviert');
    const mech = await createStaff(h, 'mechanic');
    const wo = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId, assigneeIds: [mech.id] });
    const m = await subscribe(mech.token, wo.id);
    expect(m.reply).toMatchObject({ type: 'subscribed' });
    const c = await subscribe(customer.token, wo.id);
    expect(c.reply).toMatchObject({ type: 'subscribed' });
    const mechClosed = closed(m.ws);
    const custClosed = closed(c.ws);
    expectOk(await call(h, 'POST', `/users/${mech.id}/disable`, { token: w.admin.token }), StaffUserSchema);
    expectOk(await call(h, 'POST', `/customers/${customer.customerId}/account/disable`, { token: w.service.token }), CustomerDetailSchema);
    expect(await mechClosed).toBe(4401);
    expect(await custClosed).toBe(4401);
  });

  it.fails('entzogene Zuweisung beendet das Abo des Mechanikers (BEFUND, offen)', async () => {
    const { customer, vehicleId } = await customerWithVehicle(h, 'WsZuweisung');
    const mech = await createStaff(h, 'mechanic');
    const wo = await createWorkOrder(h, w.service.token, { customerId: customer.customerId!, vehicleId, assigneeIds: [mech.id] });
    const m = await subscribe(mech.token, wo.id);
    expect(m.reply).toMatchObject({ type: 'subscribed' });
    expectOk(await call(h, 'PUT', `/work-orders/${wo.id}/assignees`, { token: w.service.token, body: { assigneeIds: [] } }), WorkOrderDetailSchema);
    const event = next(m.ws);
    await call(h, 'PATCH', `/work-orders/${wo.id}`, { token: w.service.token, body: { title: 'geändert' } });
    expect(await event).toBeNull();
    m.ws.terminate();
  });
});
