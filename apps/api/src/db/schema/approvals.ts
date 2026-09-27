/** 6. Freigaben (R-FRG) */
import { char, index, integer, jsonb, pgTable, text, unique, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  approvalDecisionEnum,
  approvalKindEnum,
  approvalRequestStatusEnum,
  clientChannelEnum,
  createdAt,
  pk,
  tstz,
  updatedAt,
} from './common';
import { users } from './accounts';
import { customers } from './customers';
import { findings, workOrders } from './workOrders';
import { documentVersions } from './documents';

export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: pk(),
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id),
    kind: approvalKindEnum('kind').notNull(),
    title: text('title').notNull(),
    status: approvalRequestStatusEnum('status').notNull().default('draft'),
    currentVersionId: uuid('current_version_id').references((): AnyPgColumn => approvalVersions.id),
    findingId: uuid('finding_id').references(() => findings.id),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('approval_requests_work_order_idx').on(t.workOrderId)],
);

/** Snapshot einer Position in einer Freigabeversion (unveränderlich nach dem Senden). */
export interface ApprovalLineSnapshot {
  title: string;
  description: string | null;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  vatRateBp: number;
  maintenanceTypeId: string | null;
  /** zugehörige Position im Auftrag */
  workItemId?: string;
}

export const approvalVersions = pgTable(
  'approval_versions',
  {
    id: pk(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => approvalRequests.id),
    versionNo: integer('version_no').notNull(),
    summaryCustomer: text('summary_customer').notNull(),
    items: jsonb('items').$type<ApprovalLineSnapshot[]>().notNull(),
    totalNetCents: integer('total_net_cents').notNull(),
    totalGrossCents: integer('total_gross_cents').notNull(),
    currency: char('currency', { length: 3 }).notNull().default('EUR'),
    scheduleChange: text('schedule_change'),
    newReadyAt: tstz('new_ready_at'),
    photoIds: jsonb('photo_ids').$type<string[]>().notNull().default([]),
    documentVersionId: uuid('document_version_id').references((): AnyPgColumn => documentVersions.id),
    /** SHA-256 des kanonischen Inhalts */
    contentHash: text('content_hash').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    sentAt: tstz('sent_at'),
    supersededAt: tstz('superseded_at'),
    createdAt: createdAt(),
  },
  (t) => [unique('approval_versions_request_no_uq').on(t.requestId, t.versionNo)],
);

export const approvalDecisions = pgTable('approval_decisions', {
  id: pk(),
  /** genau eine Entscheidung je Version */
  versionId: uuid('version_id')
    .notNull()
    .unique()
    .references(() => approvalVersions.id),
  decision: approvalDecisionEnum('decision').notNull(),
  decidedByUserId: uuid('decided_by_user_id')
    .notNull()
    .references(() => users.id),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id),
  decidedAt: tstz('decided_at').notNull().defaultNow(),
  contentHash: text('content_hash').notNull(),
  channel: clientChannelEnum('channel').notNull(),
  comment: text('comment'),
  ip: text('ip'),
  userAgent: text('user_agent'),
});
