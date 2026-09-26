/**
 * API-Vertrag: alle Endpunkte mit Methode, Pfad und Kurzbeschreibung.
 * Präfix: /api/v1. Authentifizierung: `Authorization: Bearer <token>`.
 * Schreibende Anfragen dürfen einen `Idempotency-Key`-Header tragen (Offline-Warteschlange,
 * Verbindungsabbrüche); dieselbe Anfrage mit demselben Schlüssel wird nicht doppelt ausgeführt.
 *
 * Listen werden serverseitig nach Rolle und Objektregeln gefiltert (docs/rollen-und-rechte.md).
 * Nicht erlaubte oder nicht vorhandene Einzelobjekte liefern für Kunden 404.
 */

export const API_PREFIX = '/api/v1';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface EndpointDef {
  method: HttpMethod;
  path: string;
  summary: string;
  /** 'public' = ohne Anmeldung; sonst angemeldet, Rechte/Objektregeln serverseitig */
  auth: 'public' | 'session';
}

const e = (method: HttpMethod, path: string, summary: string, auth: 'public' | 'session' = 'session'): EndpointDef => ({
  method,
  path,
  summary,
  auth,
});

export const endpoints = {
  // Anmeldung und Konto
  login: e('POST', '/auth/login', 'Anmelden → LoginResponse', 'public'),
  logout: e('POST', '/auth/logout', 'Sitzung beenden'),
  me: e('GET', '/auth/me', 'Angemeldeter Benutzer → SessionUser'),
  acceptInvitation: e('POST', '/auth/invitations/accept', 'Einladung annehmen, Passwort setzen → LoginResponse', 'public'),
  forgotPassword: e('POST', '/auth/password/forgot', 'Rücksetzlink anfordern (Antwort immer 204)', 'public'),
  resetPassword: e('POST', '/auth/password/reset', 'Passwort mit Token setzen, alle Sitzungen beenden', 'public'),
  changePassword: e('POST', '/auth/password/change', 'Passwort ändern'),

  // Mitarbeiter (users.manage)
  listUsers: e('GET', '/users', 'Mitarbeiter → StaffUser[]'),
  inviteUser: e('POST', '/users/invite', 'Mitarbeiter einladen → StaffUser'),
  getUser: e('GET', '/users/:id', 'Mitarbeiter → StaffUser'),
  updateUser: e('PATCH', '/users/:id', 'Rolle/Rechte/Name ändern → StaffUser'),
  disableUser: e('POST', '/users/:id/disable', 'Zugang deaktivieren (Sitzungen enden)'),
  enableUser: e('POST', '/users/:id/enable', 'Zugang reaktivieren'),

  // Dashboard
  dashboard: e('GET', '/dashboard', 'Kacheln je Rolle → DashboardTile[]'),

  // Kunden
  listCustomers: e('GET', '/customers', 'Suche/Filter (?q, ?access, ?openItems) → Page<CustomerSummary>'),
  createCustomer: e('POST', '/customers', 'Kunde anlegen → CustomerDetail'),
  getCustomer: e('GET', '/customers/:id', 'Kundenakte → CustomerDetail'),
  updateCustomer: e('PATCH', '/customers/:id', 'Kunde ändern → CustomerDetail'),
  archiveCustomer: e('POST', '/customers/:id/archive', 'Kunde archivieren'),
  inviteCustomer: e('POST', '/customers/:id/account/invite', 'Kunden zur App einladen'),
  disableCustomerAccount: e('POST', '/customers/:id/account/disable', 'Kundenzugang sperren'),

  // Fahrzeuge
  listVehicles: e('GET', '/vehicles', 'Suche (?q, ?customerId) → Page<VehicleSummary>; Kunden: nur aktuelle eigene'),
  createVehicle: e('POST', '/vehicles', 'Fahrzeug mit Halter anlegen → VehicleDetail'),
  getVehicle: e('GET', '/vehicles/:id', 'Fahrzeugakte → VehicleDetail'),
  updateVehicle: e('PATCH', '/vehicles/:id', 'Fahrzeug ändern → VehicleDetail'),
  listOdometer: e('GET', '/vehicles/:id/odometer', 'km-Historie → OdometerReading[]'),
  addOdometer: e('POST', '/vehicles/:id/odometer', 'km-Stand erfassen → OdometerReading'),
  listOwnerships: e('GET', '/vehicles/:id/ownerships', 'Halterzeiträume → Ownership[] (nur Mitarbeiter)'),
  transferOwnership: e('POST', '/vehicles/:id/ownership-transfer', 'Halterwechsel buchen'),
  setQrPublicView: e('PUT', '/vehicles/:id/qr-public-view', 'Öffentliche QR-Kurzansicht ein/aus (Halter)'),
  rotateQr: e('POST', '/vehicles/:id/qr/rotate', 'QR-Token erneuern (Mitarbeiter)'),
  qrSticker: e('GET', '/vehicles/:id/qr/sticker.svg', 'QR-Aufkleber als SVG'),
  listServiceEntries: e('GET', '/vehicles/:id/service-entries', 'Servicehistorie → ServiceEntry[]'),
  getServiceEntry: e('GET', '/service-entries/:id', 'Serviceeintrag → ServiceEntry'),
  correctServiceEntry: e('POST', '/service-entries/:id/corrections', 'Korrektur als neue Revision → ServiceEntry'),
  maintenanceDue: e('GET', '/vehicles/:id/maintenance-due', 'Fälligkeiten → MaintenanceDue[]'),
  maintenanceDueAll: e('GET', '/maintenance-due', 'Fällige Wartungen aller Fahrzeuge (Werkstatt) → MaintenanceDue[]'),
  listShares: e('GET', '/vehicles/:id/shares', 'Freigaben für Dritte → VehicleShare[]'),
  createShare: e('POST', '/vehicles/:id/shares', 'Freigabe anlegen → VehicleShare (mit einmaligem Link)'),
  revokeShare: e('POST', '/shares/:id/revoke', 'Freigabe widerrufen'),

  // Termine
  listAppointments: e('GET', '/appointments', 'Termine (?from, ?to, ?status, ?resourceId, ?assigneeId) → Appointment[]'),
  createAppointment: e('POST', '/appointments', 'Termin anlegen (Werkstatt, bestätigt) → Appointment'),
  requestAppointment: e('POST', '/appointments/requests', 'Terminanfrage (Kunde, status=requested) → Appointment'),
  getAppointment: e('GET', '/appointments/:id', 'Termin → Appointment'),
  checkConflicts: e('POST', '/appointments/conflicts', 'Konfliktprüfung → SchedulingConflict[]'),
  confirmAppointment: e('POST', '/appointments/:id/confirm', 'Anfrage bestätigen → Appointment'),
  proposeAlternative: e('POST', '/appointments/:id/proposals', 'Alternative vorschlagen → Appointment'),
  acceptProposal: e('POST', '/appointments/:id/proposals/:proposalId/accept', 'Alternative annehmen (Kunde) → Appointment'),
  declineProposal: e('POST', '/appointments/:id/proposals/:proposalId/decline', 'Alternative ablehnen (Kunde) → Appointment'),
  cancelAppointment: e('POST', '/appointments/:id/cancel', 'Termin absagen → Appointment'),
  listResources: e('GET', '/resources', 'Hebebühnen/Arbeitsplätze → Resource[]'),

  // Aufträge
  listWorkOrders: e('GET', '/work-orders', 'Aufträge (?work, ?approval, ?payment, ?assigneeId, ?readyForPickup, ?customerId, ?vehicleId) → Page<WorkOrderSummary>'),
  createWorkOrder: e('POST', '/work-orders', 'Auftrag anlegen → WorkOrderDetail'),
  getWorkOrder: e('GET', '/work-orders/:id', 'Auftrag → WorkOrderDetail'),
  updateWorkOrder: e('PATCH', '/work-orders/:id', 'Auftrag ändern → WorkOrderDetail'),
  transitionWorkOrder: e('POST', '/work-orders/:id/transition', 'Arbeitsstatus weiterschalten → WorkOrderDetail'),
  completeReview: e('POST', '/work-orders/:id/complete-review', 'Fachlichen Abschluss bestätigen (erzeugt Serviceeinträge) → WorkOrderDetail'),
  readyForPickup: e('POST', '/work-orders/:id/ready-for-pickup', 'Abholbereit melden → WorkOrderDetail'),
  pickedUp: e('POST', '/work-orders/:id/picked-up', 'Abgeholt → WorkOrderDetail'),
  setAssignees: e('PUT', '/work-orders/:id/assignees', 'Mechaniker zuweisen → WorkOrderDetail'),
  getIntake: e('GET', '/work-orders/:id/intake', 'Annahme → Intake'),
  saveIntake: e('PUT', '/work-orders/:id/intake', 'Annahme speichern → Intake'),
  confirmIntake: e('POST', '/work-orders/:id/intake/confirm', 'Annahme bestätigen lassen → Intake'),
  addWorkItem: e('POST', '/work-orders/:id/items', 'Position hinzufügen (vereinbart) → WorkItem'),
  updateWorkItem: e('PATCH', '/work-items/:id', 'Position ändern (nicht bei freigabepflichtigen, dafür neue Version) → WorkItem'),
  startWorkItem: e('POST', '/work-items/:id/start', 'Arbeit starten → WorkItem'),
  pauseWorkItem: e('POST', '/work-items/:id/pause', 'Arbeit pausieren → WorkItem'),
  finishWorkItem: e('POST', '/work-items/:id/finish', 'Arbeit abschließen → WorkItem'),
  notDoneWorkItem: e('POST', '/work-items/:id/not-done', 'Als nicht durchgeführt markieren → WorkItem'),
  addPart: e('POST', '/work-items/:id/parts', 'Verbautes Teil erfassen'),
  listFindings: e('GET', '/work-orders/:id/findings', 'Feststellungen → Finding[]'),
  createFinding: e('POST', '/work-orders/:id/findings', 'Feststellung erfassen → Finding'),
  reportFinding: e('POST', '/findings/:id/report', 'An Service melden → Finding'),
  dismissFinding: e('POST', '/findings/:id/dismiss', 'Feststellung verwerfen → Finding'),
  listPhotos: e('GET', '/work-orders/:id/photos', 'Fotos → Photo[]'),
  attachPhoto: e('POST', '/work-orders/:id/photos', 'Foto zuordnen → Photo'),
  setPhotoVisibility: e('PUT', '/photos/:id/visibility', 'Sichtbarkeit ändern → Photo'),
  photoContent: e('GET', '/photos/:id/content', 'Foto (rechtegeprüft)'),
  timeline: e('GET', '/work-orders/:id/timeline', 'Verlauf → TimelineEntry[]'),

  // Freigaben
  listApprovals: e('GET', '/work-orders/:id/approvals', 'Freigabeanfragen → ApprovalRequest[]'),
  createApproval: e('POST', '/work-orders/:id/approvals', 'Entwurf anlegen → ApprovalRequest'),
  getApproval: e('GET', '/approvals/:id', 'Anfrage mit Versionen → ApprovalRequest'),
  reviseApproval: e('PUT', '/approvals/:id', 'Entwurf ändern oder neue Version erzeugen → ApprovalRequest'),
  sendApproval: e('POST', '/approvals/:id/send', 'An Kunden senden → ApprovalRequest'),
  withdrawApproval: e('POST', '/approvals/:id/withdraw', 'Zurückziehen → ApprovalRequest'),
  decideApproval: e('POST', '/approvals/:id/decision', 'Kundenentscheidung zur Version (Hash) → ApprovalRequest'),

  // Dateien, Dokumente
  uploadFile: e('POST', '/files', 'Datei hochladen (multipart) → FileRef'),
  listDocuments: e('GET', '/documents', 'Dokumente (?workOrderId, ?vehicleId, ?customerId) → DocumentDto[]'),
  createDocument: e('POST', '/documents', 'Dokument anlegen (intern) → DocumentDto'),
  addDocumentVersion: e('POST', '/documents/:id/versions', 'Neue Version → DocumentDto'),
  publishDocument: e('POST', '/documents/:id/publish', 'Für Kunden veröffentlichen → DocumentDto'),
  unpublishDocument: e('POST', '/documents/:id/unpublish', 'Veröffentlichung zurückziehen → DocumentDto'),
  downloadDocument: e('GET', '/documents/:id/download', 'Aktuelle Version herunterladen (rechtegeprüft)'),

  // Chat
  listConversations: e('GET', '/conversations', 'Gespräche → Conversation[]'),
  listMessages: e('GET', '/work-orders/:id/messages', 'Nachrichten (?after) → Message[]'),
  sendMessage: e('POST', '/work-orders/:id/messages', 'Nachricht senden (idempotent über clientMessageId) → Message'),
  markRead: e('POST', '/work-orders/:id/messages/read', 'Als gelesen markieren'),
  listInternalNotes: e('GET', '/work-orders/:id/internal-notes', 'Interne Notizen → InternalNote[] (nur Mitarbeiter)'),
  addInternalNote: e('POST', '/work-orders/:id/internal-notes', 'Interne Notiz → InternalNote'),
  realtime: e('GET', '/realtime', 'WebSocket: Ereignisse zu berechtigten Aufträgen (Token im ersten Frame)'),

  // Rechnungen und Zahlungen
  listInvoices: e('GET', '/invoices', 'Rechnungen (?paymentStatus, ?overdue, ?customerId) → Invoice[]'),
  createInvoice: e('POST', '/invoices', 'Rechnung (Entwurf) mit PDF/Betrag → Invoice'),
  getInvoice: e('GET', '/invoices/:id', 'Rechnung → Invoice'),
  issueInvoice: e('POST', '/invoices/:id/issue', 'Rechnung stellen (Kunde wird benachrichtigt) → Invoice'),
  cancelInvoice: e('POST', '/invoices/:id/cancel', 'Rechnung stornieren → Invoice'),
  startCheckout: e('POST', '/invoices/:id/checkout', '"Jetzt bezahlen": gehosteten Checkout anlegen → StartCheckoutResponse (Status unverändert)'),
  refreshPaymentStatus: e('POST', '/invoices/:id/payment-status/refresh', 'Offene Zahlungsversuche beim Anbieter prüfen → Invoice'),
  recordManualPayment: e('POST', '/invoices/:id/payments/manual', 'Überweisung/Barzahlung zuordnen (Recht nötig) → Invoice'),
  refundPayment: e('POST', '/payments/:id/refunds', 'Erstattung (Recht nötig, idempotent) → Invoice'),
  sumupWebhook: e('POST', '/webhooks/sumup', 'Anbieterereignis (nur Auslöser; Status wird beim Anbieter abgefragt)', 'public'),
  exportInvoicesCsv: e('GET', '/exports/invoices.csv', 'Rechnungsexport CSV'),

  // Benachrichtigungen
  listNotifications: e('GET', '/notifications', 'Benachrichtigungen → NotificationDto[]'),
  readNotification: e('POST', '/notifications/:id/read', 'Als gelesen markieren'),
  registerDevice: e('POST', '/devices', 'Push-Token registrieren'),
  getNotificationPreferences: e('GET', '/notification-preferences', 'Einstellungen'),
  setNotificationPreferences: e('PUT', '/notification-preferences', 'Einstellungen speichern'),

  // Einstellungen (settings.manage)
  getSettings: e('GET', '/settings/workshop', 'Werkstattdaten → WorkshopSettings'),
  updateSettings: e('PUT', '/settings/workshop', 'Werkstattdaten speichern → WorkshopSettings'),
  listMaintenanceTypes: e('GET', '/settings/maintenance-types', 'Wartungsarten → MaintenanceType[]'),
  upsertMaintenanceType: e('PUT', '/settings/maintenance-types/:id', 'Wartungsart speichern → MaintenanceType'),
  upsertResource: e('PUT', '/settings/resources/:id', 'Hebebühne speichern → Resource'),

  // Öffentlich
  resolveQr: e('GET', '/public/qr/:token', 'QR-Code auflösen → QrResolution (mit Sitzung: Rechteprüfung)', 'public'),
  publicShare: e('GET', '/public/shares/:token', 'Freigegebene Historie → PublicVehicleView', 'public'),
  health: e('GET', '/health', 'Betriebsbereitschaft', 'public'),

  // Audit
  listAudit: e('GET', '/audit', 'Protokoll (?entityType, ?entityId, ?actorId) → AuditEntry[]'),
} as const satisfies Record<string, EndpointDef>;

export type EndpointName = keyof typeof endpoints;

/** Ersetzt `:param` im Pfad. */
export function buildPath(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:([A-Za-z]+)/g, (_m, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error(`Pfadparameter fehlt: ${key}`);
    return encodeURIComponent(value);
  });
}
