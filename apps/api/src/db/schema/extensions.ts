/**
 * 11. Ergänzungen [E]: Modell vorbereitet, fachliche Details offen (O-6, O-7, O-8).
 * Es gibt dazu noch keine API-Endpunkte.
 */
import { boolean, date, index, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, tstz, updatedAt } from './common';
import { customers, vehicles } from './customers';
import { workOrders } from './workOrders';
import { users } from './accounts';

export const inventoryItems = pgTable('inventory_items', {
  id: pk(),
  partNumber: text('part_number'),
  description: text('description').notNull(),
  stockQuantity: numeric('stock_quantity', { precision: 12, scale: 3, mode: 'number' }).notNull().default(0),
  minimumQuantity: numeric('minimum_quantity', { precision: 12, scale: 3, mode: 'number' }),
  location: text('location'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const tireStorage = pgTable(
  'tire_storage',
  {
    id: pk(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id),
    season: text('season').notNull(),
    storageLocation: text('storage_location'),
    dimension: text('dimension'),
    dot: text('dot'),
    treadDepthsMm: text('tread_depths_mm'),
    storedAt: date('stored_at', { mode: 'string' }),
    returnedAt: date('returned_at', { mode: 'string' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('tire_storage_customer_idx').on(t.customerId)],
);

export const loanCars = pgTable('loan_cars', {
  id: pk(),
  licensePlate: text('license_plate').notNull(),
  make: text('make').notNull(),
  model: text('model').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const loanCarBookings = pgTable(
  'loan_car_bookings',
  {
    id: pk(),
    loanCarId: uuid('loan_car_id')
      .notNull()
      .references(() => loanCars.id),
    workOrderId: uuid('work_order_id').references(() => workOrders.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    startsAt: tstz('starts_at').notNull(),
    endsAt: tstz('ends_at').notNull(),
    handoverNotes: text('handover_notes'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('loan_car_bookings_car_idx').on(t.loanCarId, t.startsAt)],
);
