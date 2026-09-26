/**
 * Eingabeschemas der API. Die API validiert jede Anfrage mit diesen Schemas;
 * Clients verwenden sie für Formularvalidierung.
 */
import { z } from 'zod';
import {
  AppointmentKindSchema,
  ApprovalDecisionValueSchema,
  ApprovalKindSchema,
  ClientChannelSchema,
  CustomerKindSchema,
  DocumentKindSchema,
  FindingSeveritySchema,
  IntakeConfirmationMethodSchema,
  NotificationChannelSchema,
  NotificationEventSchema,
  PaymentMethodSchema,
  PermissionSchema,
  PhotoContextSchema,
  RoleSchema,
  VisibilitySchema,
  WorkItemKindSchema,
} from './enums';
import { ApprovalLineSchema, IdSchema, IsoDateSchema, IsoDateTimeSchema } from './dto';

const text = (max: number) => z.string().trim().max(max);
const requiredText = (max: number) => z.string().trim().min(1, 'Pflichtfeld').max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

/** Mindestanforderung Passwort: 10 Zeichen; keine Zusammensetzungsregeln (NIST SP 800-63B). */
export const PasswordSchema = z.string().min(10, 'Mindestens 10 Zeichen').max(200);

export const LoginRequestSchema = z.object({ email: z.string().trim().email(), password: z.string().min(1).max(200) });
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const AcceptInvitationRequestSchema = z.object({ token: z.string().min(20), password: PasswordSchema });
export const ForgotPasswordRequestSchema = z.object({ email: z.string().trim().email() });
export const ResetPasswordRequestSchema = z.object({ token: z.string().min(20), password: PasswordSchema });
export const ChangePasswordRequestSchema = z.object({ currentPassword: z.string().min(1), newPassword: PasswordSchema });

export const InviteStaffRequestSchema = z.object({
  email: z.string().trim().email(),
  displayName: requiredText(120),
  role: RoleSchema.exclude(['customer']),
});
export const UpdateStaffRequestSchema = z.object({
  displayName: requiredText(120).optional(),
  role: RoleSchema.exclude(['customer']).optional(),
  permissionOverrides: z.array(z.object({ permission: PermissionSchema, granted: z.boolean() })).optional(),
});

// Kunden -------------------------------------------------------------------

export const CustomerInputSchema = z
  .object({
    kind: CustomerKindSchema,
    salutation: optionalText(30),
    firstName: optionalText(80),
    lastName: optionalText(80),
    companyName: optionalText(160),
    email: z.string().trim().email().nullable().optional(),
    phone: optionalText(40),
    mobile: optionalText(40),
    street: optionalText(160),
    postalCode: optionalText(10),
    city: optionalText(80),
    country: z.string().length(2).default('DE'),
    notesInternal: optionalText(4000),
    isTestData: z.boolean().default(false),
  })
  .refine((c) => (c.kind === 'business' ? !!c.companyName : !!c.lastName), {
    message: 'Nachname (Privatkunde) bzw. Firmenname (Geschäftskunde) ist erforderlich',
    path: ['lastName'],
  });
export type CustomerInput = z.infer<typeof CustomerInputSchema>;

export const InviteCustomerRequestSchema = z.object({ email: z.string().trim().email() });

// Fahrzeuge ----------------------------------------------------------------

/** FIN: 17 Zeichen, ohne I, O, Q. */
export const VinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-NPR-Z0-9]{17}$/, 'FIN muss 17 Zeichen haben (ohne I, O, Q)');

export const VehicleInputSchema = z.object({
  licensePlate: requiredText(15),
  vin: VinSchema.nullable().optional(),
  hsn: z.string().trim().regex(/^\d{4}$/, 'HSN hat 4 Ziffern').nullable().optional(),
  tsn: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{3}$/, 'TSN hat 3 Zeichen').nullable().optional(),
  make: requiredText(60),
  model: requiredText(80),
  variant: optionalText(80),
  firstRegistration: IsoDateSchema.nullable().optional(),
  fuelType: optionalText(30),
  color: optionalText(30),
  notesInternal: optionalText(4000),
  ownerCustomerId: IdSchema,
  isTestData: z.boolean().default(false),
});
export type VehicleInput = z.infer<typeof VehicleInputSchema>;

export const OdometerInputSchema = z.object({
  valueKm: z.number().int().min(0).max(3_000_000),
  recordedAt: IsoDateTimeSchema.optional(),
});

export const OwnershipTransferRequestSchema = z.object({
  newCustomerId: IdSchema,
  effectiveAt: IsoDateTimeSchema,
  note: optionalText(500),
});

// Termine ------------------------------------------------------------------

