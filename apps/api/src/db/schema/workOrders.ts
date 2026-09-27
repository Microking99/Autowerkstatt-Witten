/** 5. Aufträge und Ausführung */
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  createdAt,
  findingSeverityEnum,
  findingStatusEnum,
  intakeConfirmationMethodEnum,
  photoContextEnum,
  pk,
  timeEntrySourceEnum,
  tstz,
  updatedAt,
  visibilityEnum,
  workItemAuthorizationEnum,
  workItemExecutionStatusEnum,
  workItemKindEnum,
  workItemOriginEnum,
  workOrderStatusEnum,
} from './common';
import { users } from './accounts';
import { customers, vehicles } from './customers';
import { maintenanceTypes } from './workshop';
import { approvalRequests, approvalVersions } from './approvals';
import { files } from './documents';

export const workOrders = pgTable(
  'work_orders',
  {
    id: pk(),
    orderNumber: text('order_number').notNull().unique(),
    /** Bei Anlage festgeschrieben; bleibt auch nach Halterwechsel (Aufträge gehören dem Kunden) */
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    status: workOrderStatusEnum('status').notNull().default('draft'),
    title: text('title').notNull(),
    descriptionCustomer: text('description_customer'),
    notesInternal: text('notes_internal'),
    costLimitCents: integer('cost_limit_cents'),
    plannedStart: tstz('planned_start'),
    plannedEnd: tstz('planned_end'),
    readyForPickupAt: tstz('ready_for_pickup_at'),
    pickedUpAt: tstz('picked_up_at'),
    completionReviewedAt: tstz('completion_reviewed_at'),
    completionReviewedBy: uuid('completion_reviewed_by').references(() => users.id),
    cancelledAt: tstz('cancelled_at'),
    cancelReason: text('cancel_reason'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('work_orders_customer_idx').on(t.customerId),
    index('work_orders_vehicle_idx').on(t.vehicleId),
    index('work_orders_status_idx').on(t.status),
  ],
);

export const workOrderAssignees = pgTable(
  'work_order_assignees',
  {
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.workOrderId, t.userId] }), index('work_order_assignees_user_idx').on(t.userId)],
);

export const workItems = pgTable(
  'work_items',
  {
    id: pk(),
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id),
    position: integer('position').notNull(),
    kind: workItemKindEnum('kind').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    maintenanceTypeId: uuid('maintenance_type_id').references(() => maintenanceTypes.id),
    intervalKm: integer('interval_km'),
    intervalMonths: integer('interval_months'),
    quantity: numeric('quantity', { precision: 12, scale: 3, mode: 'number' }).notNull().default(1),
    unit: text('unit').notNull().default('Stk'),
    unitPriceCents: integer('unit_price_cents'),
    vatRateBp: integer('vat_rate_bp').notNull().default(1900),
    origin: workItemOriginEnum('origin').notNull(),
    /** Ausführung nur bei agreed/approved */
    authorization: workItemAuthorizationEnum('authorization').notNull(),
    executionStatus: workItemExecutionStatusEnum('execution_status').notNull().default('planned'),
    approvalRequestId: uuid('approval_request_id').references((): AnyPgColumn => approvalRequests.id),
    approvedVersionId: uuid('approved_version_id').references((): AnyPgColumn => approvalVersions.id),
    assignedTo: uuid('assigned_to').references(() => users.id),
    doneAt: tstz('done_at'),
    doneBy: uuid('done_by').references(() => users.id),
    doneOdometerKm: integer('done_odometer_km'),
    resultNotes: text('result_notes'),
    notDoneReason: text('not_done_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('work_items_work_order_idx').on(t.workOrderId),
    index('work_items_assigned_idx').on(t.assignedTo),
    index('work_items_approval_request_idx').on(t.approvalRequestId),
  ],
);

