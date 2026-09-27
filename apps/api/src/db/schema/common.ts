/**
 * Gemeinsame Bausteine für das Drizzle-Schema (docs/datenmodell.md, Konventionen).
 */
import { customType, pgEnum, timestamp, uuid } from 'drizzle-orm/pg-core';
import {
  APPOINTMENT_KINDS,
  APPOINTMENT_STATUSES,
  APPROVAL_DECISIONS,
  APPROVAL_KINDS,
  APPROVAL_REQUEST_STATUSES,
  CHECKOUT_STATUSES,
  CLIENT_CHANNELS,
  CUSTOMER_KINDS,
  DOCUMENT_KINDS,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  INTAKE_CONFIRMATION_METHODS,
  INVOICE_STATUSES,
  NOTIFICATION_CHANNELS,
  ODOMETER_SOURCES,
  PAYMENT_METHODS,
  PERMISSIONS,
  PHOTO_CONTEXTS,
  PROPOSAL_STATUSES,
  REFUND_STATUSES,
  RESOURCE_KINDS,
  ROLES,
  SERVICE_ENTRY_STATUSES,
  USER_STATUSES,
  VISIBILITIES,
  WORK_ITEM_AUTHORIZATIONS,
  WORK_ITEM_EXECUTION_STATUSES,
  WORK_ITEM_KINDS,
  WORK_ITEM_ORIGINS,
  WORK_ORDER_STATUSES,
} from '@werkstatt/contracts';

/** Groß-/Kleinschreibung-unabhängiger Text (Erweiterung `citext`), für E-Mail-Adressen. */
export const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

export const pk = () => uuid('id').primaryKey().defaultRandom();
export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
export const createdAt = () => tstz('created_at').notNull().defaultNow();
export const updatedAt = () =>
  tstz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// Aufzählungen als PostgreSQL-Enums (Werte aus packages/contracts) --------------------------

export const roleEnum = pgEnum('role', ROLES);
export const userStatusEnum = pgEnum('user_status', USER_STATUSES);
export const permissionEnum = pgEnum('permission', PERMISSIONS);
export const invitationPurposeEnum = pgEnum('invitation_purpose', ['staff', 'customer']);
export const devicePlatformEnum = pgEnum('device_platform', CLIENT_CHANNELS);
export const notificationChannelEnum = pgEnum('notification_channel', NOTIFICATION_CHANNELS);
export const notificationStatusEnum = pgEnum('notification_status', ['pending', 'sent', 'failed', 'cancelled']);
export const customerKindEnum = pgEnum('customer_kind', CUSTOMER_KINDS);
export const odometerSourceEnum = pgEnum('odometer_source', ODOMETER_SOURCES);
export const odometerPlausibilityEnum = pgEnum('odometer_plausibility', ['ok', 'lower_than_previous']);
export const resourceKindEnum = pgEnum('resource_kind', RESOURCE_KINDS);
export const paymentProviderSettingEnum = pgEnum('payment_provider_setting', ['none', 'sumup']);
export const appointmentKindEnum = pgEnum('appointment_kind', APPOINTMENT_KINDS);
export const appointmentStatusEnum = pgEnum('appointment_status', APPOINTMENT_STATUSES);
export const requestedByEnum = pgEnum('requested_by', ['customer', 'staff']);
export const proposalStatusEnum = pgEnum('proposal_status', PROPOSAL_STATUSES);
export const partDemandStatusEnum = pgEnum('part_demand_status', ['needed', 'ordered', 'received', 'installed']);
export const workOrderStatusEnum = pgEnum('work_order_status', WORK_ORDER_STATUSES);
export const workItemKindEnum = pgEnum('work_item_kind', WORK_ITEM_KINDS);
export const workItemOriginEnum = pgEnum('work_item_origin', WORK_ITEM_ORIGINS);
export const workItemAuthorizationEnum = pgEnum('work_item_authorization', WORK_ITEM_AUTHORIZATIONS);
export const workItemExecutionStatusEnum = pgEnum('work_item_execution_status', WORK_ITEM_EXECUTION_STATUSES);
export const timeEntrySourceEnum = pgEnum('time_entry_source', ['timer', 'manual']);
export const findingSeverityEnum = pgEnum('finding_severity', FINDING_SEVERITIES);
export const findingStatusEnum = pgEnum('finding_status', FINDING_STATUSES);
export const intakeConfirmationMethodEnum = pgEnum('intake_confirmation_method', INTAKE_CONFIRMATION_METHODS);
export const photoContextEnum = pgEnum('photo_context', PHOTO_CONTEXTS);
export const visibilityEnum = pgEnum('visibility', VISIBILITIES);
export const approvalKindEnum = pgEnum('approval_kind', APPROVAL_KINDS);
export const approvalRequestStatusEnum = pgEnum('approval_request_status', APPROVAL_REQUEST_STATUSES);
export const approvalDecisionEnum = pgEnum('approval_decision', APPROVAL_DECISIONS);
export const clientChannelEnum = pgEnum('client_channel', CLIENT_CHANNELS);
export const documentKindEnum = pgEnum('document_kind', DOCUMENT_KINDS);
export const invoiceStatusEnum = pgEnum('invoice_status', INVOICE_STATUSES);
export const paymentProviderEnum = pgEnum('payment_provider', ['sumup']);
export const checkoutStatusEnum = pgEnum('checkout_status', CHECKOUT_STATUSES);
export const paymentMethodEnum = pgEnum('payment_method', PAYMENT_METHODS);
export const refundStatusEnum = pgEnum('refund_status', REFUND_STATUSES);
export const serviceEntryStatusEnum = pgEnum('service_entry_status', SERVICE_ENTRY_STATUSES);
export const serviceEntrySourceEnum = pgEnum('service_entry_source', ['work_completion']);
