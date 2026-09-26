/**
 * Datenobjekte, wie die API sie liefert und die Clients sie anzeigen.
 * Die API filtert Felder je Rolle (z. B. keine Preise für Mechaniker, keine internen Notizen
 * für Kunden). Felder, die je Rolle fehlen können, sind optional.
 */
import { z } from 'zod';
import {
  AppointmentKindSchema,
  AppointmentStatusSchema,
  ApprovalDecisionValueSchema,
  ApprovalKindSchema,
  ApprovalOverviewStatusSchema,
  ApprovalRequestStatusSchema,
  CheckoutStatusSchema,
  ClientChannelSchema,
  CustomerAccessStatusSchema,
  CustomerKindSchema,
  DocumentKindSchema,
  DueBasisSchema,
  FindingSeveritySchema,
  FindingStatusSchema,
  IntakeConfirmationMethodSchema,
  InvoiceStatusSchema,
  NotificationEventSchema,
  OdometerSourceSchema,
  PaymentMethodSchema,
  PaymentStatusSchema,
  PermissionSchema,
  PhotoContextSchema,
  ProposalStatusSchema,
  RefundStatusSchema,
  ResourceKindSchema,
  RoleSchema,
  ServiceEntryStatusSchema,
  UserStatusSchema,
  VisibilitySchema,
  WorkItemAuthorizationSchema,
  WorkItemExecutionStatusSchema,
  WorkItemKindSchema,
  WorkItemOriginSchema,
  WorkOrderStatusSchema,
} from './enums';

export const IdSchema = z.string().uuid();
export const IsoDateTimeSchema = z.string().datetime({ offset: true });
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const CentsSchema = z.number().int();
export const CurrencySchema = z.literal('EUR');

export const MoneySchema = z.object({ amountCents: CentsSchema, currency: CurrencySchema });
export type Money = z.infer<typeof MoneySchema>;

// ---------------------------------------------------------------------------
// Konten und Sitzung
// ---------------------------------------------------------------------------

export const SessionUserSchema = z.object({
  id: IdSchema,
  email: z.string().email(),
  displayName: z.string(),
  role: RoleSchema,
  status: UserStatusSchema,
  /** Effektive Rechte (Mitarbeiter). Kunden: leer, es gelten Objektregeln. */
  permissions: z.array(PermissionSchema),
  /** Nur bei Kunden: verknüpfter Kundendatensatz. */
  customerId: IdSchema.nullable(),
});
export type SessionUser = z.infer<typeof SessionUserSchema>;

