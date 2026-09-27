/**
 * Interner Zustand der DemoApi. Die Datensätze bilden die Tabellen aus docs/datenmodell.md
 * vereinfacht ab (camelCase statt snake_case). Nach außen gibt die DemoApi ausschließlich
 * die DTOs aus @werkstatt/contracts heraus (siehe mappers.ts).
 */
import type {
  AppointmentKind,
  AppointmentStatus,
  ApprovalDecisionValue,
  ApprovalKind,
  ApprovalLine,
  ApprovalRequestStatus,
  CheckoutStatus,
  ClientChannel,
  CustomerKind,
  DocumentKind,
  FindingSeverity,
  FindingStatus,
  IntakeConfirmationMethod,
  InvoiceStatus,
  NotificationEvent,
  OdometerSource,
  PaymentMethod,
  Permission,
  PhotoContext,
  ProposalStatus,
  RefundStatus,
  ResourceKind,
  Role,
  ServiceEntryStatus,
  UserStatus,
  Visibility,
  WorkItemAuthorization,
  WorkItemExecutionStatus,
  WorkItemKind,
  WorkItemOrigin,
  WorkOrderStatus,
} from '@werkstatt/contracts';

export type Iso = string;
export type IsoDate = string;

export interface DUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  /** SHA-256 des Demo-Passworts; im echten System argon2id auf dem Server */
  passwordHash: string | null;
  permissionOverrides: { permission: Permission; granted: boolean }[];
  lastLoginAt: Iso | null;
  createdAt: Iso;
}

export interface DCustomer {
  id: string;
  customerNumber: string;
  kind: CustomerKind;
  salutation: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
  notesInternal: string | null;
  createdAt: Iso;
  archivedAt: Iso | null;
  isTestData: boolean;
}

export interface DCustomerAccount {
  customerId: string;
  userId: string;
}

export interface DToken {
  tokenHash: string;
  userId: string;
  purpose: 'staff' | 'customer' | 'password_reset';
  expiresAt: Iso;
  usedAt: Iso | null;
}

export interface DVehicle {
  id: string;
  licensePlate: string;
  vin: string | null;
  hsn: string | null;
  tsn: string | null;
  make: string;
  model: string;
  variant: string | null;
  firstRegistration: IsoDate | null;
  fuelType: string | null;
  color: string | null;
  notesInternal: string | null;
  qrToken: string;
  qrPublicViewEnabled: boolean;
  createdAt: Iso;
  archivedAt: Iso | null;
  isTestData: boolean;
}

export interface DOwnership {
  id: string;
  vehicleId: string;
  customerId: string;
  startedAt: Iso;
  endedAt: Iso | null;
  note: string | null;
}

export interface DOdometer {
  id: string;
  vehicleId: string;
  valueKm: number;
  recordedAt: Iso;
  source: OdometerSource;
  workOrderId: string | null;
  plausibility: 'ok' | 'lower_than_previous';
}

export interface DMaintenanceType {
  id: string;
  key: string;
  name: string;
  defaultIntervalKm: number | null;
  defaultIntervalMonths: number | null;
  intervalOptions: { km: number | null; months: number | null; label: string }[];
  active: boolean;
}

export interface DResource {
  id: string;
  name: string;
  kind: ResourceKind;
  active: boolean;
}

export interface DProposal {
  id: string;
  startsAt: Iso;
  endsAt: Iso;
  status: ProposalStatus;
  createdAt: Iso;
  respondedAt: Iso | null;
}

export interface DAppointment {
  id: string;
  kind: AppointmentKind;
  status: AppointmentStatus;
  customerId: string;
  vehicleId: string;
  workOrderId: string | null;
  startsAt: Iso;
  endsAt: Iso;
  resourceId: string | null;
  assigneeIds: string[];
  requestedBy: 'customer' | 'staff';
  customerNote: string | null;
  internalNote: string | null;
  proposals: DProposal[];
  confirmedAt: Iso | null;
  cancelledAt: Iso | null;
  cancelReason: string | null;
  createdAt: Iso;
}

export interface DWorkOrder {
  id: string;
  orderNumber: string;
  customerId: string;
  vehicleId: string;
  status: WorkOrderStatus;
  title: string;
  descriptionCustomer: string | null;
  notesInternal: string | null;
  costLimitCents: number | null;
  plannedStart: Iso | null;
  plannedEnd: Iso | null;
  readyForPickupAt: Iso | null;
  pickedUpAt: Iso | null;
  completionReviewedAt: Iso | null;
  completionReviewedBy: string | null;
  cancelledAt: Iso | null;
  cancelReason: string | null;
  assigneeIds: string[];
  createdAt: Iso;
  updatedAt: Iso;
}

