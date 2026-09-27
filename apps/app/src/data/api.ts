/**
 * WerkstattApi: die eine Schnittstelle, über die alle Oberflächen (Kunde, Werkstatt,
 * Mechaniker) auf Daten zugreifen. Zwei Implementierungen:
 *
 * - HttpApi (src/data/http.ts): echte API unter EXPO_PUBLIC_API_URL + /api/v1.
 * - DemoApi (src/data/demo/DemoApi.ts): In-Memory mit gekennzeichneten Beispieldaten.
 *
 * Methoden entsprechen den Endpunkten in packages/contracts/src/api.ts (Name = Endpunktname).
 * Alle Fehler sind ApiError (src/data/errors.ts). Rechte werden von der API bzw. DemoApi
 * geprüft, nie nur in der Oberfläche.
 */
import type {
  AcceptInvitationRequestSchema,
  Appointment,
  AppointmentInputSchema,
  AppointmentRequestInputSchema,
  AppointmentStatus,
  ApprovalDecisionRequest,
  ApprovalDraftInput,
  ApprovalOverviewStatus,
  ApprovalRequest,
  AttachPhotoRequestSchema,
  CustomerAccessStatus,
  InvoiceStatus,
  AuditEntry,
  CancelRequestSchema,
  ChangePasswordRequestSchema,
  CompleteReviewRequestSchema,
  ConfirmIntakeRequestSchema,
  Conversation,
  CreateDocumentRequestSchema,
  CreateInvoiceRequestSchema,
  CreateVehicleShareRequestSchema,
  CreateWorkOrderRequestSchema,
  CustomerDetail,
  CustomerInput,
  CustomerSummary,
  DashboardTile,
  DocumentDto,
  DocumentKind,
  FileRef,
  Finding,
  FindingInputSchema,
  FinishWorkItemRequestSchema,
  Intake,
  IntakeInputSchema,
  InternalNote,
  InviteStaffRequestSchema,
  Invoice,
  IssueInvoiceRequestSchema,
  LoginRequest,
  LoginResponse,
  MaintenanceDue,
  MaintenanceType,
  ManualPaymentRequestSchema,
  Message,
  NotDoneWorkItemRequestSchema,
  NotificationChannel,
  NotificationDto,
  NotificationEvent,
  OdometerInputSchema,
  OdometerReading,
  Ownership,
  OwnershipTransferRequestSchema,
  PartUsedInputSchema,
  PaymentStatus,
  Photo,
  ProposeAlternativeRequestSchema,
  PublicVehicleView,
  QrResolution,
  RefundRequestSchema,
  Resource,
  SchedulingConflict,
  SendMessageRequestSchema,
  ServiceEntry,
  ServiceEntryCorrectionRequestSchema,
  SessionUser,
  StaffUser,
  StartCheckoutResponse,
  TimelineEntry,
  UpdateStaffRequestSchema,
  UpdateWorkOrderRequestSchema,
  VehicleDetail,
  VehicleInput,
  VehicleShare,
  VehicleSummary,
  Visibility,
  WorkItem,
  WorkItemInputSchema,
  WorkOrderDetail,
  WorkOrderStatus,
  WorkOrderSummary,
  WorkOrderTransitionRequestSchema,
  WorkshopSettings,
} from '@werkstatt/contracts';
import type { z } from 'zod';

// ---------------------------------------------------------------------------
// Eingabetypen (z.input: Felder mit Standardwert sind optional)
// ---------------------------------------------------------------------------

export type Page<T> = { items: T[]; nextCursor: string | null };