export const AppointmentInputSchema = z
  .object({
    kind: AppointmentKindSchema,
    customerId: IdSchema,
    vehicleId: IdSchema,
    workOrderId: IdSchema.nullable().optional(),
    startsAt: IsoDateTimeSchema,
    endsAt: IsoDateTimeSchema,
    resourceId: IdSchema.nullable().optional(),
    assigneeIds: z.array(IdSchema).default([]),
    customerNote: optionalText(2000),
    internalNote: optionalText(2000),
    /** Bei Konflikten nur mit Begründung speichern */
    overrideConflictsReason: optionalText(500),
  })
  .refine((a) => a.endsAt > a.startsAt, { message: 'Ende muss nach Beginn liegen', path: ['endsAt'] });

export const AppointmentRequestInputSchema = z
  .object({
    kind: AppointmentKindSchema,
    vehicleId: IdSchema,
    preferredStart: IsoDateTimeSchema,
    preferredEnd: IsoDateTimeSchema,
    customerNote: optionalText(2000),
  })
  .refine((a) => a.preferredEnd > a.preferredStart, { message: 'Ende muss nach Beginn liegen', path: ['preferredEnd'] });

export const ProposeAlternativeRequestSchema = z
  .object({ startsAt: IsoDateTimeSchema, endsAt: IsoDateTimeSchema, message: optionalText(500) })
  .refine((a) => a.endsAt > a.startsAt, { message: 'Ende muss nach Beginn liegen', path: ['endsAt'] });

export const CancelRequestSchema = z.object({ reason: requiredText(500) });

// Aufträge -----------------------------------------------------------------

export const WorkItemInputSchema = z.object({
  kind: WorkItemKindSchema,
  title: requiredText(200),
  description: optionalText(4000),
  maintenanceTypeId: IdSchema.nullable().optional(),
  intervalKm: z.number().int().positive().nullable().optional(),
  intervalMonths: z.number().int().positive().nullable().optional(),
  quantity: z.number().positive().default(1),
  unit: text(20).default('Stk'),
  unitPriceCents: z.number().int().nullable().optional(),
  vatRateBp: z.number().int().min(0).max(10000).default(1900),
  assignedTo: IdSchema.nullable().optional(),
});
export type WorkItemInput = z.infer<typeof WorkItemInputSchema>;

export const CreateWorkOrderRequestSchema = z.object({
  customerId: IdSchema,
  vehicleId: IdSchema,
  title: requiredText(200),
  descriptionCustomer: optionalText(4000),
  notesInternal: optionalText(4000),
  costLimitCents: z.number().int().positive().nullable().optional(),
  plannedStart: IsoDateTimeSchema.nullable().optional(),
  plannedEnd: IsoDateTimeSchema.nullable().optional(),
  assigneeIds: z.array(IdSchema).default([]),
  /** Bei Anlage vereinbarte Leistungen (authorization = agreed) */
  items: z.array(WorkItemInputSchema).default([]),
});
export type CreateWorkOrderRequest = z.infer<typeof CreateWorkOrderRequestSchema>;

export const UpdateWorkOrderRequestSchema = CreateWorkOrderRequestSchema.omit({ customerId: true, vehicleId: true, items: true }).partial();

export const WorkOrderTransitionRequestSchema = z.object({
  to: z.enum(['open', 'in_progress', 'cancelled']),
  reason: optionalText(500),
});

export const IntakeInputSchema = z.object({
  odometerKm: z.number().int().min(0).nullable(),
  fuelLevel: optionalText(20),
  customerComplaint: requiredText(4000),
  damages: z.array(z.object({ area: requiredText(80), description: requiredText(500), photoId: IdSchema.nullable() })).default([]),
  agreedServices: text(4000),
  costLimitCents: z.number().int().positive().nullable().optional(),
  notesInternal: optionalText(4000),
  notesCustomer: optionalText(4000),
});
export type IntakeInput = z.infer<typeof IntakeInputSchema>;

export const ConfirmIntakeRequestSchema = z.object({
  method: IntakeConfirmationMethodSchema.exclude(['none']),
  contentHash: z.string().length(64),
});

export const FinishWorkItemRequestSchema = z.object({
  odometerKm: z.number().int().min(0).nullable().optional(),
  resultNotes: optionalText(4000),
  /** gewähltes Intervall für die Servicehistorie (Standard aus Wartungsart) */
  intervalKm: z.number().int().positive().nullable().optional(),
  intervalMonths: z.number().int().positive().nullable().optional(),
});

export const NotDoneWorkItemRequestSchema = z.object({ reason: requiredText(500) });

export const PartUsedInputSchema = z.object({
  partNumber: optionalText(60),
  description: requiredText(200),
  quantity: z.number().positive(),
  unitPriceCents: z.number().int().nullable().optional(),
});

export const FindingInputSchema = z.object({
  /** Client-UUID für Offline-Erfassung */
  id: IdSchema.optional(),
  workItemId: IdSchema.nullable().optional(),
  description: requiredText(4000),
  severity: FindingSeveritySchema,
  dictated: z.boolean().default(false),
  photoIds: z.array(IdSchema).default([]),
});

