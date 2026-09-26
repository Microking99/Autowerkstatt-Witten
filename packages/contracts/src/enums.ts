/**
 * Aufzählungen, die API, Geschäftslogik und Clients teilen.
 * Bedeutungen: docs/datenmodell.md, docs/rollen-und-rechte.md
 */
import { z } from 'zod';

export const ROLES = ['admin', 'service', 'mechanic', 'customer'] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;
export const STAFF_ROLES = ['admin', 'service', 'mechanic'] as const satisfies readonly Role[];

export const USER_STATUSES = ['invited', 'active', 'disabled'] as const;
export const UserStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = z.infer<typeof UserStatusSchema>;

/** Rechtekatalog (Schlüssel). Standardzuordnung je Rolle: packages/domain/src/permissions. */
export const PERMISSIONS = [
  'dashboard.view',
  'customers.read',
  'customers.write',
  'customerAccounts.manage',
  'vehicles.read',
  'vehicles.write',
  'vehicles.transferOwnership',
  'appointments.read',
  'appointments.write',
  'workOrders.read',
  'workOrders.write',
  'workOrders.completeReview',
  'workItems.execute',
  'intake.write',
  'findings.write',
  'approvals.request',
  'documents.readInternal',
  'documents.write',
  'documents.publish',
  'messages.customerChat',
  'invoices.read',
  'invoices.write',
  'payments.recordManual',
  'payments.refund',
  'serviceHistory.read',
  'serviceHistory.correct',
  'reports.export',
  'users.manage',
  'settings.manage',
  'audit.read',
] as const;
export const PermissionSchema = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof PermissionSchema>;

export const CUSTOMER_KINDS = ['private', 'business'] as const;
export const CustomerKindSchema = z.enum(CUSTOMER_KINDS);
export type CustomerKind = z.infer<typeof CustomerKindSchema>;

/** Zugangsstatus eines Kundendatensatzes zur App (abgeleitet). */
export const CUSTOMER_ACCESS_STATUSES = ['none', 'invited', 'active', 'disabled'] as const;
export const CustomerAccessStatusSchema = z.enum(CUSTOMER_ACCESS_STATUSES);
export type CustomerAccessStatus = z.infer<typeof CustomerAccessStatusSchema>;

export const ODOMETER_SOURCES = ['intake', 'work_completion', 'customer', 'staff'] as const;
export const OdometerSourceSchema = z.enum(ODOMETER_SOURCES);
export type OdometerSource = z.infer<typeof OdometerSourceSchema>;

export const APPOINTMENT_KINDS = ['inspection_hu', 'service', 'repair', 'tire_change', 'other'] as const;
export const AppointmentKindSchema = z.enum(APPOINTMENT_KINDS);
export type AppointmentKind = z.infer<typeof AppointmentKindSchema>;

export const APPOINTMENT_STATUSES = ['requested', 'proposed', 'confirmed', 'cancelled', 'completed', 'no_show'] as const;
export const AppointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);
export type AppointmentStatus = z.infer<typeof AppointmentStatusSchema>;

export const PROPOSAL_STATUSES = ['open', 'accepted', 'declined', 'superseded'] as const;
export const ProposalStatusSchema = z.enum(PROPOSAL_STATUSES);
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

export const RESOURCE_KINDS = ['lift', 'bay', 'diagnosis', 'other'] as const;
export const ResourceKindSchema = z.enum(RESOURCE_KINDS);
export type ResourceKind = z.infer<typeof ResourceKindSchema>;

/** Arbeitsstatus eines Auftrags (getrennt von Freigabe- und Zahlungsstatus). */
export const WORK_ORDER_STATUSES = [
  'draft',
  'open',
  'in_progress',
  'work_completed',
  'completed',
  'picked_up',
  'cancelled',
] as const;
export const WorkOrderStatusSchema = z.enum(WORK_ORDER_STATUSES);
export type WorkOrderStatus = z.infer<typeof WorkOrderStatusSchema>;

/** Freigabestatus eines Auftrags (berechnet). */
export const APPROVAL_OVERVIEW_STATUSES = ['none', 'pending', 'decided'] as const;
export const ApprovalOverviewStatusSchema = z.enum(APPROVAL_OVERVIEW_STATUSES);
export type ApprovalOverviewStatus = z.infer<typeof ApprovalOverviewStatusSchema>;

/** Zahlungsstatus eines Auftrags bzw. einer Rechnung (berechnet). */
export const PAYMENT_STATUSES = [
  'no_invoice',
  'open',
  'partially_paid',
  'paid',
  'partially_refunded',
  'refunded',
  'cancelled',
] as const;
export const PaymentStatusSchema = z.enum(PAYMENT_STATUSES);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const WORK_ITEM_KINDS = ['labor', 'part', 'flat_rate', 'other'] as const;
export const WorkItemKindSchema = z.enum(WORK_ITEM_KINDS);
export type WorkItemKind = z.infer<typeof WorkItemKindSchema>;

export const WORK_ITEM_ORIGINS = ['intake', 'offer', 'additional'] as const;
export const WorkItemOriginSchema = z.enum(WORK_ITEM_ORIGINS);
export type WorkItemOrigin = z.infer<typeof WorkItemOriginSchema>;