export type AcceptInvitationInput = z.input<typeof AcceptInvitationRequestSchema>;
export type ChangePasswordInput = z.input<typeof ChangePasswordRequestSchema>;
export type InviteStaffInput = z.input<typeof InviteStaffRequestSchema>;
export type UpdateStaffInput = z.input<typeof UpdateStaffRequestSchema>;
export type CustomerInputData = z.input<typeof import('@werkstatt/contracts').CustomerInputSchema>;
export type VehicleInputData = z.input<typeof import('@werkstatt/contracts').VehicleInputSchema>;
export type OdometerInput = z.input<typeof OdometerInputSchema>;
export type OwnershipTransferInput = z.input<typeof OwnershipTransferRequestSchema>;
export type AppointmentInput = z.input<typeof AppointmentInputSchema>;
export type AppointmentRequestInput = z.input<typeof AppointmentRequestInputSchema>;
export type ProposeAlternativeInput = z.input<typeof ProposeAlternativeRequestSchema>;
export type CancelInput = z.input<typeof CancelRequestSchema>;
export type CreateWorkOrderInput = z.input<typeof CreateWorkOrderRequestSchema>;
export type UpdateWorkOrderInput = z.input<typeof UpdateWorkOrderRequestSchema>;
export type WorkOrderTransitionInput = z.input<typeof WorkOrderTransitionRequestSchema>;
export type IntakeInputData = z.input<typeof IntakeInputSchema>;
export type ConfirmIntakeInput = z.input<typeof ConfirmIntakeRequestSchema>;
export type WorkItemInputData = z.input<typeof WorkItemInputSchema>;
export type FinishWorkItemInput = z.input<typeof FinishWorkItemRequestSchema>;
export type NotDoneWorkItemInput = z.input<typeof NotDoneWorkItemRequestSchema>;
export type PartUsedInput = z.input<typeof PartUsedInputSchema>;
export type FindingInput = z.input<typeof FindingInputSchema>;
export type CompleteReviewInput = z.input<typeof CompleteReviewRequestSchema>;
export type AttachPhotoInput = z.input<typeof AttachPhotoRequestSchema>;
export type CreateDocumentInput = z.input<typeof CreateDocumentRequestSchema>;
export type SendMessageInput = z.input<typeof SendMessageRequestSchema>;
export type CreateInvoiceInput = z.input<typeof CreateInvoiceRequestSchema>;
export type IssueInvoiceInput = z.input<typeof IssueInvoiceRequestSchema>;
export type ManualPaymentInput = z.input<typeof ManualPaymentRequestSchema>;
export type RefundInput = z.input<typeof RefundRequestSchema>;
export type ServiceEntryCorrectionInput = z.input<typeof ServiceEntryCorrectionRequestSchema>;
export type CreateVehicleShareInput = z.input<typeof CreateVehicleShareRequestSchema>;
export type ApprovalDecisionInput = ApprovalDecisionRequest;
export type ApprovalDraft = ApprovalDraftInput;

export type { CustomerInput, LoginRequest, VehicleInput };

// ---------------------------------------------------------------------------
// Abfrageparameter für Listen
// ---------------------------------------------------------------------------

export interface ListCustomersQuery {
  q?: string;
  /** Zugangsstatus zur App (wie die API: none, invited, active, disabled) */
  access?: CustomerAccessStatus;
  openItems?: boolean;
  cursor?: string;
}

export interface ListVehiclesQuery {
  q?: string;
  customerId?: string;
  cursor?: string;
}

export interface ListAppointmentsQuery {
  from?: string;
  to?: string;
  status?: AppointmentStatus;
  resourceId?: string;
  assigneeId?: string;
}

export interface ListWorkOrdersQuery {
  /** Arbeitsstatus; `active` = offen, in Arbeit oder Arbeiten erledigt */
  work?: WorkOrderStatus | 'active';
  /** Suche in Auftragsnummer und Titel */
  q?: string;
  approval?: ApprovalOverviewStatus;
  payment?: PaymentStatus;
  assigneeId?: string;
  readyForPickup?: boolean;
  customerId?: string;
  vehicleId?: string;
  cursor?: string;
}

export interface ListDocumentsQuery {
  workOrderId?: string;
  vehicleId?: string;
  customerId?: string;
  kind?: DocumentKind;
}

export interface ListInvoicesQuery {
  status?: InvoiceStatus;
  paymentStatus?: PaymentStatus;
  overdue?: boolean;
  customerId?: string;
}

export interface ListAuditQuery {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  action?: string;
  limit?: number;
}

/** Konfliktprüfung (Körper von POST /appointments/conflicts, siehe Übergabe API Abschnitt 8). */
export interface ConflictCheckInput {
  /** bestehender Termin (wird nicht mit sich selbst verglichen) */
  id?: string | null;
  startsAt: string;
  endsAt: string;
  resourceId?: string | null;
  assigneeIds?: string[];
  workOrderId?: string | null;
}

/**
 * Optionen für schreibende Aufrufe, die auch aus der Offline-Warteschlange kommen: gleicher
 * `Idempotency-Key` bei jeder Wiederholung, damit der Server nichts doppelt ausführt.
 */
export interface WriteOptions {
  idempotencyKey?: string;
}

// ---------------------------------------------------------------------------
// Dateien und Bilder
// ---------------------------------------------------------------------------

export interface UploadInput {
  /** Lokale URI (nativ file://, im Browser blob:) */
  uri: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
}

