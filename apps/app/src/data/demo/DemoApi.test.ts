import { describe, expect, it } from 'vitest';
import { ApiError, ERROR_CODES } from '../errors';
import { DEMO_EMAILS, DEMO_PASSWORD, DEMO_TOKENS } from './constants';
import { DemoApi } from './DemoApi';
import { IDS } from './seed';

const NOW = new Date('2026-09-26T10:00:00.000Z');

async function as(email: string) {
  const api = new DemoApi({ latencyMs: 0, now: () => NOW });
  const res = await api.login({ email, password: DEMO_PASSWORD });
  api.setToken(res.token);
  return api;
}

async function expectError(p: Promise<unknown>, status: number, code?: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(ApiError);
  expect((e as ApiError).status).toBe(status);
  if (code) expect((e as ApiError).code).toBe(code);
}

describe('DemoApi: Anmeldung', () => {
  it('meldet falsche Daten, ohne die Existenz der Adresse zu verraten', async () => {
    const api = new DemoApi({ latencyMs: 0, now: () => NOW });
    await expectError(api.login({ email: DEMO_EMAILS.customer, password: 'falsch' }), 401, ERROR_CODES.invalidCredentials);
    await expectError(api.login({ email: 'niemand@kunden.example', password: 'falsch' }), 401, ERROR_CODES.invalidCredentials);
    await expectError(api.login({ email: DEMO_EMAILS.disabled, password: DEMO_PASSWORD }), 403, ERROR_CODES.accountDisabled);
  });

  it('verlangt eine Anmeldung für geschützte Daten', async () => {
    const api = new DemoApi({ latencyMs: 0, now: () => NOW });
    await expectError(api.listWorkOrders(), 401);
  });

  it('behandelt Einladungen: gültig, abgelaufen, benutzt', async () => {
    const api = new DemoApi({ latencyMs: 0, now: () => NOW });
    await expectError(api.acceptInvitation({ token: DEMO_TOKENS.invitationExpired, password: 'ein-langes-passwort' }), 410, ERROR_CODES.tokenExpired);
    await expectError(api.acceptInvitation({ token: DEMO_TOKENS.invitationUsed, password: 'ein-langes-passwort' }), 410, ERROR_CODES.tokenUsed);
    await expectError(api.acceptInvitation({ token: 'unbekannter-token-123456', password: 'ein-langes-passwort' }), 404, ERROR_CODES.tokenInvalid);
    const res = await api.acceptInvitation({ token: DEMO_TOKENS.invitationValid, password: 'ein-langes-passwort' });
    expect(res.user.role).toBe('customer');
    await expectError(api.acceptInvitation({ token: DEMO_TOKENS.invitationValid, password: 'ein-langes-passwort' }), 410, ERROR_CODES.tokenUsed);
  });
});

describe('DemoApi: Objektregeln Kunde', () => {
  it('liefert für fremde Aufträge, Rechnungen und Fahrzeuge 404', async () => {
    const api = await as(DEMO_EMAILS.customer);
    await expectError(api.getWorkOrder(IDS.workOrders.rohde2025), 404);
    await expectError(api.getInvoice(IDS.invoices.rohde2025), 404);
    await expectError(api.getVehicle(IDS.vehicles.corsa), 404);
    await expectError(api.getWorkOrder('00000000-0000-4000-8000-999999999999'), 404);
  });

  it('Vorbesitzer sieht alte Aufträge, aber das verkaufte Fahrzeug nicht mehr', async () => {
    const api = await as(DEMO_EMAILS.previousOwner);
    const orders = await api.listWorkOrders();
    expect(orders.items.map((w) => w.orderNumber)).toContain('A-2025-0402');
    await expectError(api.getVehicle(IDS.vehicles.octavia), 404);
    await expectError(api.listServiceEntries(IDS.vehicles.octavia), 404);
    const vehicles = await api.listVehicles();
    expect(vehicles.items.map((v) => v.licensePlate)).toEqual(['EN-GR 1590']);
  });

  it('Kundin sieht die Octavia-Historie ohne Auftragsbezug des Vorbesitzers und ohne interne Dokumente', async () => {
    const api = await as(DEMO_EMAILS.customer);
    const entries = await api.listServiceEntries(IDS.vehicles.octavia);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(e.workOrderId).toBeNull();
    expect(entries.every((e) => e.status === 'valid')).toBe(true);
    const docs = await api.listDocuments();
    expect(docs.every((d) => d.visibility === 'customer' && d.customerId === IDS.customers.miriam)).toBe(true);
    const wo = await api.getWorkOrder(IDS.workOrders.octaviaInspection);
    expect(wo.notesInternal).toBeUndefined();
    expect(wo.intake?.notesInternal).toBeUndefined();
    const photos = await api.listPhotos(IDS.workOrders.octaviaInspection);
    expect(photos.every((p) => p.visibility === 'customer')).toBe(true);
  });

  it('Fälligkeiten: korrigierte Revision zählt, Golf-km ist als Schätzung gekennzeichnet', async () => {
    const api = await as(DEMO_EMAILS.customer);
    const octavia = await api.maintenanceDue(IDS.vehicles.octavia);
    const oil = octavia.find((d) => d.title.startsWith('Ölwechsel'))!;
    expect(oil.dueKm).toBe(99_020);
    expect(oil.state).not.toBe('overdue');
    const golf = await api.maintenanceDue(IDS.vehicles.golf);
    expect(golf.some((d) => d.estimatedCurrentKm !== null && d.explanation.includes('geschätzt'))).toBe(true);
  });

  it('Mechaniker sieht keine Preise und nur zugewiesene Aufträge', async () => {
    const api = await as(DEMO_EMAILS.mechanic);
    const list = await api.listWorkOrders();
    expect(list.items.map((w) => w.orderNumber)).not.toContain('A-2026-0191');
    const wo = await api.getWorkOrder(IDS.workOrders.yaris);
    expect(wo.items.every((i) => i.unitPriceCents === undefined)).toBe(true);
    await expectError(api.listInvoices(), 403);
  });
});

