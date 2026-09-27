/**
 * Fehlercodes der API (Feld `error.code` im Fehlerformat `ApiError`, siehe dto.ts).
 *
 * Eine Liste für API und Clients: Die API (`apps/api`) sendet genau diese Werte, die App
 * (`apps/app`, HttpApi und DemoApi) wertet sie aus. Werte sind klein geschrieben mit
 * Unterstrich. Fachliche Ablehnungen aus `@werkstatt/domain` übernimmt die API als
 * kleingeschriebenen Domain-Code (z. B. `VERSION_SUPERSEDED` → `version_superseded`); auch
 * diese stehen hier, damit Clients nicht raten müssen.
 *
 * Statuscodes: 400 ungültige Eingabe, 401 nicht angemeldet, 403 keine Berechtigung (nur
 * Mitarbeiter; Kunden erhalten für Fremdes 404), 404 nicht vorhanden, 409 Zustandskonflikt,
 * 410 abgelaufen/widerrufen, 413/415 Datei, 422 fachliche Ablehnung, 429 zu viele Anfragen.
 */

export const API_ERROR_CODES = {
  // Allgemein ---------------------------------------------------------------------------
  badRequest: 'bad_request',
  validationFailed: 'validation_failed',
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  notFound: 'not_found',
  conflict: 'conflict',
  internalError: 'internal_error',
  tooManyRequests: 'too_many_requests',
  payloadTooLarge: 'payload_too_large',
  unsupportedMediaType: 'unsupported_media_type',
  unsupportedFileType: 'unsupported_file_type',
  notAnImage: 'not_an_image',
  pdfRequired: 'pdf_required',
  idInUse: 'id_in_use',
  missingPermission: 'missing_permission',

  // Idempotenz --------------------------------------------------------------------------
  invalidIdempotencyKey: 'invalid_idempotency_key',
  idempotencyKeyReused: 'idempotency_key_reused',
  idempotencyConflict: 'idempotency_conflict',
  idempotencyInProgress: 'idempotency_in_progress',

  // Anmeldung, Konten, Mitarbeiter -------------------------------------------------------
  invalidCredentials: 'invalid_credentials',
  tooManyAttempts: 'too_many_attempts',
  accountDisabled: 'account_disabled',
  accountInactive: 'account_inactive',
  invitationInvalid: 'invitation_invalid',
  resetInvalid: 'reset_invalid',
  invalidCurrentPassword: 'invalid_current_password',
  emailTaken: 'email_taken',
  accountExists: 'account_exists',
  noAccount: 'no_account',
  notDisabled: 'not_disabled',
  permissionChangeRejected: 'permission_change_rejected',
  customerHasNoPermissions: 'customer_has_no_permissions',
  unknownPermission: 'unknown_permission',
  duplicateOverride: 'duplicate_override',
  permissionNotAssignable: 'permission_not_assignable',
  invalidRole: 'invalid_role',
  notStaff: 'not_staff',
  lastAdminRoleChange: 'last_admin_role_change',
  lastAdminUsersManage: 'last_admin_users_manage',
  lastAdminDisable: 'last_admin_disable',

  // Kunden, Fahrzeuge, Servicehistorie, Freigaben für Dritte ------------------------------
  invalidCustomer: 'invalid_customer',
  customerInvalid: 'customer_invalid',
  customerRequired: 'customer_required',
  customerMismatch: 'customer_mismatch',
  invalidVehicle: 'invalid_vehicle',
  vinTaken: 'vin_taken',
  invalidVin: 'invalid_vin',
  ownerInvalid: 'owner_invalid',
  vehicleNotOwnedByCustomer: 'vehicle_not_owned_by_customer',
  recordedInFuture: 'recorded_in_future',
  notCurrent: 'not_current',
  sameCustomer: 'same_customer',
  beforeCurrentStart: 'before_current_start',
  inFuture: 'in_future',
  reasonRequired: 'reason_required',
  noChanges: 'no_changes',
  invalidValue: 'invalid_value',
  invalidEntries: 'invalid_entries',
  expiresInPast: 'expires_in_past',
  expiresTooLate: 'expires_too_late',
  shareExpired: 'share_expired',
  shareRevoked: 'share_revoked',
  keyTaken: 'key_taken',

  // Termine -----------------------------------------------------------------------------
  schedulingConflicts: 'scheduling_conflicts',
  sameStatus: 'same_status',
  transitionNotAllowed: 'transition_not_allowed',
  notAllowedForRole: 'not_allowed_for_role',
  notOwnAppointment: 'not_own_appointment',
  proposalNotOpen: 'proposal_not_open',
  invalidTimeRange: 'invalid_time_range',

  // Aufträge, Annahme, Positionen, Feststellungen, Fotos ----------------------------------
  workOrderClosed: 'work_order_closed',
  workOrderMismatch: 'work_order_mismatch',
  invalidWorkOrder: 'invalid_work_order',
  invalidAssignee: 'invalid_assignee',
  itemsNotFinished: 'items_not_finished',
  noOpenItems: 'no_open_items',
  notReady: 'not_ready',
  intakeChanged: 'intake_changed',
  /** Nach bestätigter Annahme: weitere Arbeiten nur über eine Freigabeanfrage (R-ANN-3). */
  approvalRequired: 'approval_required',
  approvalBound: 'approval_bound',
  approvalInExecution: 'approval_in_execution',
  itemFinished: 'item_finished',
  invalidOccurredAt: 'invalid_occurred_at',
  invalidWorkItem: 'invalid_work_item',
  notAuthorized: 'not_authorized',
  invalidStatus: 'invalid_status',
  /** Wartungsposition ohne km-Stand abgeschlossen (ohne ausdrückliches "km unbekannt"). */
  odometerRequired: 'odometer_required',
  invalidOdometer: 'invalid_odometer',
  invalidFinding: 'invalid_finding',
  findingClosed: 'finding_closed',
  invalidPhotos: 'invalid_photos',
  invalidDocument: 'invalid_document',

  // Freigaben ---------------------------------------------------------------------------
  invalidContent: 'invalid_content',
  notDraft: 'not_draft',
  requestWithdrawn: 'request_withdrawn',
  versionNotCurrent: 'version_not_current',
  alreadyWithdrawn: 'already_withdrawn',
  /** Die angezeigte Version ist nicht mehr die aktuelle (neue Version gesendet). */
  versionSuperseded: 'version_superseded',
  /** Der Inhalts-Hash passt nicht zur aktuellen Version. */
  hashMismatch: 'hash_mismatch',
  alreadyDecided: 'already_decided',
  notPending: 'not_pending',
  withdrawn: 'withdrawn',
  notCustomer: 'not_customer',

  // Rechnungen und Zahlungen ------------------------------------------------------------
  invoiceNumberTaken: 'invoice_number_taken',
  alreadyCancelled: 'already_cancelled',
  invoiceDraft: 'invoice_draft',
  invoiceCancelled: 'invoice_cancelled',
  nothingOpen: 'nothing_open',
  invoiceNotIssued: 'invoice_not_issued',
  paymentProviderUnavailable: 'payment_provider_unavailable',
  onlinePaymentUnavailable: 'online_payment_unavailable',
  invalidMethod: 'invalid_method',
  invalidAmount: 'invalid_amount',
  invalidReceivedAt: 'invalid_received_at',
  receivedInFuture: 'received_in_future',
  referenceRequired: 'reference_required',
  exceedsOpenAmount: 'exceeds_open_amount',
  exceedsRefundable: 'exceeds_refundable',

  // Chat ----------------------------------------------------------------------------------
  clientMessageIdInUse: 'client_message_id_in_use',
} as const;

