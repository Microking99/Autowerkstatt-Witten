/** 4. Termine */
import { sql } from 'drizzle-orm';
import { check, index, numeric, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import {
  appointmentKindEnum,
  appointmentStatusEnum,
  createdAt,
  partDemandStatusEnum,
  pk,
  proposalStatusEnum,
  requestedByEnum,
  tstz,
  updatedAt,
} from './common';
import { users } from './accounts';
import { customers, vehicles } from './customers';
import { resources } from './workshop';
import { workOrders } from './workOrders';

export const appointments = pgTable(
  'appointments',
  {
    id: pk(),
    kind: appointmentKindEnum('kind').notNull(),
    /** `requested` ist keine Buchung (R-KAL-5) */
    status: appointmentStatusEnum('status').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    workOrderId: uuid('work_order_id').references(() => workOrders.id),
    startsAt: tstz('starts_at').notNull(),
    endsAt: tstz('ends_at').notNull(),
    resourceId: uuid('resource_id').references(() => resources.id),
    requestedBy: requestedByEnum('requested_by').notNull(),
    customerNote: text('customer_note'),
    internalNote: text('internal_note'),
    /** Begründung, wenn trotz erkannter Konflikte gespeichert wurde */
    conflictOverrideReason: text('conflict_override_reason'),
    confirmedAt: tstz('confirmed_at'),
    confirmedBy: uuid('confirmed_by').references(() => users.id),
    cancelledAt: tstz('cancelled_at'),
    cancelReason: text('cancel_reason'),
    cancelledBy: uuid('cancelled_by').references(() => users.id),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('appointments_time_idx').on(t.startsAt, t.endsAt),
    index('appointments_customer_idx').on(t.customerId),
    check('appointments_period', sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

export const appointmentAssignees = pgTable(
  'appointment_assignees',
  {
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => appointments.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.appointmentId, t.userId] })],
);

export const appointmentProposals = pgTable(
  'appointment_proposals',
  {
    id: pk(),
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => appointments.id),
    startsAt: tstz('starts_at').notNull(),
    endsAt: tstz('ends_at').notNull(),
    status: proposalStatusEnum('status').notNull().default('open'),
    message: text('message'),
    proposedBy: uuid('proposed_by').references(() => users.id),
    respondedAt: tstz('responded_at'),
    createdAt: createdAt(),
  },
  (t) => [index('appointment_proposals_appointment_idx').on(t.appointmentId)],
);

export const partDemands = pgTable(
  'part_demands',
  {
    id: pk(),
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id),
    description: text('description').notNull(),
    partNumber: text('part_number'),
    quantity: numeric('quantity', { precision: 12, scale: 3, mode: 'number' }).notNull().default(1),
    status: partDemandStatusEnum('status').notNull().default('needed'),
    expectedAt: tstz('expected_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('part_demands_work_order_idx').on(t.workOrderId)],
);