describe('DemoApi: Freigaben', () => {
  it('Kundin gibt frei; Entscheidung ist an Version und Hash gebunden; Mechaniker kann nicht freigeben', async () => {
    const mech = await as(DEMO_EMAILS.mechanic);
    const reqForMech = await mech.getApproval(IDS.approvals.brakes);
    await expectError(
      mech.decideApproval(IDS.approvals.brakes, { versionId: reqForMech.currentVersion.id, contentHash: reqForMech.currentVersion.contentHash, decision: 'approved', channel: 'web' }),
      403,
    );
    // Positionen warten und sind für den Mechaniker gesperrt
    const wo = await mech.getWorkOrder(IDS.workOrders.octaviaInspection);
    const pending = wo.items.find((i) => i.authorization === 'pending_approval')!;
    await expectError(mech.startWorkItem(pending.id), 409);

    const api = await as(DEMO_EMAILS.customer);
    const req = await api.getApproval(IDS.approvals.brakes);
    const decided = await api.decideApproval(IDS.approvals.brakes, { versionId: req.currentVersion.id, contentHash: req.currentVersion.contentHash, decision: 'approved', channel: 'web' });
    expect(decided.status).toBe('approved');
    const after = await api.getWorkOrder(IDS.workOrders.octaviaInspection);
    expect(after.items.filter((i) => i.approvalRequestId === IDS.approvals.brakes).every((i) => i.authorization === 'approved')).toBe(true);
  });

  it('nach einer Änderung durch die Werkstatt schlägt die Entscheidung zur alten Version fehl', async () => {
    const api = await as(DEMO_EMAILS.customer);
    const req = await api.getApproval(IDS.approvals.timingBeltOffer);
    expect(req.versions).toHaveLength(2);
    api.controls.workshopReviseApproval(IDS.approvals.timingBeltOffer);
    await expectError(
      api.decideApproval(IDS.approvals.timingBeltOffer, { versionId: req.currentVersion.id, contentHash: req.currentVersion.contentHash, decision: 'approved', channel: 'web' }),
      409,
      ERROR_CODES.approvalVersionOutdated,
    );
    const fresh = await api.getApproval(IDS.approvals.timingBeltOffer);
    expect(fresh.currentVersion.versionNo).toBe(3);
  });

  it('Ablehnung: Position wird nicht ausgeführt und erscheint nie in der Servicehistorie', async () => {
    const api = await as(DEMO_EMAILS.customer);
    const req = await api.getApproval(IDS.approvals.brakes);
    await api.decideApproval(IDS.approvals.brakes, { versionId: req.currentVersion.id, contentHash: req.currentVersion.contentHash, decision: 'rejected', channel: 'web' });
    const message = api.controls.workshopCompleteOrder(IDS.workOrders.octaviaInspection);
    expect(message).toContain('Serviceeinträge erzeugt');
    const wo = await api.getWorkOrder(IDS.workOrders.octaviaInspection);
    expect(wo.status.work).toBe('completed');
    expect(wo.status.readyForPickup).toBe(true);
    expect(wo.items.filter((i) => i.approvalRequestId === IDS.approvals.brakes).every((i) => i.executionStatus === 'not_done')).toBe(true);
    const entries = await api.listServiceEntries(IDS.vehicles.octavia);
    const titles = entries.map((e) => e.title);
    expect(titles).toContain('Inspektion');
    expect(titles.some((t) => t.includes('Brems'))).toBe(false);
    // Abschluss wiederholen erzeugt keine Duplikate
    expect(() => api.controls.workshopCompleteOrder(IDS.workOrders.octaviaInspection)).toThrow();
    expect((await api.listServiceEntries(IDS.vehicles.octavia)).length).toBe(entries.length);
  });
});