export const LoginResponseSchema = z.object({ token: z.string(), expiresAt: IsoDateTimeSchema, user: SessionUserSchema });
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const StaffUserSchema = z.object({
  id: IdSchema,
  email: z.string().email(),
  displayName: z.string(),
  role: RoleSchema,
  status: UserStatusSchema,
  permissionOverrides: z.array(z.object({ permission: PermissionSchema, granted: z.boolean() })),
  effectivePermissions: z.array(PermissionSchema),
  lastLoginAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type StaffUser = z.infer<typeof StaffUserSchema>;

// ---------------------------------------------------------------------------
// Kunden und Fahrzeuge
// ---------------------------------------------------------------------------

export const CustomerSummarySchema = z.object({
  id: IdSchema,
  customerNumber: z.string(),
  kind: CustomerKindSchema,
  displayName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  vehicleCount: z.number().int(),
  accessStatus: CustomerAccessStatusSchema,
  openInvoiceCount: z.number().int().optional(),
  isTestData: z.boolean(),
});
export type CustomerSummary = z.infer<typeof CustomerSummarySchema>;

export const CustomerDetailSchema = CustomerSummarySchema.extend({
  salutation: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  companyName: z.string().nullable(),
  mobile: z.string().nullable(),
  street: z.string().nullable(),
  postalCode: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string(),
  notesInternal: z.string().nullable().optional(),
  createdAt: IsoDateTimeSchema,
  archivedAt: IsoDateTimeSchema.nullable(),
});
export type CustomerDetail = z.infer<typeof CustomerDetailSchema>;

export const VehicleSummarySchema = z.object({
  id: IdSchema,
  licensePlate: z.string(),
  make: z.string(),
  model: z.string(),
  variant: z.string().nullable(),
  vin: z.string().nullable(),
  currentOwner: z.object({ customerId: IdSchema, displayName: z.string() }).nullable().optional(),
  lastOdometerKm: z.number().int().nullable(),
  lastOdometerAt: IsoDateTimeSchema.nullable(),
  isTestData: z.boolean(),
});
export type VehicleSummary = z.infer<typeof VehicleSummarySchema>;

export const VehicleDetailSchema = VehicleSummarySchema.extend({
  hsn: z.string().nullable(),
  tsn: z.string().nullable(),
  firstRegistration: IsoDateSchema.nullable(),
  fuelType: z.string().nullable(),
  color: z.string().nullable(),
  notesInternal: z.string().nullable().optional(),
  qrPublicViewEnabled: z.boolean(),
  /** Nur für berechtigte Mitarbeiter und den aktuellen Halter. */
  qrUrl: z.string().nullable().optional(),
  createdAt: IsoDateTimeSchema,
});
export type VehicleDetail = z.infer<typeof VehicleDetailSchema>;

export const OwnershipSchema = z.object({
  id: IdSchema,
  vehicleId: IdSchema,
  customerId: IdSchema,
  customerDisplayName: z.string(),
  startedAt: IsoDateTimeSchema,
  endedAt: IsoDateTimeSchema.nullable(),
  note: z.string().nullable(),
});
export type Ownership = z.infer<typeof OwnershipSchema>;

export const OdometerReadingSchema = z.object({
  id: IdSchema,
  vehicleId: IdSchema,
  valueKm: z.number().int().nonnegative(),
  recordedAt: IsoDateTimeSchema,
  source: OdometerSourceSchema,
  workOrderId: IdSchema.nullable(),
  plausibility: z.enum(['ok', 'lower_than_previous']),
});
export type OdometerReading = z.infer<typeof OdometerReadingSchema>;

// ---------------------------------------------------------------------------
// Termine
// ---------------------------------------------------------------------------

export const ResourceSchema = z.object({ id: IdSchema, name: z.string(), kind: ResourceKindSchema, active: z.boolean() });
export type Resource = z.infer<typeof ResourceSchema>;

export const AppointmentProposalSchema = z.object({
  id: IdSchema,
  startsAt: IsoDateTimeSchema,
  endsAt: IsoDateTimeSchema,
  status: ProposalStatusSchema,
  createdAt: IsoDateTimeSchema,
});
export type AppointmentProposal = z.infer<typeof AppointmentProposalSchema>;

export const AppointmentSchema = z.object({
  id: IdSchema,
  kind: AppointmentKindSchema,
  status: AppointmentStatusSchema,
  customerId: IdSchema,
  customerDisplayName: z.string(),
  vehicleId: IdSchema,
  vehicleLabel: z.string(),
  workOrderId: IdSchema.nullable(),
  startsAt: IsoDateTimeSchema,
  endsAt: IsoDateTimeSchema,
  resourceId: IdSchema.nullable().optional(),
  assigneeIds: z.array(IdSchema).optional(),
  requestedBy: z.enum(['customer', 'staff']),
  customerNote: z.string().nullable(),
  internalNote: z.string().nullable().optional(),
  proposals: z.array(AppointmentProposalSchema),
  confirmedAt: IsoDateTimeSchema.nullable(),
  cancelledAt: IsoDateTimeSchema.nullable(),
  cancelReason: z.string().nullable(),
});
export type Appointment = z.infer<typeof AppointmentSchema>;

export const SchedulingConflictSchema = z.object({
  kind: z.enum(['resource_double_booked', 'assignee_double_booked', 'outside_working_hours', 'parts_missing', 'outside_opening_hours']),
  message: z.string(),
  relatedAppointmentId: IdSchema.nullable(),
});
export type SchedulingConflict = z.infer<typeof SchedulingConflictSchema>;

// ---------------------------------------------------------------------------
// Aufträge
// ---------------------------------------------------------------------------

export const WorkItemSchema = z.object({
  id: IdSchema,
  workOrderId: IdSchema,
  position: z.number().int(),
  kind: WorkItemKindSchema,
  title: z.string(),
  description: z.string().nullable(),
  maintenanceTypeId: IdSchema.nullable(),
  intervalKm: z.number().int().nullable(),
  intervalMonths: z.number().int().nullable(),
  quantity: z.number(),
  unit: z.string(),
  /** Fehlt für Mechaniker. */
  unitPriceCents: CentsSchema.nullable().optional(),
  vatRateBp: z.number().int().optional(),
  origin: WorkItemOriginSchema,
  authorization: WorkItemAuthorizationSchema,
  executionStatus: WorkItemExecutionStatusSchema,
  approvalRequestId: IdSchema.nullable(),
  assignedTo: z.object({ userId: IdSchema, displayName: z.string() }).nullable(),
  doneAt: IsoDateTimeSchema.nullable(),
  doneOdometerKm: z.number().int().nullable(),
  resultNotes: z.string().nullable(),
  trackedMinutes: z.number().int().optional(),
});
export type WorkItem = z.infer<typeof WorkItemSchema>;

export const StatusTripleSchema = z.object({
  work: WorkOrderStatusSchema,
  approval: ApprovalOverviewStatusSchema,
  payment: PaymentStatusSchema,
  /** Zusatzmerkmale */
  overdue: z.boolean(),
  readyForPickup: z.boolean(),
  pendingApprovalCount: z.number().int(),
});
export type StatusTriple = z.infer<typeof StatusTripleSchema>;

export const WorkOrderSummarySchema = z.object({
  id: IdSchema,
  orderNumber: z.string(),
  title: z.string(),
  customerId: IdSchema,
  customerDisplayName: z.string(),
  vehicleId: IdSchema,
  vehicleLabel: z.string(),
  licensePlate: z.string(),
  status: StatusTripleSchema,
  plannedStart: IsoDateTimeSchema.nullable(),
  plannedEnd: IsoDateTimeSchema.nullable(),
  assignees: z.array(z.object({ userId: IdSchema, displayName: z.string() })),
  unreadMessages: z.number().int(),
  updatedAt: IsoDateTimeSchema,
});
export type WorkOrderSummary = z.infer<typeof WorkOrderSummarySchema>;

export const IntakeSchema = z.object({
  id: IdSchema,
  workOrderId: IdSchema,
  odometerKm: z.number().int().nullable(),
  fuelLevel: z.string().nullable(),
  customerComplaint: z.string(),
  damages: z.array(z.object({ area: z.string(), description: z.string(), photoId: IdSchema.nullable() })),
  agreedServices: z.string(),
  costLimitCents: CentsSchema.nullable().optional(),
  notesInternal: z.string().nullable().optional(),
  notesCustomer: z.string().nullable(),
  confirmedAt: IsoDateTimeSchema.nullable(),
  confirmationMethod: IntakeConfirmationMethodSchema,
  contentHash: z.string().nullable(),
});
export type Intake = z.infer<typeof IntakeSchema>;

export const WorkOrderDetailSchema = WorkOrderSummarySchema.extend({
  descriptionCustomer: z.string().nullable(),
  notesInternal: z.string().nullable().optional(),
  costLimitCents: CentsSchema.nullable().optional(),
  items: z.array(WorkItemSchema),
  intake: IntakeSchema.nullable(),
  appointmentIds: z.array(IdSchema),
  readyForPickupAt: IsoDateTimeSchema.nullable(),
  pickedUpAt: IsoDateTimeSchema.nullable(),
  completionReviewedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type WorkOrderDetail = z.infer<typeof WorkOrderDetailSchema>;

export const PhotoSchema = z.object({
  id: IdSchema,
  workOrderId: IdSchema,
  fileId: IdSchema,
  context: PhotoContextSchema,
  findingId: IdSchema.nullable(),
  visibility: VisibilitySchema,
  caption: z.string().nullable(),
  takenAt: IsoDateTimeSchema,
  /** relative API-URL, liefert Inhalt nur nach Rechteprüfung */
  contentUrl: z.string(),
});
export type Photo = z.infer<typeof PhotoSchema>;

export const FindingSchema = z.object({
  id: IdSchema,
  workOrderId: IdSchema,
  workItemId: IdSchema.nullable(),
  description: z.string(),
  severity: FindingSeveritySchema,
  status: FindingStatusSchema,
  reportedBy: z.object({ userId: IdSchema, displayName: z.string() }),
  dictated: z.boolean(),
  photoIds: z.array(IdSchema),
  createdAt: IsoDateTimeSchema,
});
export type Finding = z.infer<typeof FindingSchema>;

export const TimelineEntrySchema = z.object({
  id: z.string(),
  occurredAt: IsoDateTimeSchema,
  actorDisplayName: z.string().nullable(),
  action: z.string(),
  summary: z.string(),
});
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;

// ---------------------------------------------------------------------------
// Freigaben
// ---------------------------------------------------------------------------

export const ApprovalLineSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable(),
  quantity: z.number().positive(),
  unit: z.string(),
  unitPriceCents: CentsSchema,
  vatRateBp: z.number().int().min(0).max(10000),
  maintenanceTypeId: IdSchema.nullable(),
});
export type ApprovalLine = z.infer<typeof ApprovalLineSchema>;

export const ApprovalDecisionSchema = z.object({
  id: IdSchema,
  versionId: IdSchema,
  decision: ApprovalDecisionValueSchema,
  decidedByDisplayName: z.string(),
  decidedAt: IsoDateTimeSchema,
  contentHash: z.string(),
  channel: ClientChannelSchema,
  comment: z.string().nullable(),
});
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

export const ApprovalVersionSchema = z.object({
  id: IdSchema,
  versionNo: z.number().int().positive(),
  summaryCustomer: z.string(),
  lines: z.array(ApprovalLineSchema),
  totalNetCents: CentsSchema,
  totalGrossCents: CentsSchema,
  currency: z.literal('EUR'),
  scheduleChange: z.string().nullable(),
  newReadyAt: IsoDateTimeSchema.nullable(),
  photoIds: z.array(IdSchema),
  documentVersionId: IdSchema.nullable(),
  contentHash: z.string(),
  sentAt: IsoDateTimeSchema.nullable(),
  supersededAt: IsoDateTimeSchema.nullable(),
  decision: ApprovalDecisionSchema.nullable(),
});
export type ApprovalVersion = z.infer<typeof ApprovalVersionSchema>;

export const ApprovalRequestSchema = z.object({
  id: IdSchema,
  workOrderId: IdSchema,
  kind: ApprovalKindSchema,
  title: z.string(),
  status: ApprovalRequestStatusSchema,
  currentVersion: ApprovalVersionSchema,
  /** Mitarbeiter sehen alle Versionen, Kunden nur gesendete. */
  versions: z.array(ApprovalVersionSchema),
  findingId: IdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

// ---------------------------------------------------------------------------
// Dokumente und Chat
// ---------------------------------------------------------------------------

export const FileRefSchema = z.object({
  id: IdSchema,
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  sha256: z.string(),
});
export type FileRef = z.infer<typeof FileRefSchema>;

export const DocumentSchema = z.object({
  id: IdSchema,
  kind: DocumentKindSchema,
  title: z.string(),
  customerId: IdSchema.nullable(),
  vehicleId: IdSchema.nullable(),
  workOrderId: IdSchema.nullable(),
  visibility: VisibilitySchema,
  publishedAt: IsoDateTimeSchema.nullable(),
  currentVersion: z.object({ id: IdSchema, versionNo: z.number().int(), file: FileRefSchema, createdAt: IsoDateTimeSchema }),
  versionCount: z.number().int(),
  downloadUrl: z.string(),
  createdAt: IsoDateTimeSchema,
});
export type DocumentDto = z.infer<typeof DocumentSchema>;

export const MessageSchema = z.object({
  id: IdSchema,
  workOrderId: IdSchema,
  author: z.object({ userId: IdSchema, displayName: z.string(), role: RoleSchema }),
  body: z.string(),
  attachments: z.array(z.object({ fileId: IdSchema, contentUrl: z.string(), mimeType: z.string() })),
  clientMessageId: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
});
export type Message = z.infer<typeof MessageSchema>;

export const ConversationSchema = z.object({
  workOrderId: IdSchema,
  orderNumber: z.string(),
  title: z.string(),
  counterpartDisplayName: z.string(),
  lastMessage: MessageSchema.nullable(),
  unreadCount: z.number().int(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const InternalNoteSchema = z.object({
  id: IdSchema,
  workOrderId: IdSchema,
  author: z.object({ userId: IdSchema, displayName: z.string() }),
  body: z.string(),
  createdAt: IsoDateTimeSchema,
});
export type InternalNote = z.infer<typeof InternalNoteSchema>;

// ---------------------------------------------------------------------------
// Rechnungen und Zahlungen
// ---------------------------------------------------------------------------

export const PaymentSchema = z.object({
  id: IdSchema,
  method: PaymentMethodSchema,
  amountCents: CentsSchema,
  currency: z.literal('EUR'),
  receivedAt: IsoDateTimeSchema,
  providerTransactionId: z.string().nullable(),
  referenceText: z.string().nullable(),
  recordedByDisplayName: z.string().nullable(),
  refundedCents: CentsSchema,
});
export type Payment = z.infer<typeof PaymentSchema>;

export const CheckoutSchema = z.object({
  id: IdSchema,
  status: CheckoutStatusSchema,
  amountCents: CentsSchema,
  createdAt: IsoDateTimeSchema,
  lastCheckedAt: IsoDateTimeSchema.nullable(),
});
export type Checkout = z.infer<typeof CheckoutSchema>;

export const RefundSchema = z.object({
  id: IdSchema,
  paymentId: IdSchema,
  amountCents: CentsSchema,
  status: RefundStatusSchema,
  requestedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema.nullable(),
  failureReason: z.string().nullable(),
});
export type Refund = z.infer<typeof RefundSchema>;

export const InvoiceSchema = z.object({
  id: IdSchema,
  invoiceNumber: z.string().nullable(),
  workOrderId: IdSchema.nullable(),
  orderNumber: z.string().nullable(),
  customerId: IdSchema,
  customerDisplayName: z.string(),
  status: InvoiceStatusSchema,
  paymentStatus: PaymentStatusSchema,
  overdue: z.boolean(),
  totalGrossCents: CentsSchema,
  paidCents: CentsSchema,
  refundedCents: CentsSchema,
  openCents: CentsSchema,
  currency: z.literal('EUR'),
  issuedAt: IsoDateTimeSchema.nullable(),
  dueDate: IsoDateSchema.nullable(),
  documentId: IdSchema.nullable(),
  payments: z.array(PaymentSchema),
  /** Nur Mitarbeiter */
  checkouts: z.array(CheckoutSchema).optional(),
  refunds: z.array(RefundSchema).optional(),
  /** Überweisungsdaten der Werkstatt für diese Rechnung */
  bankTransfer: z.object({ recipient: z.string(), iban: z.string(), bic: z.string().nullable(), reference: z.string() }).nullable(),
  onlinePaymentAvailable: z.boolean(),
});
export type Invoice = z.infer<typeof InvoiceSchema>;

export const StartCheckoutResponseSchema = z.object({
  checkoutId: IdSchema,
  hostedUrl: z.string().url(),
  /** Hinweis: Der Rechnungsstatus bleibt unverändert, bis der Server die Zahlung bestätigt. */
  invoicePaymentStatus: PaymentStatusSchema,
});
export type StartCheckoutResponse = z.infer<typeof StartCheckoutResponseSchema>;

// ---------------------------------------------------------------------------
// Servicehistorie, Fälligkeiten, Freigaben für Dritte
// ---------------------------------------------------------------------------

export const MaintenanceTypeSchema = z.object({
  id: IdSchema,
  key: z.string(),
  name: z.string(),
  defaultIntervalKm: z.number().int().nullable(),
  defaultIntervalMonths: z.number().int().nullable(),
  intervalOptions: z.array(z.object({ km: z.number().int().nullable(), months: z.number().int().nullable(), label: z.string() })),
  active: z.boolean(),
});
export type MaintenanceType = z.infer<typeof MaintenanceTypeSchema>;

export const ServiceEntrySchema = z.object({
  id: IdSchema,
  vehicleId: IdSchema,
  /** null, wenn der Auftrag einem anderen (früheren) Halter gehört */
  workOrderId: IdSchema.nullable(),
  maintenanceTypeId: IdSchema.nullable(),
  maintenanceTypeName: z.string().nullable(),
  performedOn: IsoDateSchema,
  odometerKm: z.number().int().nullable(),
  title: z.string(),
  details: z.string().nullable(),
  workshopName: z.string(),
  intervalKm: z.number().int().nullable(),
  intervalMonths: z.number().int().nullable(),
  nextDueDate: IsoDateSchema.nullable(),
  nextDueKm: z.number().int().nullable(),
  status: ServiceEntryStatusSchema,
  revisionNo: z.number().int(),
  revisionOfId: IdSchema.nullable(),
  correctionReason: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
});
export type ServiceEntry = z.infer<typeof ServiceEntrySchema>;

export const MaintenanceDueSchema = z.object({
  vehicleId: IdSchema,
  maintenanceTypeId: IdSchema.nullable(),
  title: z.string(),
  lastServiceEntryId: IdSchema,
  dueDate: IsoDateSchema.nullable(),
  dueKm: z.number().int().nullable(),
  /** Maßgebliche (zuerst erreichte) Grenze und wie sicher sie ist */
  governingLimit: z.enum(['date', 'km', 'none']),
  basis: DueBasisSchema,
  estimatedCurrentKm: z.number().int().nullable(),
  state: z.enum(['overdue', 'due_soon', 'ok', 'unknown']),
  explanation: z.string(),
});
export type MaintenanceDue = z.infer<typeof MaintenanceDueSchema>;

export const VehicleShareSchema = z.object({
  id: IdSchema,
  vehicleId: IdSchema,
  label: z.string(),
  includeVin: z.boolean(),
  serviceEntryIds: z.array(IdSchema),
  expiresAt: IsoDateTimeSchema,
  revokedAt: IsoDateTimeSchema.nullable(),
  accessCount: z.number().int(),
  lastAccessedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  /** Nur direkt nach dem Anlegen einmalig enthalten (Token wird nur als Hash gespeichert). */
  shareUrl: z.string().nullable(),
});
export type VehicleShare = z.infer<typeof VehicleShareSchema>;

export const PublicServiceEntrySchema = ServiceEntrySchema.pick({
  performedOn: true,
  odometerKm: true,
  title: true,
  details: true,
  workshopName: true,
  nextDueDate: true,
  nextDueKm: true,
  maintenanceTypeName: true,
  revisionNo: true,
});
export type PublicServiceEntry = z.infer<typeof PublicServiceEntrySchema>;

export const PublicVehicleViewSchema = z.object({
  make: z.string(),
  model: z.string(),
  variant: z.string().nullable(),
  vin: z.string().nullable(),
  entries: z.array(PublicServiceEntrySchema),
  source: z.enum(['qr_public_view', 'share']),
  expiresAt: IsoDateTimeSchema.nullable(),
  workshopName: z.string(),
});
export type PublicVehicleView = z.infer<typeof PublicVehicleViewSchema>;

export const QrResolutionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('authorized'), vehicleId: IdSchema, targetPath: z.string() }),
  z.object({ mode: z.literal('public'), view: PublicVehicleViewSchema }),
  z.object({ mode: z.literal('login_required'), workshopName: z.string() }),
]);
export type QrResolution = z.infer<typeof QrResolutionSchema>;

// ---------------------------------------------------------------------------
// Dashboard, Benachrichtigungen, Einstellungen, Audit
// ---------------------------------------------------------------------------

export const DashboardTileSchema = z.object({
  key: z.enum([
    'appointments_today',
    'open_work_orders',
    'pending_approvals',
    'unread_messages',
    'ready_for_pickup',
    'maintenance_due',
    'open_invoices',
    'my_assigned_items',
    'appointment_requests',
  ]),
  label: z.string(),
  count: z.number().int(),
  /** Ziel inkl. Filter, z. B. /werkstatt/auftraege?freigabe=pending */
  targetPath: z.string(),
});
export type DashboardTile = z.infer<typeof DashboardTileSchema>;

export const NotificationSchema = z.object({
  id: IdSchema,
  eventType: NotificationEventSchema,
  title: z.string(),
  body: z.string(),
  targetPath: z.string(),
  createdAt: IsoDateTimeSchema,
  readAt: IsoDateTimeSchema.nullable(),
});
export type NotificationDto = z.infer<typeof NotificationSchema>;

export const WorkshopSettingsSchema = z.object({
  name: z.string(),
  legalName: z.string().nullable(),
  street: z.string().nullable(),
  postalCode: z.string().nullable(),
  city: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  website: z.string().nullable(),
  vatId: z.string().nullable(),
  iban: z.string().nullable(),
  bic: z.string().nullable(),
  bankName: z.string().nullable(),
  openingHours: z.array(z.object({ weekday: z.number().int().min(1).max(7), opens: z.string(), closes: z.string() })),
  paymentTermDays: z.number().int(),
  paymentProvider: z.enum(['none', 'sumup']),
  sumupMerchantCode: z.string().nullable(),
  /** true, wenn API-Schlüssel serverseitig konfiguriert ist (Wert wird nie ausgegeben) */
  paymentProviderConfigured: z.boolean(),
});
export type WorkshopSettings = z.infer<typeof WorkshopSettingsSchema>;

export const AuditEntrySchema = z.object({
  id: z.string(),
  occurredAt: IsoDateTimeSchema,
  actorDisplayName: z.string().nullable(),
  actorRole: RoleSchema.nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const PageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });
