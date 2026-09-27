/** 3. Kunden und Fahrzeuge */
import { sql } from 'drizzle-orm';
import { boolean, char, check, date, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import {
  citext,
  createdAt,
  customerKindEnum,
  odometerPlausibilityEnum,
  odometerSourceEnum,
  pk,
  tstz,
  updatedAt,
} from './common';
import { users } from './accounts';
import { workOrders } from './workOrders';

export const customers = pgTable(
  'customers',
  {
    id: pk(),
    customerNumber: text('customer_number').notNull().unique(),
    kind: customerKindEnum('kind').notNull(),
    salutation: text('salutation'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    companyName: text('company_name'),
    email: citext('email'),
    phone: text('phone'),
    mobile: text('mobile'),
    street: text('street'),
    postalCode: text('postal_code'),
    city: text('city'),
    country: char('country', { length: 2 }).notNull().default('DE'),
    notesInternal: text('notes_internal'),
    archivedAt: tstz('archived_at'),
    isTestData: boolean('is_test_data').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('customers_last_name_idx').on(t.lastName), index('customers_email_idx').on(t.email)],
);

export const vehicles = pgTable(
  'vehicles',
  {
    id: pk(),
    licensePlate: text('license_plate').notNull(),
    /** Normalisiert (Großbuchstaben, ohne Leer- und Trennzeichen) für die Suche */
    licensePlateNormalized: text('license_plate_normalized').notNull(),
    vin: text('vin').unique(),
    hsn: text('hsn'),
    tsn: text('tsn'),
    make: text('make').notNull(),
    model: text('model').notNull(),
    variant: text('variant'),
    firstRegistration: date('first_registration', { mode: 'string' }),
    fuelType: text('fuel_type'),
    color: text('color'),
    notesInternal: text('notes_internal'),
    /** Zufällig (≥ 128 Bit), stabil; Rotation nur bei Verlust/Missbrauch */
    qrToken: text('qr_token').notNull().unique(),
    qrPublicViewEnabled: boolean('qr_public_view_enabled').notNull().default(false),
    archivedAt: tstz('archived_at'),
    isTestData: boolean('is_test_data').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('vehicles_plate_idx').on(t.licensePlateNormalized)],
);

export const vehicleOwnerships = pgTable(
  'vehicle_ownerships',
  {
    id: pk(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    startedAt: tstz('started_at').notNull(),
    endedAt: tstz('ended_at'),
    createdBy: uuid('created_by').references(() => users.id),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    /** höchstens ein aktueller Halter je Fahrzeug */
    uniqueIndex('vehicle_ownerships_current_uq').on(t.vehicleId).where(sql`${t.endedAt} IS NULL`),
    index('vehicle_ownerships_customer_idx').on(t.customerId),
    check('vehicle_ownerships_period', sql`${t.endedAt} IS NULL OR ${t.endedAt} >= ${t.startedAt}`),
  ],
);

export const odometerReadings = pgTable(
  'odometer_readings',
  {
    id: pk(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    valueKm: integer('value_km').notNull(),
    recordedAt: tstz('recorded_at').notNull(),
    source: odometerSourceEnum('source').notNull(),
    workOrderId: uuid('work_order_id').references(() => workOrders.id),
    recordedBy: uuid('recorded_by').references(() => users.id),
    plausibility: odometerPlausibilityEnum('plausibility').notNull().default('ok'),
    createdAt: createdAt(),
  },
  (t) => [
    index('odometer_readings_vehicle_idx').on(t.vehicleId, t.recordedAt),
    check('odometer_readings_value', sql`${t.valueKm} >= 0`),
  ],
);