describe('DemoApi: Zahlung', () => {
  it('"Jetzt bezahlen" ändert nichts; erst die geprüfte Anbieterbestätigung setzt "Bezahlt", Doppelmeldung bucht einmal', async () => {
    const api = await as(DEMO_EMAILS.customer);
    const before = await api.getInvoice(IDS.invoices.golfWheels);
    expect(before.paymentStatus).toBe('open');
    const start = await api.startCheckout(IDS.invoices.golfWheels);
    expect(start.invoicePaymentStatus).toBe('open');
    expect((await api.refreshPaymentStatus(IDS.invoices.golfWheels)).paymentStatus).toBe('open');
    api.controls.simulateProvider(start.checkoutId, 'duplicate');
    const after = await api.refreshPaymentStatus(IDS.invoices.golfWheels);
    expect(after.paymentStatus).toBe('paid');
    expect(after.payments.filter((p) => p.method === 'sumup_online')).toHaveLength(1);
  });

  it('Abbruch und abweichender Betrag lassen die Rechnung offen', async () => {
    const api = await as(DEMO_EMAILS.customer);
    const first = await api.startCheckout(IDS.invoices.golfAc);
    api.controls.simulateProvider(first.checkoutId, 'cancelled');
    expect((await api.refreshPaymentStatus(IDS.invoices.golfAc)).paymentStatus).toBe('open');
    const second = await api.startCheckout(IDS.invoices.golfAc);
    api.controls.simulateProvider(second.checkoutId, 'mismatch');
    const inv = await api.refreshPaymentStatus(IDS.invoices.golfAc);
    expect(inv.paymentStatus).toBe('open');
    expect(inv.overdue).toBe(true);
  });

  it('Kunden können fremde Rechnungen nicht bezahlen', async () => {
    const api = await as(DEMO_EMAILS.customer);
    await expectError(api.startCheckout(IDS.invoices.transit), 404);
  });
});

describe('DemoApi: Termine, Chat, Freigabelinks', () => {
  it('Terminanfrage ist keine Buchung; Alternative annehmen bestätigt', async () => {
    const api = await as(DEMO_EMAILS.customer);
    const a = await api.requestAppointment({ kind: 'service', vehicleId: IDS.vehicles.golf, preferredStart: '2026-10-05T06:00:00.000Z', preferredEnd: '2026-10-05T10:00:00.000Z', customerNote: 'Bitte vormittags' });
    expect(a.status).toBe('requested');
    const proposed = await api.getAppointment(IDS.appointments.octaviaTimingBelt);
    const accepted = await api.acceptProposal(proposed.id, proposed.proposals[0]!.id);
    expect(accepted.status).toBe('confirmed');
    expect(accepted.startsAt).toBe(proposed.proposals[0]!.startsAt);
  });

  it('Nachrichten sind über clientMessageId idempotent', async () => {
    const api = await as(DEMO_EMAILS.customer);
    const input = { clientMessageId: 'client-abc-123', body: 'Wann ist der Wagen fertig?' };
    const a = await api.sendMessage(IDS.workOrders.octaviaInspection, input);
    const b = await api.sendMessage(IDS.workOrders.octaviaInspection, input);
    expect(a.id).toBe(b.id);
    const list = await api.listMessages(IDS.workOrders.octaviaInspection);
    expect(list.filter((m) => m.clientMessageId === 'client-abc-123')).toHaveLength(1);
  });

  it('Verbindungsfehler: nächste Anfrage schlägt mit NETWORK fehl, danach geht es wieder', async () => {
    const api = await as(DEMO_EMAILS.customer);
    api.controls.setFailNext(true);
    await expectError(api.listWorkOrders(), 0, ERROR_CODES.network);
    await expect(api.listWorkOrders()).resolves.toBeTruthy();
  });

  it('Freigabelink anlegen, öffentlich abrufen, widerrufen', async () => {
    const api = await as(DEMO_EMAILS.customer);
    const entries = await api.listServiceEntries(IDS.vehicles.golf);
    const share = await api.createShare(IDS.vehicles.golf, { label: 'Probefahrt Samstag', serviceEntryIds: [entries[0]!.id], includeVin: false, expiresAt: '2026-10-03T21:59:00.000Z' });
    expect(share.shareUrl).toMatch(/\/f\//);
    const token = share.shareUrl!.split('/f/')[1]!;
    api.setToken(null);
    const view = await api.publicShare(token);
    expect(view.entries).toHaveLength(1);
    expect(view.vin).toBeNull();
    const again = await as(DEMO_EMAILS.customer);
    // eigener Zustand je Instanz: Widerruf im selben Objekt prüfen
    api.setToken((await api.login({ email: DEMO_EMAILS.customer, password: DEMO_PASSWORD })).token);
    await api.revokeShare(share.id);
    api.setToken(null);
    await expectError(api.publicShare(token), 410, ERROR_CODES.shareRevoked);
    expect(again).toBeTruthy();
  });
});