export interface DWorkItem {
  id: string;
  workOrderId: string;
  position: number;
  kind: WorkItemKind;
  title: string;
  description: string | null;
  maintenanceTypeId: string | null;
  intervalKm: number | null;
  intervalMonths: number | null;
  quantity: number;
  unit: string;
  unitPriceCents: number | null;
  vatRateBp: number;
  origin: WorkItemOrigin;
  authorization: WorkItemAuthorization;
  executionStatus: WorkItemExecutionStatus;
  approvalRequestId: string | null;
  approvedVersionId: string | null;
  assignedTo: string | null;
  doneAt: Iso | null;
  doneBy: string | null;
  doneOdometerKm: number | null;
  resultNotes: string | null;
  trackedMinutes: number;
  runningSince: Iso | null;
  parts: { partNumber: string | null; description: string; quantity: number; unitPriceCents: number | null }[];
}

export interface DIntake {
  id: string;
  workOrderId: string;
  odometerKm: number | null;
  fuelLevel: string | null;
  customerComplaint: string;
  damages: { area: string; description: string; photoId: string | null }[];
  agreedServices: string;
  costLimitCents: number | null;
  notesInternal: string | null;
  notesCustomer: string | null;
  confirmedAt: Iso | null;
  /** erste Bestätigung; bleibt gesetzt, auch wenn eine Änderung die Bestätigung aufhebt (R-ANN-3) */
  firstConfirmedAt?: Iso | null;
  confirmationMethod: IntakeConfirmationMethod;
  contentHash: string | null;
}

export interface DFinding {
  id: string;
  workOrderId: string;
  workItemId: string | null;
  description: string;
  severity: FindingSeverity;
  status: FindingStatus;
  reportedBy: string;
  dictated: boolean;
  photoIds: string[];
  createdAt: Iso;
}

export interface DFile {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  /** Demo: lokales Bild des Nutzers (blob:/file:) */
  localUri: string | null;
  /** Demo: neutraler Platzhalter statt Foto */
  placeholderLabel: string | null;
}

export interface DPhoto {
  id: string;
  workOrderId: string;
  fileId: string;
  context: PhotoContext;
  findingId: string | null;
  visibility: Visibility;
  caption: string | null;
  takenAt: Iso;
}

export interface DApprovalDecision {
  id: string;
  versionId: string;
  decision: ApprovalDecisionValue;
  decidedByUserId: string;
  decidedByDisplayName: string;
  customerId: string;
  decidedAt: Iso;
  contentHash: string;
  channel: ClientChannel;
  comment: string | null;
}

export interface DApprovalVersion {
  id: string;
  versionNo: number;
  summaryCustomer: string;
  lines: ApprovalLine[];
  totalNetCents: number;
  totalGrossCents: number;
  currency: 'EUR';
  scheduleChange: string | null;
  newReadyAt: Iso | null;
  photoIds: string[];
  documentVersionId: string | null;
  contentHash: string;
  createdBy: string;
  sentAt: Iso | null;
  supersededAt: Iso | null;
  decision: DApprovalDecision | null;
}

export interface DApprovalRequest {
  id: string;
  workOrderId: string;
  kind: ApprovalKind;
  title: string;
  status: ApprovalRequestStatus;
  findingId: string | null;
  createdBy: string;
  createdAt: Iso;
  versions: DApprovalVersion[];
}

export interface DDocumentVersion {
  id: string;
  versionNo: number;
  fileId: string;
  note: string | null;
  createdAt: Iso;
}

export interface DDocument {
  id: string;
  kind: DocumentKind;
  title: string;
  customerId: string | null;
  vehicleId: string | null;
  workOrderId: string | null;
  visibility: Visibility;
  publishedAt: Iso | null;
  createdAt: Iso;
  deletedAt: Iso | null;
  versions: DDocumentVersion[];
}

export interface DMessage {
  id: string;
  workOrderId: string;
  authorUserId: string;
  body: string;
  /** Anhänge sind Fotos (Kontext `chat`, für den Kunden sichtbar), wie in der API. */
  photoIds: string[];
  clientMessageId: string | null;
  createdAt: Iso;
}

export interface DConversationRead {
  workOrderId: string;
  userId: string;
  lastReadAt: Iso;
}

export interface DInternalNote {
  id: string;
  workOrderId: string;
  authorUserId: string;
  body: string;
  createdAt: Iso;
}

export interface DInvoice {
  id: string;
  invoiceNumber: string | null;
  workOrderId: string | null;
  customerId: string;
  status: InvoiceStatus;
  issuedAt: Iso | null;
  dueDate: IsoDate | null;
  totalGrossCents: number;
  currency: 'EUR';
  vatBreakdown: { vatRateBp: number; netCents: number; vatCents: number }[];
  documentId: string | null;
  createdAt: Iso;
  cancelledAt: Iso | null;
}

export interface DCheckout {
  id: string;
  invoiceId: string;
  provider: 'sumup';
  checkoutReference: string;
  providerCheckoutId: string;
  amountCents: number;
  currency: 'EUR';
  status: CheckoutStatus;
  hostedUrl: string;
  validUntil: Iso;
  lastCheckedAt: Iso | null;
  providerTransactionId: string | null;
  createdByUserId: string;
  createdAt: Iso;
}