export const timeEntries = pgTable(
  'time_entries',
  {
    id: pk(),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItems.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    startedAt: tstz('started_at').notNull(),
    endedAt: tstz('ended_at'),
    source: timeEntrySourceEnum('source').notNull().default('timer'),
    createdAt: createdAt(),
  },
  (t) => [index('time_entries_item_idx').on(t.workItemId)],
);

export const partsUsed = pgTable(
  'parts_used',
  {
    id: pk(),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItems.id),
    partNumber: text('part_number'),
    description: text('description').notNull(),
    quantity: numeric('quantity', { precision: 12, scale: 3, mode: 'number' }).notNull(),
    unitPriceCents: integer('unit_price_cents'),
    recordedBy: uuid('recorded_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('parts_used_item_idx').on(t.workItemId)],
);

export const findings = pgTable(
  'findings',
  {
    /** Clients dürfen offline eigene UUIDs vergeben */
    id: pk(),
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id),
    workItemId: uuid('work_item_id').references(() => workItems.id),
    description: text('description').notNull(),
    severity: findingSeverityEnum('severity').notNull(),
    status: findingStatusEnum('status').notNull().default('new'),
    reportedBy: uuid('reported_by')
      .notNull()
      .references(() => users.id),
    reportedAt: tstz('reported_at'),
    dictated: boolean('dictated').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('findings_work_order_idx').on(t.workOrderId)],
);

export interface IntakeDamage {
  area: string;
  description: string;
  photoId: string | null;
}

export const intakes = pgTable('intakes', {
  id: pk(),
  workOrderId: uuid('work_order_id')
    .notNull()
    .unique()
    .references(() => workOrders.id),
  vehicleId: uuid('vehicle_id')
    .notNull()
    .references(() => vehicles.id),
  odometerKm: integer('odometer_km'),
  fuelLevel: text('fuel_level'),
  customerComplaint: text('customer_complaint').notNull(),
  damages: jsonb('damages').$type<IntakeDamage[]>().notNull().default([]),
  agreedServices: text('agreed_services').notNull().default(''),
  costLimitCents: integer('cost_limit_cents'),
  notesInternal: text('notes_internal'),
  notesCustomer: text('notes_customer'),
  confirmedAt: tstz('confirmed_at'),
  confirmationMethod: intakeConfirmationMethodEnum('confirmation_method').notNull().default('none'),
  confirmedByUserId: uuid('confirmed_by_user_id').references(() => users.id),
  /** SHA-256 des kanonischen, kundenbestimmten Inhalts zum Zeitpunkt der Bestätigung */
  contentHash: text('content_hash'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const photos = pgTable(
  'photos',
  {
    id: pk(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id),
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id),
    context: photoContextEnum('context').notNull(),
    findingId: uuid('finding_id').references(() => findings.id),
    /** Standard intern */
    visibility: visibilityEnum('visibility').notNull().default('internal'),
    caption: text('caption'),
    takenBy: uuid('taken_by').references(() => users.id),
    takenAt: tstz('taken_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('photos_work_order_idx').on(t.workOrderId), index('photos_finding_idx').on(t.findingId)],
);

// [E] Abschlusschecklisten (R-ERG-5, O-10): Modell vorbereitet ----------------------------

export interface ChecklistPoint {
  key: string;
  label: string;
  required: boolean;
}

export const checklistTemplates = pgTable('checklist_templates', {
  id: pk(),
  name: text('name').notNull(),
  points: jsonb('points').$type<ChecklistPoint[]>().notNull().default([]),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const checklistRuns = pgTable(
  'checklist_runs',
  {
    id: pk(),
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id),
    templateId: uuid('template_id')
      .notNull()
      .references(() => checklistTemplates.id),
    results: jsonb('results').$type<Record<string, { ok: boolean; note?: string }>>().notNull().default({}),
    completedAt: tstz('completed_at'),
    completedBy: uuid('completed_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('checklist_runs_uq').on(t.workOrderId, t.templateId)],
);