/** Quelle für expo-image; Kopfzeilen tragen die Anmeldung (Inhalt nur nach Rechteprüfung). */
export interface ImageSourceSpec {
  uri: string;
  headers?: Record<string, string>;
  /** Demo: kein echtes Bild, Platzhalter mit dieser Beschriftung anzeigen */
  placeholderLabel?: string;
}

export interface DownloadResult {
  uri: string;
  fileName: string;
  mimeType: string;
}

export interface NotificationPreference {
  eventType: NotificationEvent;
  channel: Exclude<NotificationChannel, 'in_app'>;
  enabled: boolean;
}

export interface RegisterDeviceInput {
  platform: 'ios' | 'android' | 'web' | 'windows';
  pushToken: string;
}

// ---------------------------------------------------------------------------
// Schnittstelle
// ---------------------------------------------------------------------------

export interface WerkstattApi {
  readonly mode: 'http' | 'demo';

  /** Sitzungstoken für folgende Anfragen setzen (null = abgemeldet). */
  setToken(token: string | null): void;

  // Anmeldung und Konto
  login(input: LoginRequest): Promise<LoginResponse>;
  logout(): Promise<void>;
  me(): Promise<SessionUser>;
  acceptInvitation(input: AcceptInvitationInput): Promise<LoginResponse>;
  forgotPassword(input: { email: string }): Promise<void>;
  resetPassword(input: { token: string; password: string }): Promise<void>;
  changePassword(input: ChangePasswordInput): Promise<void>;

  // Mitarbeiter (users.manage)
  listUsers(): Promise<StaffUser[]>;
  inviteUser(input: InviteStaffInput): Promise<StaffUser>;
  getUser(id: string): Promise<StaffUser>;
  updateUser(id: string, input: UpdateStaffInput): Promise<StaffUser>;
  disableUser(id: string): Promise<StaffUser>;
  enableUser(id: string): Promise<StaffUser>;

  // Dashboard
  dashboard(): Promise<DashboardTile[]>;

  // Kunden
  listCustomers(query?: ListCustomersQuery): Promise<Page<CustomerSummary>>;
  createCustomer(input: CustomerInputData): Promise<CustomerDetail>;
  getCustomer(id: string): Promise<CustomerDetail>;
  updateCustomer(id: string, input: Partial<CustomerInputData>): Promise<CustomerDetail>;
  archiveCustomer(id: string): Promise<CustomerDetail>;
  inviteCustomer(id: string, input: { email: string }): Promise<CustomerDetail>;
  disableCustomerAccount(id: string): Promise<CustomerDetail>;
  /** Datenexport eines Kunden (ZIP, customers.read + reports.export), DSGVO Art. 15/20 */
  exportCustomerData(customerId: string): Promise<DownloadResult>;

  // Fahrzeuge
  listVehicles(query?: ListVehiclesQuery): Promise<Page<VehicleSummary>>;
  createVehicle(input: VehicleInputData): Promise<VehicleDetail>;
  getVehicle(id: string): Promise<VehicleDetail>;
  updateVehicle(id: string, input: Partial<VehicleInputData>): Promise<VehicleDetail>;
  listOdometer(vehicleId: string): Promise<OdometerReading[]>;
  addOdometer(vehicleId: string, input: OdometerInput): Promise<OdometerReading>;
  listOwnerships(vehicleId: string): Promise<Ownership[]>;
  transferOwnership(vehicleId: string, input: OwnershipTransferInput): Promise<VehicleDetail>;
  setQrPublicView(vehicleId: string, enabled: boolean): Promise<VehicleDetail>;
  rotateQr(vehicleId: string): Promise<VehicleDetail>;
  /** URL des QR-Aufklebers (SVG), nur mit Anmeldung abrufbar */
  qrStickerSource(vehicleId: string): ImageSourceSpec;
  listServiceEntries(vehicleId: string): Promise<ServiceEntry[]>;
  getServiceEntry(id: string): Promise<ServiceEntry>;
  correctServiceEntry(id: string, input: ServiceEntryCorrectionInput): Promise<ServiceEntry>;
  maintenanceDue(vehicleId: string): Promise<MaintenanceDue[]>;
  /** Standard: nur überfällige und bald fällige; `all: true` für alle */
  maintenanceDueAll(options?: { all?: boolean }): Promise<MaintenanceDue[]>;
  listShares(vehicleId: string): Promise<VehicleShare[]>;
  createShare(vehicleId: string, input: CreateVehicleShareInput): Promise<VehicleShare>;
  revokeShare(shareId: string): Promise<VehicleShare>;