export interface DPayment {
  id: string;
  invoiceId: string;
  method: PaymentMethod;
  amountCents: number;
  currency: 'EUR';
  provider: 'sumup' | null;
  providerTransactionId: string | null;
  checkoutId: string | null;
  receivedAt: Iso;
  recordedBy: string | null;
  referenceText: string | null;
}

export interface DRefund {
  id: string;
  paymentId: string;
  amountCents: number;
  status: RefundStatus;
  idempotencyKey: string;
  requestedBy: string;
  requestedAt: Iso;
  completedAt: Iso | null;
  failureReason: string | null;
}

/** Simulierter Zustand beim Zahlungsanbieter (nur Demo). */
export interface DProviderCheckout {
  providerCheckoutId: string;
  checkoutReference: string;
  merchantCode: string;
  amountCents: number;
  currency: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED';
  transactionId: string | null;
}

export interface DProviderEvent {
  dedupeKey: string;
  eventType: string;
  providerObjectId: string;
  receiveCount: number;
  firstReceivedAt: Iso;
  lastReceivedAt: Iso;
  processedAt: Iso | null;
  result: string | null;
}

export interface DServiceEntry {
  id: string;
  vehicleId: string;
  workOrderId: string | null;
  workItemId: string | null;
  maintenanceTypeId: string | null;
  performedOn: IsoDate;
  odometerKm: number | null;
  title: string;
  details: string | null;
  workshopName: string;
  intervalKm: number | null;
  intervalMonths: number | null;
  nextDueDate: IsoDate | null;
  nextDueKm: number | null;
  status: ServiceEntryStatus;
  revisionOfId: string | null;
  revisionNo: number;
  correctionReason: string | null;
  source: 'work_completion';
  createdBy: string | null;
  createdAt: Iso;
}

export interface DVehicleShare {
  id: string;
  vehicleId: string;
  customerId: string;
  createdByUserId: string;
  tokenHash: string;
  label: string;
  includeVin: boolean;
  serviceEntryIds: string[];
  expiresAt: Iso;
  revokedAt: Iso | null;
  accessCount: number;
  lastAccessedAt: Iso | null;
  createdAt: Iso;
}

export interface DNotification {
  id: string;
  userId: string;
  eventType: NotificationEvent;
  title: string;
  body: string;
  targetPath: string;
  createdAt: Iso;
  readAt: Iso | null;
}

export interface DAudit {
  id: string;
  occurredAt: Iso;
  actorUserId: string | null;
  actorRole: Role | null;
  action: string;
  entityType: string;
  entityId: string | null;
  data: Record<string, unknown>;
}

export interface DSettings {
  name: string;
  legalName: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  vatId: string | null;
  iban: string | null;
  bic: string | null;
  bankName: string | null;
  openingHours: { weekday: number; opens: string; closes: string }[];
  paymentTermDays: number;
  paymentProvider: 'none' | 'sumup';
  sumupMerchantCode: string | null;
  paymentProviderConfigured: boolean;
}

export interface DNotificationPreference {
  userId: string;
  eventType: NotificationEvent;
  channel: 'push' | 'email';
  enabled: boolean;
}

/** Teilebedarf eines Auftrags (Tabelle `part_demands`; Konfliktprüfung "fehlende Teile"). */
export interface DPartDemand {
  id: string;
  workOrderId: string;
  description: string;
  status: 'needed' | 'ordered' | 'received' | 'installed';
  expectedAt: Iso | null;
}

/** Arbeitszeit eines Mitarbeiters (Tabelle `staff_working_hours`), Wochentag 1 = Montag. */
export interface DWorkingHours {
  userId: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

export interface DemoState {
  schemaVersion: number;
  seededAt: Iso;
  settings: DSettings;
  users: DUser[];
  customers: DCustomer[];
  customerAccounts: DCustomerAccount[];
  tokens: DToken[];
  vehicles: DVehicle[];
  ownerships: DOwnership[];
  odometer: DOdometer[];
  maintenanceTypes: DMaintenanceType[];
  resources: DResource[];
  appointments: DAppointment[];
  workOrders: DWorkOrder[];
  workItems: DWorkItem[];
  intakes: DIntake[];
  findings: DFinding[];
  files: DFile[];
  photos: DPhoto[];
  approvals: DApprovalRequest[];
  documents: DDocument[];
  messages: DMessage[];
  reads: DConversationRead[];
  internalNotes: DInternalNote[];
  invoices: DInvoice[];
  checkouts: DCheckout[];
  payments: DPayment[];
  refunds: DRefund[];
  providerCheckouts: DProviderCheckout[];
  providerEvents: DProviderEvent[];
  serviceEntries: DServiceEntry[];
  shares: DVehicleShare[];
  notifications: DNotification[];
  notificationPreferences: DNotificationPreference[];
  audit: DAudit[];
  partDemands: DPartDemand[];
  workingHours: DWorkingHours[];
  counters: { workOrder: number; invoice: number; customer: number };
}

/** Bei Änderungen am Zustandsmodell erhöhen: ältere Speicherstände werden verworfen. */
export const DEMO_SCHEMA_VERSION = 2;
