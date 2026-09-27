/**
 * Dashboard (R-DASH): Kacheln je Rolle; jede Kachel führt zur passend gefilterten Liste oder,
 * wenn es genau einen Vorgang gibt (Kunde), direkt zum Vorgang.
 */
import { and, eq, gt, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DashboardTileSchema, routes, toQuery, type DashboardTile } from '@werkstatt/contracts';
import { berlinDateOf, evaluateVehicleMaintenance, hasPermission, toBerlinLocal, type Actor } from '@werkstatt/domain';
import type { DbOrTx } from '../db/index';
import { appointments, approvalRequests, invoices, odometerReadings, serviceEntries, vehicleOwnerships, vehicles, workItems, workOrderAssignees, workOrders } from '../db/schema/index';
import { ensure, requireActor } from '../lib/http';
import { workOrderListCondition } from '../services/access';
import { loadInvoiceBundles, paymentStatusOf } from '../services/invoices';
import { toServiceEntryRecords } from '../services/serviceEntries';
import { buildWorkOrderSummaries } from '../services/workOrders';
import type { App } from '../types';

/** Beginn/Ende des heutigen Tages in Berlin als UTC-Zeitpunkte. */
function berlinDayBounds(now: Date): { start: Date; end: Date } {
  const local = toBerlinLocal(now);
  const [hh, mm] = local.time.split(':').map(Number);
  const msIntoDay = ((hh ?? 0) * 60 + (mm ?? 0)) * 60_000 + now.getUTCSeconds() * 1000 + now.getUTCMilliseconds();
  const start = new Date(now.getTime() - msIntoDay);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

async function dueVehicleIds(db: DbOrTx, vehicleIds: string[], now: Date): Promise<string[]> {
  if (vehicleIds.length === 0) return [];
  const entries = await toServiceEntryRecords(db, await db.select().from(serviceEntries).where(inArray(serviceEntries.vehicleId, vehicleIds)));
  const readings = await db.select().from(odometerReadings).where(inArray(odometerReadings.vehicleId, vehicleIds));
  const today = berlinDateOf(now);
  return vehicleIds.filter((id) =>
    evaluateVehicleMaintenance({
      entries: entries.filter((e) => e.vehicleId === id),
      odometerReadings: readings.filter((r) => r.vehicleId === id).map((r) => ({ valueKm: r.valueKm, recordedAt: r.recordedAt.toISOString(), plausibility: r.plausibility })),
      today,
    }).some((d) => d.state === 'overdue' || d.state === 'due_soon'),
  );
}

async function customerTiles(db: DbOrTx, actor: Actor, now: Date): Promise<DashboardTile[]> {
  const customerId = actor.customerId;
  if (!customerId) return [];
  const woRows = await db.select().from(workOrders).where(workOrderListCondition(actor));
  const summaries = await buildWorkOrderSummaries(db, actor, woRows, now);
  const pending = woRows.length
    ? await db
        .select({ id: approvalRequests.id, workOrderId: approvalRequests.workOrderId })
        .from(approvalRequests)
        .where(and(inArray(approvalRequests.workOrderId, woRows.map((w) => w.id)), eq(approvalRequests.status, 'pending_customer')))
    : [];
  const invRows = await db.select().from(invoices).where(and(eq(invoices.customerId, customerId), eq(invoices.status, 'issued')));
  const openInvoices = (await loadInvoiceBundles(db, invRows)).filter((b) => paymentStatusOf(b, now).openCents > 0);
  const unread = summaries.reduce((s, w) => s + w.unreadMessages, 0);
  const unreadOrders = summaries.filter((w) => w.unreadMessages > 0);
  const ready = summaries.filter((w) => w.status.readyForPickup);
  const ownVehicles = await db
    .select({ id: vehicleOwnerships.vehicleId })
    .from(vehicleOwnerships)
    .where(and(eq(vehicleOwnerships.customerId, customerId), isNull(vehicleOwnerships.endedAt)));
  const due = await dueVehicleIds(db, ownVehicles.map((v) => v.id), now);
  const { start, end } = berlinDayBounds(now);
  const [todayCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(appointments)
    .where(and(eq(appointments.customerId, customerId), eq(appointments.status, 'confirmed'), lt(appointments.startsAt, end), gt(appointments.endsAt, start)));
  return [
    {
      key: 'pending_approvals',
      label: 'Offene Entscheidungen',
      count: pending.length,
      targetPath: pending.length === 1 ? routes.customer.approval(pending[0]!.workOrderId, pending[0]!.id) : routes.customer.workOrders(),
    },
    {
      key: 'open_invoices',
      label: 'Offene Rechnungen',
      count: openInvoices.length,
      targetPath: openInvoices.length === 1 ? routes.customer.invoice(openInvoices[0]!.invoice.id) : routes.customer.invoices(),
    },
    {
      key: 'unread_messages',
      label: 'Ungelesene Nachrichten',
      count: unread,
      targetPath: unreadOrders.length === 1 ? routes.customer.chat(unreadOrders[0]!.id) : routes.customer.messages(),
    },
    {
      key: 'ready_for_pickup',
      label: 'Abholbereit',
      count: ready.length,
      targetPath: ready.length === 1 ? routes.customer.workOrder(ready[0]!.id) : routes.customer.workOrders(),
    },
    {
      key: 'maintenance_due',
      label: 'Wartung bald fällig',
      count: due.length,
      targetPath: due.length === 1 ? routes.customer.vehicle(due[0]!) : routes.customer.vehicles(),
    },
    { key: 'appointments_today', label: 'Termine heute', count: todayCount?.n ?? 0, targetPath: routes.customer.appointments() },
  ];
}

async function mechanicTiles(db: DbOrTx, actor: Actor, now: Date): Promise<DashboardTile[]> {
  const woRows = await db
    .select()
    .from(workOrders)
    .where(and(workOrderListCondition(actor), inArray(workOrders.status, ['open', 'in_progress', 'work_completed'])));
  const ids = woRows.map((w) => w.id);
  let itemCount = 0;
  if (ids.length > 0) {
    const assignedOrders = await db.select({ workOrderId: workOrderAssignees.workOrderId }).from(workOrderAssignees).where(eq(workOrderAssignees.userId, actor.userId));
    const mine = new Set(assignedOrders.map((a) => a.workOrderId));
    const items = await db.select().from(workItems).where(and(inArray(workItems.workOrderId, ids), inArray(workItems.authorization, ['agreed', 'approved'])));
    itemCount = items.filter(
      (i) => (i.assignedTo === actor.userId || (i.assignedTo === null && mine.has(i.workOrderId))) && !['done', 'not_done'].includes(i.executionStatus),
    ).length;
  }
  void now;
  return [
    { key: 'my_assigned_items', label: 'Meine offenen Positionen', count: itemCount, targetPath: routes.mechanic.home() },
    { key: 'open_work_orders', label: 'Meine Aufträge', count: woRows.length, targetPath: routes.mechanic.home() },
  ];
}

async function workshopTiles(db: DbOrTx, actor: Actor, now: Date): Promise<DashboardTile[]> {
  const tiles: DashboardTile[] = [];
  const has = (p: Parameters<typeof actor.permissions.has>[0]) => actor.permissions.has(p);
  const { start, end } = berlinDayBounds(now);
  if (has('appointments.read')) {
    const [today] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(appointments)
      .where(and(eq(appointments.status, 'confirmed'), lt(appointments.startsAt, end), gt(appointments.endsAt, start)));
    const [requests] = await db.select({ n: sql<number>`count(*)::int` }).from(appointments).where(eq(appointments.status, 'requested'));
    tiles.push({ key: 'appointments_today', label: 'Termine heute', count: today?.n ?? 0, targetPath: routes.workshop.calendar() });
    tiles.push({ key: 'appointment_requests', label: 'Terminanfragen', count: requests?.n ?? 0, targetPath: routes.workshop.appointmentRequests() });
  }
  const woRows = await db
    .select()
    .from(workOrders)
    .where(and(workOrderListCondition(actor), ne(workOrders.status, 'cancelled'), ne(workOrders.status, 'picked_up')));
  const summaries = await buildWorkOrderSummaries(db, actor, woRows, now);
  const active = summaries.filter((s) => ['open', 'in_progress', 'work_completed'].includes(s.status.work));
  tiles.push({ key: 'open_work_orders', label: 'Offene Aufträge', count: active.length, targetPath: routes.workshop.workOrders({ arbeit: 'offen' }) });
  if (has('approvals.request')) {
    tiles.push({
      key: 'pending_approvals',
      label: 'Ausstehende Kundenfreigaben',
      count: summaries.filter((s) => s.status.approval === 'pending').length,
      targetPath: routes.workshop.workOrders({ freigabe: 'pending' }),
    });
  }
  if (has('messages.customerChat')) {
    tiles.push({
      key: 'unread_messages',
      label: 'Ungelesene Nachrichten',
      count: summaries.reduce((s, w) => s + w.unreadMessages, 0),
      targetPath: routes.workshop.messages(),
    });
  }
  tiles.push({
    key: 'ready_for_pickup',
    label: 'Abholbereit',
    count: summaries.filter((s) => s.status.readyForPickup).length,
    targetPath: routes.workshop.workOrders({ abholbereit: 'ja' }),
  });
  if (has('serviceHistory.read')) {
    const vehicleRows = await db.select({ id: vehicles.id }).from(vehicles).where(isNull(vehicles.archivedAt));
    const due = await dueVehicleIds(db, vehicleRows.map((v) => v.id), now);
    tiles.push({ key: 'maintenance_due', label: 'Fällige Wartungen', count: due.length, targetPath: routes.workshop.maintenance() });
  }
  if (has('invoices.read')) {
    const invRows = await db.select().from(invoices).where(eq(invoices.status, 'issued'));
    const open = (await loadInvoiceBundles(db, invRows)).filter((b) => paymentStatusOf(b, now).openCents > 0);
    tiles.push({ key: 'open_invoices', label: 'Offene Rechnungen', count: open.length, targetPath: `${routes.workshop.invoices()}${toQuery({ zahlung: 'offen' })}` });
  }
  return tiles;
}

export async function dashboardRoutes(app: App): Promise<void> {
  app.get('/dashboard', { schema: { response: { 200: z.array(DashboardTileSchema) } } }, async (request) => {
    const actor = requireActor(request);
    const { db, now } = app.deps;
    if (actor.role === 'customer') return customerTiles(db, actor, now());
    ensure(hasPermission(actor, 'dashboard.view'));
    if (actor.role === 'mechanic') return mechanicTiles(db, actor, now());
    return workshopTiles(db, actor, now());
  });
}