  // Termine
  listAppointments(query?: ListAppointmentsQuery): Promise<Appointment[]>;
  createAppointment(input: AppointmentInput): Promise<Appointment>;
  requestAppointment(input: AppointmentRequestInput): Promise<Appointment>;
  getAppointment(id: string): Promise<Appointment>;
  checkConflicts(input: ConflictCheckInput): Promise<SchedulingConflict[]>;
  /** Bei Konflikten (409 scheduling_conflicts) nur mit Begründung */
  confirmAppointment(id: string, input?: { overrideConflictsReason?: string | null }): Promise<Appointment>;
  proposeAlternative(id: string, input: ProposeAlternativeInput): Promise<Appointment>;
  acceptProposal(appointmentId: string, proposalId: string): Promise<Appointment>;
  declineProposal(appointmentId: string, proposalId: string, input?: { cancel?: boolean }): Promise<Appointment>;
  cancelAppointment(id: string, input: CancelInput): Promise<Appointment>;
  listResources(): Promise<Resource[]>;

  // Aufträge
  listWorkOrders(query?: ListWorkOrdersQuery): Promise<Page<WorkOrderSummary>>;
  /** `draft: true` legt einen Entwurf an (für Kunden unsichtbar), sonst Status "Offen" */
  createWorkOrder(input: CreateWorkOrderInput, options?: { draft?: boolean }): Promise<WorkOrderDetail>;
  getWorkOrder(id: string): Promise<WorkOrderDetail>;
  updateWorkOrder(id: string, input: UpdateWorkOrderInput): Promise<WorkOrderDetail>;
  transitionWorkOrder(id: string, input: WorkOrderTransitionInput): Promise<WorkOrderDetail>;
  completeReview(id: string, input: CompleteReviewInput): Promise<WorkOrderDetail>;
  readyForPickup(id: string): Promise<WorkOrderDetail>;
  pickedUp(id: string): Promise<WorkOrderDetail>;
  setAssignees(id: string, userIds: string[]): Promise<WorkOrderDetail>;
  getIntake(workOrderId: string): Promise<Intake>;
  saveIntake(workOrderId: string, input: IntakeInputData): Promise<Intake>;
  confirmIntake(workOrderId: string, input: ConfirmIntakeInput): Promise<Intake>;
  addWorkItem(workOrderId: string, input: WorkItemInputData): Promise<WorkItem>;
  updateWorkItem(itemId: string, input: Partial<WorkItemInputData>): Promise<WorkItem>;
  startWorkItem(itemId: string, options?: WriteOptions): Promise<WorkItem>;
  pauseWorkItem(itemId: string, options?: WriteOptions): Promise<WorkItem>;
  /**
   * Abschluss. Bei Wartungspositionen ist der km-Stand Pflicht; ausdrücklich
   * `odometerKm: null` bedeutet "km-Stand unbekannt". Fehlt das Feld: 409 `odometer_required`.
   */
  finishWorkItem(itemId: string, input: FinishWorkItemInput, options?: WriteOptions): Promise<WorkItem>;
  notDoneWorkItem(itemId: string, input: NotDoneWorkItemInput, options?: WriteOptions): Promise<WorkItem>;
  /** Verbautes Teil; Mechaniker erfassen keine Preise. Antwort: Position */
  addPart(itemId: string, input: PartUsedInput, options?: WriteOptions): Promise<WorkItem>;
  listFindings(workOrderId: string): Promise<Finding[]>;
  /** idempotent über `input.id` (Client-UUID) */
  createFinding(workOrderId: string, input: FindingInput): Promise<Finding>;
  reportFinding(findingId: string, options?: WriteOptions): Promise<Finding>;
  dismissFinding(findingId: string): Promise<Finding>;
  listPhotos(workOrderId: string): Promise<Photo[]>;
  attachPhoto(workOrderId: string, input: AttachPhotoInput): Promise<Photo>;
  setPhotoVisibility(photoId: string, visibility: Visibility): Promise<Photo>;
  timeline(workOrderId: string): Promise<TimelineEntry[]>;

  // Freigaben
  listApprovals(workOrderId: string): Promise<ApprovalRequest[]>;
  createApproval(workOrderId: string, input: ApprovalDraft): Promise<ApprovalRequest>;
  getApproval(id: string): Promise<ApprovalRequest>;
  /** Entwurf ändern oder (nach dem Senden) neue Version erzeugen; alte Entscheidung verfällt. */
  reviseApproval(id: string, input: ApprovalDraft): Promise<ApprovalRequest>;
  sendApproval(id: string): Promise<ApprovalRequest>;
  withdrawApproval(id: string): Promise<ApprovalRequest>;
  /** Kundenentscheidung, gebunden an versionId + contentHash; veraltet → 409 */
  decideApproval(id: string, input: ApprovalDecisionInput): Promise<ApprovalRequest>;

