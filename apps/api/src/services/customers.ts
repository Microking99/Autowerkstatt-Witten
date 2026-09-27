import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { CustomerAccessStatus, CustomerDetail, CustomerSummary } from '@werkstatt/contracts';
import type { Actor } from '@werkstatt/domain';
import type { DbOrTx } from '../db/index';
import { customerAccounts, customers, invoices, payments, users, vehicleOwnerships } from '../db/schema/index';

export type CustomerRow = typeof customers.$inferSelect;

export function customerDisplayName(c: Pick<CustomerRow, 'kind' | 'companyName' | 'firstName' | 'lastName'>): string {
  if (c.kind === 'business' && c.companyName) return c.companyName;
  const name = [c.firstName, c.lastName].filter((p) => p && p.trim().length > 0).join(' ');
  return name || c.companyName || 'Unbenannt';
}

export async function customerStats(
  db: DbOrTx,
  ids: string[],
): Promise<Map<string, { vehicleCount: number; accessStatus: CustomerAccessStatus; openInvoiceCount: number }>> {
  const result = new Map<string, { vehicleCount: number; accessStatus: CustomerAccessStatus; openInvoiceCount: number }>();
  if (ids.length === 0) return result;
  for (const id of ids) result.set(id, { vehicleCount: 0, accessStatus: 'none', openInvoiceCount: 0 });

  const vehicleCounts = await db
    .select({ customerId: vehicleOwnerships.customerId, n: sql<number>`count(*)::int` })
    .from(vehicleOwnerships)
    .where(and(inArray(vehicleOwnerships.customerId, ids), isNull(vehicleOwnerships.endedAt)))
    .groupBy(vehicleOwnerships.customerId);
  for (const r of vehicleCounts) result.get(r.customerId)!.vehicleCount = r.n;

  const accounts = await db
    .select({ customerId: customerAccounts.customerId, status: users.status })
    .from(customerAccounts)
    .innerJoin(users, eq(users.id, customerAccounts.userId))
    .where(inArray(customerAccounts.customerId, ids));
  for (const a of accounts) result.get(a.customerId)!.accessStatus = a.status;

  const open = await db.execute<{ customer_id: string; n: number }>(sql`
    SELECT i.customer_id, count(*)::int AS n FROM ${invoices} i
    WHERE i.status = 'issued' AND i.customer_id IN (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})
      AND i.total_gross_cents > COALESCE((SELECT sum(p.amount_cents) FROM ${payments} p WHERE p.invoice_id = i.id), 0)
    GROUP BY i.customer_id`);
  for (const r of open.rows) result.get(r.customer_id)!.openInvoiceCount = r.n;
  return result;
}

export function toCustomerSummary(
  c: CustomerRow,
  stats: { vehicleCount: number; accessStatus: CustomerAccessStatus; openInvoiceCount: number },
  actor: Actor,
): CustomerSummary {
  const summary: CustomerSummary = {
    id: c.id,
    customerNumber: c.customerNumber,
    kind: c.kind,
    displayName: customerDisplayName(c),
    email: c.email,
    phone: c.phone ?? c.mobile,
    vehicleCount: stats.vehicleCount,
    accessStatus: stats.accessStatus,
    isTestData: c.isTestData,
  };
  if (actor.role !== 'customer' && actor.permissions.has('invoices.read')) summary.openInvoiceCount = stats.openInvoiceCount;
  return summary;
}

export async function toCustomerDetail(db: DbOrTx, c: CustomerRow, actor: Actor): Promise<CustomerDetail> {
  const stats = (await customerStats(db, [c.id])).get(c.id)!;
  const detail: CustomerDetail = {
    ...toCustomerSummary(c, stats, actor),
    salutation: c.salutation,
    firstName: c.firstName,
    lastName: c.lastName,
    companyName: c.companyName,
    mobile: c.mobile,
    street: c.street,
    postalCode: c.postalCode,
    city: c.city,
    country: c.country,
    createdAt: c.createdAt.toISOString(),
    archivedAt: c.archivedAt ? c.archivedAt.toISOString() : null,
  };
  if (actor.role !== 'customer') detail.notesInternal = c.notesInternal;
  return detail;
}

/** Nächste Kundennummer (K-10001, K-10002, …), atomar. */
export async function nextCustomerNumber(db: DbOrTx): Promise<string> {
  const rows = await db.execute<{ value: number }>(sql`
    INSERT INTO counters (key, value) VALUES ('customer', 10001)
    ON CONFLICT (key) DO UPDATE SET value = counters.value + 1
    RETURNING value`);
  return `K-${rows.rows[0]!.value}`;
}

/** Nächste Auftragsnummer je Jahr (A-2026-0001), atomar. */
export async function nextOrderNumber(db: DbOrTx, year: number): Promise<string> {
  const rows = await db.execute<{ value: number }>(sql`
    INSERT INTO counters (key, value) VALUES (${`work_order:${year}`}, 1)
    ON CONFLICT (key) DO UPDATE SET value = counters.value + 1
    RETURNING value`);
  return `A-${year}-${String(rows.rows[0]!.value).padStart(4, '0')}`;
}