/** Wodurch eine Position gedeckt ist. */
export const WORK_ITEM_AUTHORIZATIONS = ['agreed', 'pending_approval', 'approved', 'rejected', 'withdrawn'] as const;
export const WorkItemAuthorizationSchema = z.enum(WORK_ITEM_AUTHORIZATIONS);
export type WorkItemAuthorization = z.infer<typeof WorkItemAuthorizationSchema>;

export const WORK_ITEM_EXECUTION_STATUSES = ['planned', 'in_progress', 'paused', 'done', 'not_done'] as const;
export const WorkItemExecutionStatusSchema = z.enum(WORK_ITEM_EXECUTION_STATUSES);
export type WorkItemExecutionStatus = z.infer<typeof WorkItemExecutionStatusSchema>;

export const FINDING_SEVERITIES = ['info', 'recommended', 'urgent', 'safety'] as const;
export const FindingSeveritySchema = z.enum(FINDING_SEVERITIES);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const FINDING_STATUSES = ['new', 'reported', 'converted', 'dismissed'] as const;
export const FindingStatusSchema = z.enum(FINDING_STATUSES);
export type FindingStatus = z.infer<typeof FindingStatusSchema>;

export const PHOTO_CONTEXTS = ['intake', 'finding', 'work', 'chat', 'approval'] as const;
export const PhotoContextSchema = z.enum(PHOTO_CONTEXTS);
export type PhotoContext = z.infer<typeof PhotoContextSchema>;

export const VISIBILITIES = ['internal', 'customer'] as const;
export const VisibilitySchema = z.enum(VISIBILITIES);
export type Visibility = z.infer<typeof VisibilitySchema>;

export const INTAKE_CONFIRMATION_METHODS = ['on_site_signature', 'app', 'none'] as const;
export const IntakeConfirmationMethodSchema = z.enum(INTAKE_CONFIRMATION_METHODS);
export type IntakeConfirmationMethod = z.infer<typeof IntakeConfirmationMethodSchema>;

export const APPROVAL_KINDS = ['offer', 'additional_work'] as const;
export const ApprovalKindSchema = z.enum(APPROVAL_KINDS);
export type ApprovalKind = z.infer<typeof ApprovalKindSchema>;

export const APPROVAL_REQUEST_STATUSES = ['draft', 'pending_customer', 'approved', 'rejected', 'withdrawn'] as const;
export const ApprovalRequestStatusSchema = z.enum(APPROVAL_REQUEST_STATUSES);
export type ApprovalRequestStatus = z.infer<typeof ApprovalRequestStatusSchema>;

export const APPROVAL_DECISIONS = ['approved', 'rejected'] as const;
export const ApprovalDecisionValueSchema = z.enum(APPROVAL_DECISIONS);
export type ApprovalDecisionValue = z.infer<typeof ApprovalDecisionValueSchema>;

export const CLIENT_CHANNELS = ['ios', 'android', 'web', 'windows'] as const;
export const ClientChannelSchema = z.enum(CLIENT_CHANNELS);
export type ClientChannel = z.infer<typeof ClientChannelSchema>;

export const DOCUMENT_KINDS = ['offer', 'invoice', 'intake_protocol', 'report', 'other'] as const;
export const DocumentKindSchema = z.enum(DOCUMENT_KINDS);
export type DocumentKind = z.infer<typeof DocumentKindSchema>;

export const INVOICE_STATUSES = ['draft', 'issued', 'cancelled'] as const;
export const InvoiceStatusSchema = z.enum(INVOICE_STATUSES);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

export const PAYMENT_METHODS = ['sumup_online', 'bank_transfer', 'cash', 'card_terminal'] as const;
export const PaymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const CHECKOUT_STATUSES = ['created', 'pending', 'paid', 'failed', 'expired', 'deactivated'] as const;
export const CheckoutStatusSchema = z.enum(CHECKOUT_STATUSES);
export type CheckoutStatus = z.infer<typeof CheckoutStatusSchema>;

export const REFUND_STATUSES = ['requested', 'succeeded', 'failed'] as const;
export const RefundStatusSchema = z.enum(REFUND_STATUSES);
export type RefundStatus = z.infer<typeof RefundStatusSchema>;

export const SERVICE_ENTRY_STATUSES = ['valid', 'superseded', 'voided'] as const;
export const ServiceEntryStatusSchema = z.enum(SERVICE_ENTRY_STATUSES);
export type ServiceEntryStatus = z.infer<typeof ServiceEntryStatusSchema>;

/** Art einer Fälligkeitsangabe: sicher berechnet oder geschätzt. */
export const DUE_BASES = ['date', 'km_recorded', 'km_estimated', 'unknown'] as const;
export const DueBasisSchema = z.enum(DUE_BASES);
export type DueBasis = z.infer<typeof DueBasisSchema>;

export const NOTIFICATION_CHANNELS = ['in_app', 'push', 'email'] as const;
export const NotificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

export const NOTIFICATION_EVENTS = [
  'approval.requested',
  'approval.decided',
  'message.received',
  'invoice.issued',
  'payment.confirmed',
  'appointment.confirmed',
  'appointment.proposed',
  'appointment.requested',
  'work_order.ready_for_pickup',
  'finding.reported',
  'maintenance.due_soon',
] as const;
export const NotificationEventSchema = z.enum(NOTIFICATION_EVENTS);
export type NotificationEvent = z.infer<typeof NotificationEventSchema>;