  // Dateien und Dokumente
  uploadFile(input: UploadInput, options?: WriteOptions): Promise<FileRef>;
  listDocuments(query?: ListDocumentsQuery): Promise<DocumentDto[]>;
  createDocument(input: CreateDocumentInput): Promise<DocumentDto>;
  addDocumentVersion(documentId: string, input: { fileId: string; note?: string | null }): Promise<DocumentDto>;
  publishDocument(documentId: string): Promise<DocumentDto>;
  unpublishDocument(documentId: string): Promise<DocumentDto>;
  downloadDocument(documentId: string): Promise<DownloadResult>;
  /** Bildquelle für eine relative Inhalts-URL (Fotos, Chat-Anhänge) */
  imageSource(contentUrl: string): ImageSourceSpec;

  // Chat
  listConversations(): Promise<Conversation[]>;
  listMessages(workOrderId: string, after?: string): Promise<Message[]>;
  /** idempotent über clientMessageId (erneutes Senden erzeugt keine Dublette) */
  sendMessage(workOrderId: string, input: SendMessageInput): Promise<Message>;
  markRead(workOrderId: string): Promise<void>;
  listInternalNotes(workOrderId: string): Promise<InternalNote[]>;
  addInternalNote(workOrderId: string, input: { body: string }, options?: WriteOptions): Promise<InternalNote>;

  // Rechnungen und Zahlungen
  listInvoices(query?: ListInvoicesQuery): Promise<Invoice[]>;
  createInvoice(input: CreateInvoiceInput): Promise<Invoice>;
  getInvoice(id: string): Promise<Invoice>;
  issueInvoice(id: string, input: IssueInvoiceInput): Promise<Invoice>;
  cancelInvoice(id: string, input?: { reason?: string | null }): Promise<Invoice>;
  /** "Jetzt bezahlen": legt gehosteten Checkout an. Der Rechnungsstatus bleibt unverändert. */
  startCheckout(invoiceId: string): Promise<StartCheckoutResponse>;
  /** Offene Zahlungsversuche beim Anbieter prüfen (Status nur nach Serverprüfung) */
  refreshPaymentStatus(invoiceId: string): Promise<Invoice>;
  recordManualPayment(invoiceId: string, input: ManualPaymentInput): Promise<Invoice>;
  refundPayment(paymentId: string, input: RefundInput): Promise<Invoice>;
  exportInvoicesCsv(query?: ListInvoicesQuery): Promise<string>;

  // Benachrichtigungen
  listNotifications(options?: { unread?: boolean }): Promise<NotificationDto[]>;
  readNotification(id: string): Promise<void>;
  registerDevice(input: RegisterDeviceInput): Promise<void>;
  getNotificationPreferences(): Promise<NotificationPreference[]>;
  setNotificationPreferences(preferences: NotificationPreference[]): Promise<NotificationPreference[]>;

  // Einstellungen
  getSettings(): Promise<WorkshopSettings>;
  updateSettings(input: Partial<WorkshopSettings>): Promise<WorkshopSettings>;
  listMaintenanceTypes(): Promise<MaintenanceType[]>;
  upsertMaintenanceType(id: string, input: Omit<MaintenanceType, 'id'>): Promise<MaintenanceType>;
  upsertResource(id: string, input: Omit<Resource, 'id'>): Promise<Resource>;

  // Öffentlich (ohne Anmeldung; mit Sitzung prüft resolveQr die Berechtigung)
  resolveQr(token: string): Promise<QrResolution>;
  publicShare(token: string): Promise<PublicVehicleView>;
  health(): Promise<{ ok: boolean }>;

  // Datenschutz
  /** Eigene Daten als ZIP (Kunde), DSGVO Art. 15/20 */
  exportOwnData(): Promise<DownloadResult>;

  // Audit
  listAudit(query?: ListAuditQuery): Promise<AuditEntry[]>;
}

export type {
  Appointment,
  ApprovalRequest,
  CustomerDetail,
  CustomerSummary,
  DashboardTile,
  DocumentDto,
  Finding,
  Intake,
  Invoice,
  MaintenanceDue,
  Message,
  NotificationDto,
  Photo,
  ServiceEntry,
  SessionUser,
  VehicleDetail,
  VehicleShare,
  VehicleSummary,
  WorkItem,
  WorkOrderDetail,
  WorkOrderSummary,
};