export type ApiErrorCodeKey = keyof typeof API_ERROR_CODES;
export type ApiErrorCode = (typeof API_ERROR_CODES)[ApiErrorCodeKey];

/**
 * Codes, die nur im Client entstehen (nie von der API gesendet).
 * `network`: keine Verbindung (Status 0). `response_invalid`: Antwort passt nicht zum Vertrag.
 */
export const CLIENT_ERROR_CODES = {
  network: 'network',
  responseInvalid: 'response_invalid',
} as const;

export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[keyof typeof CLIENT_ERROR_CODES];

const API_CODE_SET: ReadonlySet<string> = new Set(Object.values(API_ERROR_CODES));

export function isApiErrorCode(code: string): code is ApiErrorCode {
  return API_CODE_SET.has(code);
}

/** Übernahme eines fachlichen Domain-Codes (`VERSION_SUPERSEDED`) in die API-Schreibweise. */
export function apiCodeFromDomain(domainCode: string): string {
  return domainCode.toLowerCase();
}

/**
 * Freigabe-Entscheidung zu einer veralteten Fassung: Die Werkstatt hat inzwischen eine neue
 * Version gesendet oder der Inhalt passt nicht mehr (Oberfläche: "Das Angebot wurde geändert").
 */
export function isApprovalOutdatedCode(code: string): boolean {
  return code === API_ERROR_CODES.versionSuperseded || code === API_ERROR_CODES.hashMismatch;
}
