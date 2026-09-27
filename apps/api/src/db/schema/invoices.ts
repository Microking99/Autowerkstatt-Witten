/** 8. Rechnungen und Zahlungen (R-ZAHL) */
import { sql } from 'drizzle-orm';
import { char, check, date, index, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import {
  checkoutStatusEnum,
  createdAt,
  invoiceStatusEnum,
  paymentMethodEnum,
  paymentProviderEnum,
  pk,
  refundStatusEnum,
  tstz,
  updatedAt,
} from './common';
import { users } from './accounts';
import { customers } from './customers';
import { workOrders } from './workOrders';
import { documents } from './documents';

export interface VatBreakdownEntry {
  vatRateBp: number;
  netCents: number;
  vatCents: number;
}

export const invoices = pgTable(
  'invoices',
  {
    id: pk(),
    /** null im Entwurf */
    invoiceNumber: text('invoice_number').unique(),
    workOrderId: uuid('work_order_id').references(() => workOrders.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    status: invoiceStatusEnum('status').notNull().default('draft'),
    issuedAt: tstz('issued_at'),
    dueDate: date('due_date', { mode: 'string' }),
    totalGrossCents: integer('total_gross_cents').notNull(),
    currency: char('currency', { length: 3 }).notNull().default('EUR'),
    vatBreakdown: jsonb('vat_breakdown').$type<VatBreakdownEntry[]>().notNull().default([]),
    documentId: uuid('document_id').references(() => documents.id),
    cancelledAt: tstz('cancelled_at'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('invoices_customer_idx').on(t.customerId),
    index('invoices_work_order_idx').on(t.workOrderId),
    check('invoices_total_positive', sql`${t.totalGrossCents} > 0`),
  ],
);

export const checkouts = pgTable(
  'checkouts',
  {
    id: pk(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    provider: paymentProviderEnum('provider').notNull(),
    /** eigene, eindeutige Referenz (wird beim Anbieter hinterlegt) */
    checkoutReference: text('checkout_reference').notNull().unique(),
    providerCheckoutId: text('provider_checkout_id').unique(),
    amountCents: integer('amount_cents').notNull(),
    currency: char('currency', { length: 3 }).notNull().default('EUR'),
    /** Händlerkennung, unter der der Checkout angelegt wurde (Abgleich) */
    merchantCode: text('merchant_code').notNull(),
    status: checkoutStatusEnum('status').notNull().default('created'),
    hostedUrl: text('hosted_url'),
    validUntil: tstz('valid_until'),
    lastCheckedAt: tstz('last_checked_at'),
    providerTransactionId: text('provider_transaction_id'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('checkouts_invoice_idx').on(t.invoiceId), index('checkouts_status_idx').on(t.status)],
);

export const payments = pgTable(
  'payments',
  {
    id: pk(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    method: paymentMethodEnum('method').notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: char('currency', { length: 3 }).notNull().default('EUR'),
    provider: paymentProviderEnum('provider'),
    providerTransactionId: text('provider_transaction_id'),
    checkoutId: uuid('checkout_id').references(() => checkouts.id),
    receivedAt: tstz('received_at').notNull(),
    recordedBy: uuid('recorded_by').references(() => users.id),
    referenceText: text('reference_text'),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    /** keine Doppelbuchung derselben Anbietertransaktion */
    unique('payments_provider_txn_uq').on(t.provider, t.providerTransactionId),
    index('payments_invoice_idx').on(t.invoiceId),
    check('payments_amount_positive', sql`${t.amountCents} > 0`),
  ],
);

export const refunds = pgTable(
  'refunds',
  {
    id: pk(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id),
    amountCents: integer('amount_cents').notNull(),
    status: refundStatusEnum('status').notNull().default('requested'),
    /** eigene Idempotenz, weil der Anbieter keine anbietet */
    idempotencyKey: text('idempotency_key').notNull().unique(),
    providerRefundId: text('provider_refund_id'),
    reason: text('reason'),
    requestedBy: uuid('requested_by').references(() => users.id),
    requestedAt: tstz('requested_at').notNull().defaultNow(),
    completedAt: tstz('completed_at'),
    failureReason: text('failure_reason'),
  },
  (t) => [index('refunds_payment_idx').on(t.paymentId), check('refunds_amount_positive', sql`${t.amountCents} > 0`)],
);

export const providerEvents = pgTable('provider_events', {
  id: pk(),
  provider: paymentProviderEnum('provider').notNull(),
  eventType: text('event_type').notNull(),
  providerObjectId: text('provider_object_id'),
  payload: jsonb('payload').$type<unknown>().notNull(),
  dedupeKey: text('dedupe_key').notNull().unique(),
  receiveCount: integer('receive_count').notNull().default(1),
  firstReceivedAt: tstz('first_received_at').notNull().defaultNow(),
  lastReceivedAt: tstz('last_received_at').notNull().defaultNow(),
  processedAt: tstz('processed_at'),
  result: text('result'),
});
