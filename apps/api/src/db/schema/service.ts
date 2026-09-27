/** 9. Servicehistorie und Freigaben für Dritte (R-SERV, R-QR) */
import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, pgTable, text, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { createdAt, pk, serviceEntryStatusEnum, serviceEntrySourceEnum, tstz } from './common';
import { users } from './accounts';
import { customers, vehicles } from './customers';
import { workItems, workOrders } from './workOrders';
import { maintenanceTypes } from './workshop';

export const serviceEntries = pgTable(
  'service_entries',
  {
    id: pk(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItems.id),
    maintenanceTypeId: uuid('maintenance_type_id').references(() => maintenanceTypes.id),
    performedOn: date('performed_on', { mode: 'string' }).notNull(),
    /** null = unbekannt */
    odometerKm: integer('odometer_km'),
    title: text('title').notNull(),
    details: text('details'),
    workshopName: text('workshop_name').notNull(),
    intervalKm: integer('interval_km'),
    intervalMonths: integer('interval_months'),
    nextDueDate: date('next_due_date', { mode: 'string' }),
    nextDueKm: integer('next_due_km'),
    status: serviceEntryStatusEnum('status').notNull().default('valid'),
    /** Vorgänger, den diese Revision ersetzt */
    revisionOfId: uuid('revision_of_id').references((): AnyPgColumn => serviceEntries.id),
    revisionNo: integer('revision_no').notNull().default(1),
    correctionReason: text('correction_reason'),
    source: serviceEntrySourceEnum('source').notNull().default('work_completion'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    /** genau ein Ursprungseintrag je Position */
    uniqueIndex('service_entries_origin_uq').on(t.workItemId).where(sql`${t.revisionOfId} IS NULL`),
    /** keine Verzweigung: jede Revision hat höchstens einen Nachfolger */
    uniqueIndex('service_entries_revision_uq').on(t.revisionOfId).where(sql`${t.revisionOfId} IS NOT NULL`),
    index('service_entries_vehicle_idx').on(t.vehicleId, t.performedOn),
  ],
);

export const vehicleShares = pgTable(
  'vehicle_shares',
  {
    id: pk(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    /** SHA-256 des Tokens; der Link wird nur einmal in der Anlage-Antwort ausgegeben */
    tokenHash: text('token_hash').notNull().unique(),
    label: text('label').notNull(),
    includeVin: boolean('include_vin').notNull().default(false),
    serviceEntryIds: uuid('service_entry_ids').array().notNull(),
    expiresAt: tstz('expires_at').notNull(),
    revokedAt: tstz('revoked_at'),
    accessCount: integer('access_count').notNull().default(0),
    lastAccessedAt: tstz('last_accessed_at'),
    createdAt: createdAt(),
  },
  (t) => [index('vehicle_shares_vehicle_idx').on(t.vehicleId)],
);