export const CompleteReviewRequestSchema = z.object({
  /** Bestätigung, dass die Arbeiten fachlich geprüft wurden */
  confirm: z.literal(true),
  odometerKm: z.number().int().min(0).nullable().optional(),
});

// Freigaben ----------------------------------------------------------------

export const ApprovalDraftInputSchema = z.object({
  kind: ApprovalKindSchema,
  title: requiredText(200),
  summaryCustomer: requiredText(4000),
  lines: z.array(ApprovalLineSchema).min(1, 'Mindestens eine Position'),
  scheduleChange: optionalText(1000),
  newReadyAt: IsoDateTimeSchema.nullable().optional(),
  photoIds: z.array(IdSchema).default([]),
  documentVersionId: IdSchema.nullable().optional(),
  findingId: IdSchema.nullable().optional(),
});
export type ApprovalDraftInput = z.infer<typeof ApprovalDraftInputSchema>;

export const ApprovalDecisionRequestSchema = z.object({
  versionId: IdSchema,
  /** Hash der angezeigten Version; muss mit der aktuellen Version übereinstimmen */
  contentHash: z.string().length(64),
  decision: ApprovalDecisionValueSchema,
  comment: optionalText(1000),
  channel: ClientChannelSchema,
});
export type ApprovalDecisionRequest = z.infer<typeof ApprovalDecisionRequestSchema>;

// Dokumente, Fotos, Chat -----------------------------------------------------

export const CreateDocumentRequestSchema = z
  .object({
    kind: DocumentKindSchema,
    title: requiredText(200),
    fileId: IdSchema,
    customerId: IdSchema.nullable().optional(),
    vehicleId: IdSchema.nullable().optional(),
    workOrderId: IdSchema.nullable().optional(),
  })
  .refine((d) => d.customerId || d.vehicleId || d.workOrderId, { message: 'Dokument muss zugeordnet sein' });

export const AttachPhotoRequestSchema = z.object({
  id: IdSchema.optional(),
  fileId: IdSchema,
  context: PhotoContextSchema,
  findingId: IdSchema.nullable().optional(),
  caption: optionalText(300),
  takenAt: IsoDateTimeSchema.optional(),
});

export const SetVisibilityRequestSchema = z.object({ visibility: VisibilitySchema });

export const SendMessageRequestSchema = z
  .object({
    clientMessageId: z.string().min(8).max(64),
    body: text(4000).default(''),
    fileIds: z.array(IdSchema).max(10).default([]),
  })
  .refine((m) => m.body.length > 0 || m.fileIds.length > 0, { message: 'Nachricht ist leer' });

export const InternalNoteInputSchema = z.object({ body: requiredText(4000) });

// Rechnungen und Zahlungen ---------------------------------------------------

export const CreateInvoiceRequestSchema = z.object({
  workOrderId: IdSchema.nullable().optional(),
  customerId: IdSchema,
  totalGrossCents: z.number().int().positive(),
  dueDate: IsoDateSchema.nullable().optional(),
  documentFileId: IdSchema.nullable().optional(),
  vatBreakdown: z.array(z.object({ vatRateBp: z.number().int(), netCents: z.number().int(), vatCents: z.number().int() })).default([]),
});

export const IssueInvoiceRequestSchema = z.object({ invoiceNumber: requiredText(40) });

export const ManualPaymentRequestSchema = z.object({
  method: PaymentMethodSchema.exclude(['sumup_online']),
  amountCents: z.number().int().positive(),
  receivedAt: IsoDateTimeSchema,
  referenceText: requiredText(200),
  note: optionalText(1000),
});

export const RefundRequestSchema = z.object({
  amountCents: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(64),
  reason: requiredText(500),
});

// Servicehistorie und Freigaben für Dritte -----------------------------------

export const ServiceEntryCorrectionRequestSchema = z.object({
  performedOn: IsoDateSchema.optional(),
  odometerKm: z.number().int().min(0).nullable().optional(),
  title: requiredText(200).optional(),
  details: optionalText(4000),
  intervalKm: z.number().int().positive().nullable().optional(),
  intervalMonths: z.number().int().positive().nullable().optional(),
  void: z.boolean().default(false),
  reason: requiredText(500),
});

export const CreateVehicleShareRequestSchema = z.object({
  label: requiredText(120),
  serviceEntryIds: z.array(IdSchema).min(1, 'Mindestens einen Eintrag auswählen'),
  includeVin: z.boolean().default(false),
  expiresAt: IsoDateTimeSchema,
});

export const QrPublicViewRequestSchema = z.object({ enabled: z.boolean() });

// Benachrichtigungen ---------------------------------------------------------

export const RegisterDeviceRequestSchema = z.object({
  platform: z.enum(['ios', 'android', 'web', 'windows']),
  pushToken: z.string().min(10).max(4096),
});

export const NotificationPreferencesRequestSchema = z.object({
  preferences: z.array(z.object({ eventType: NotificationEventSchema, channel: NotificationChannelSchema.exclude(['in_app']), enabled: z.boolean() })),
});
