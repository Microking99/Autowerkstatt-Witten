/**
 * Vorschau-Beispieldaten (createSeed mit `extended`): alle Verweise lösen auf, jede Ansicht lädt
 * über die DemoApi, und die Regeln des Grundbestands gelten auch hier (Serviceeinträge nur aus
 * fachlich abgeschlossenen Aufträgen, Rechnungsbetrag aus ausgeführten Positionen).
 */
import { describe, expect, it } from 'vitest';
import { DEMO_EMAILS, DEMO_PASSWORD } from './constants';
import { DemoApi } from './DemoApi';
import { createSeed } from './seed';

const NOW = new Date('2026-10-01T09:30:00.000Z');

describe('Vorschau-Beispieldaten', () => {
  const base = createSeed(NOW);
  const s = createSeed(NOW, { extended: true });

  it('ergänzt nur im Vorschau-Modus und lässt den Grundbestand unverändert', () => {
    expect(base.customers).toHaveLength(4);
    expect(s.customers.length).toBeGreaterThanOrEqual(12);
    expect(s.vehicles.length).toBeGreaterThanOrEqual(16);
    expect(s.workOrders.length).toBeGreaterThanOrEqual(27);
    for (const c of base.customers) expect(s.customers.find((x) => x.id === c.id)).toEqual(c);
  });

  it('eindeutige Kennungen, Nummern und Kennzeichen', () => {
    const unique = (values: (string | null)[]) => expect(new Set(values).size).toBe(values.length);
    unique(s.customers.map((c) => c.id));
    unique(s.customers.map((c) => c.customerNumber));
    unique(s.vehicles.map((v) => v.id));
    unique(s.vehicles.map((v) => v.licensePlate));
    unique(s.vehicles.map((v) => v.qrToken));
    unique(s.workOrders.map((w) => w.id));
    unique(s.workOrders.map((w) => w.orderNumber));
    unique(s.workItems.map((i) => i.id));
    unique(s.invoices.map((i) => i.id));
    unique(s.invoices.map((i) => i.invoiceNumber));
    unique(s.appointments.map((a) => a.id));
    unique(s.serviceEntries.map((e) => e.id));
    unique(s.documents.map((d) => d.id));
    unique(s.users.map((u) => u.id));
    unique(s.users.map((u) => u.email));
  });

  it('alle Verweise lösen auf', () => {
    const has = <T extends { id: string }>(list: T[], id: string | null) => id === null || list.some((x) => x.id === id);
    for (const o of s.ownerships) expect(has(s.vehicles, o.vehicleId) && has(s.customers, o.customerId)).toBe(true);
    for (const w of s.workOrders) {
      expect(has(s.customers, w.customerId) && has(s.vehicles, w.vehicleId)).toBe(true);
      // Fahrzeug gehört zum Zeitpunkt des Auftrags dem Kunden
      expect(s.ownerships.some((o) => o.vehicleId === w.vehicleId && o.customerId === w.customerId)).toBe(true);
      for (const u of w.assigneeIds) expect(has(s.users, u)).toBe(true);
    }
    for (const i of s.workItems) expect(has(s.workOrders, i.workOrderId)).toBe(true);
    for (const a of s.appointments) expect(has(s.customers, a.customerId) && has(s.vehicles, a.vehicleId) && has(s.workOrders, a.workOrderId) && has(s.resources, a.resourceId)).toBe(true);
    for (const inv of s.invoices) expect(has(s.workOrders, inv.workOrderId) && has(s.documents, inv.documentId)).toBe(true);
    for (const p of s.payments) expect(has(s.invoices, p.invoiceId)).toBe(true);
    for (const m of s.messages) expect(has(s.workOrders, m.workOrderId) && has(s.users, m.authorUserId)).toBe(true);
    for (const a of s.customerAccounts) expect(has(s.customers, a.customerId) && has(s.users, a.userId)).toBe(true);
    for (const d of s.documents) for (const v of d.versions) expect(s.files.some((f) => f.id === v.fileId)).toBe(true);
  });

  it('Serviceeinträge nur aus fachlich abgeschlossenen Aufträgen und ausgeführten Wartungspositionen', () => {
    for (const e of s.serviceEntries.filter((x) => x.workOrderId)) {
      const order = s.workOrders.find((w) => w.id === e.workOrderId)!;
      expect(order.completionReviewedAt).not.toBeNull();
      const item = s.workItems.find((i) => i.id === e.workItemId)!;
      expect(item.executionStatus).toBe('done');
      expect(item.maintenanceTypeId).toBe(e.maintenanceTypeId);
    }
  });

  it('jede Ansicht lädt als Werkstatt, Kunden sehen nur Eigenes', async () => {
    const api = new DemoApi({ latencyMs: 0, now: () => NOW, extendedSeed: true });
    api.setToken((await api.login({ email: DEMO_EMAILS.service, password: DEMO_PASSWORD })).token);
    const customers = await api.listCustomers();
    expect(customers.items.length).toBeGreaterThanOrEqual(12);
    const orders = await api.listWorkOrders();
    expect(new Set(orders.items.map((o) => o.status.work))).toEqual(new Set(['open', 'in_progress', 'work_completed', 'completed', 'picked_up']));
    for (const o of orders.items) await api.getWorkOrder(o.id);
    for (const c of customers.items) await api.getCustomer(c.id);
    const vehicles = await api.listVehicles();
    for (const v of vehicles.items) {
      await api.getVehicle(v.id);
      await api.maintenanceDue(v.id);
    }
    expect((await api.dashboard()).length).toBeGreaterThan(0);
    expect((await api.maintenanceDueAll()).length).toBeGreaterThan(0);

    const customer = new DemoApi({ latencyMs: 0, now: () => NOW, extendedSeed: true });
    customer.setToken((await customer.login({ email: 'a.demir@kunden.example', password: DEMO_PASSWORD })).token);
    const own = await customer.listWorkOrders();
    expect(own.items.length).toBeGreaterThan(0);
    expect(own.items.every((o) => o.customerDisplayName.includes('Demir'))).toBe(true);
  });
});
