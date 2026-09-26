/**
 * Deutsche Bezeichnungen für Aufzählungen (Oberfläche, Exporte, Benachrichtigungen).
 * Status werden in der Oberfläche immer als Text + Symbol + Farbe dargestellt; der Ton
 * (tone) legt die Farbe fest (docs/designsystem.md).
 */
import type {
  AppointmentKind,
  AppointmentStatus,
  ApprovalOverviewStatus,
  ApprovalRequestStatus,
  CheckoutStatus,
  DocumentKind,
  FindingSeverity,
  PaymentMethod,
  PaymentStatus,
  Permission,
  Role,
  WorkItemAuthorization,
  WorkItemExecutionStatus,
  WorkOrderStatus,
} from './enums';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface StatusLabel {
  label: string;
  tone: Tone;
  /** Phosphor-Symbolname */
  icon: string;
}

export const roleLabels: Record<Role, string> = {
  admin: 'Inhaber / Admin',
  service: 'Sekretariat / Service',
  mechanic: 'Mechaniker',
  customer: 'Kunde',
};

export const workOrderStatusLabels: Record<WorkOrderStatus, StatusLabel> = {
  draft: { label: 'Entwurf', tone: 'neutral', icon: 'PencilSimple' },
  open: { label: 'Offen', tone: 'neutral', icon: 'Circle' },
  in_progress: { label: 'In Arbeit', tone: 'info', icon: 'Wrench' },
  work_completed: { label: 'Arbeiten erledigt', tone: 'info', icon: 'ListChecks' },
  completed: { label: 'Abgeschlossen', tone: 'success', icon: 'SealCheck' },
  picked_up: { label: 'Abgeholt', tone: 'neutral', icon: 'Car' },
  cancelled: { label: 'Storniert', tone: 'neutral', icon: 'XCircle' },
};

export const approvalOverviewLabels: Record<ApprovalOverviewStatus, StatusLabel> = {
  none: { label: 'Keine Freigabe nötig', tone: 'neutral', icon: 'Minus' },
  pending: { label: 'Wartet auf Kunde', tone: 'warning', icon: 'HourglassMedium' },
  decided: { label: 'Entschieden', tone: 'success', icon: 'CheckCircle' },
};

export const approvalRequestStatusLabels: Record<ApprovalRequestStatus, StatusLabel> = {
  draft: { label: 'Entwurf', tone: 'neutral', icon: 'PencilSimple' },
  pending_customer: { label: 'Wartet auf Kunde', tone: 'warning', icon: 'HourglassMedium' },
  approved: { label: 'Freigegeben', tone: 'success', icon: 'CheckCircle' },
  rejected: { label: 'Abgelehnt', tone: 'danger', icon: 'XCircle' },
  withdrawn: { label: 'Zurückgezogen', tone: 'neutral', icon: 'ArrowUDownLeft' },
};

export const paymentStatusLabels: Record<PaymentStatus, StatusLabel> = {
  no_invoice: { label: 'Keine Rechnung', tone: 'neutral', icon: 'Minus' },
  open: { label: 'Offen', tone: 'warning', icon: 'Receipt' },
  partially_paid: { label: 'Teilweise bezahlt', tone: 'warning', icon: 'CircleHalf' },
  paid: { label: 'Bezahlt', tone: 'success', icon: 'CheckCircle' },
  partially_refunded: { label: 'Teilweise erstattet', tone: 'neutral', icon: 'ArrowCounterClockwise' },
  refunded: { label: 'Erstattet', tone: 'neutral', icon: 'ArrowCounterClockwise' },
  cancelled: { label: 'Storniert', tone: 'neutral', icon: 'XCircle' },
};

export const overdueLabel: StatusLabel = { label: 'Überfällig', tone: 'danger', icon: 'WarningCircle' };

export const workItemAuthorizationLabels: Record<WorkItemAuthorization, StatusLabel> = {
  agreed: { label: 'Vereinbart', tone: 'neutral', icon: 'Handshake' },
  pending_approval: { label: 'Wartet auf Freigabe', tone: 'warning', icon: 'HourglassMedium' },
  approved: { label: 'Freigegeben', tone: 'success', icon: 'CheckCircle' },
  rejected: { label: 'Abgelehnt', tone: 'danger', icon: 'XCircle' },
  withdrawn: { label: 'Zurückgezogen', tone: 'neutral', icon: 'ArrowUDownLeft' },
};

export const workItemExecutionLabels: Record<WorkItemExecutionStatus, StatusLabel> = {
  planned: { label: 'Geplant', tone: 'neutral', icon: 'Circle' },
  in_progress: { label: 'In Arbeit', tone: 'info', icon: 'Wrench' },
  paused: { label: 'Pausiert', tone: 'warning', icon: 'Pause' },
  done: { label: 'Erledigt', tone: 'success', icon: 'CheckCircle' },
  not_done: { label: 'Nicht durchgeführt', tone: 'neutral', icon: 'Prohibit' },
};

export const appointmentKindLabels: Record<AppointmentKind, string> = {
  inspection_hu: 'HU / AU',
  service: 'Service / Inspektion',
  repair: 'Reparatur',
  tire_change: 'Reifenwechsel',
  other: 'Sonstiges',
};

export const appointmentStatusLabels: Record<AppointmentStatus, StatusLabel> = {
  requested: { label: 'Angefragt, noch nicht bestätigt', tone: 'warning', icon: 'HourglassMedium' },
  proposed: { label: 'Alternative vorgeschlagen', tone: 'info', icon: 'CalendarPlus' },
  confirmed: { label: 'Bestätigt', tone: 'success', icon: 'CalendarCheck' },
  cancelled: { label: 'Abgesagt', tone: 'neutral', icon: 'CalendarX' },
  completed: { label: 'Erledigt', tone: 'neutral', icon: 'CheckCircle' },
  no_show: { label: 'Nicht erschienen', tone: 'danger', icon: 'UserMinus' },
};

export const findingSeverityLabels: Record<FindingSeverity, StatusLabel> = {
  info: { label: 'Hinweis', tone: 'neutral', icon: 'Info' },
  recommended: { label: 'Empfohlen', tone: 'info', icon: 'ThumbsUp' },
  urgent: { label: 'Dringend', tone: 'warning', icon: 'Warning' },
  safety: { label: 'Sicherheitsrelevant', tone: 'danger', icon: 'ShieldWarning' },
};

export const documentKindLabels: Record<DocumentKind, string> = {
  offer: 'Angebot',
  invoice: 'Rechnung',
  intake_protocol: 'Annahmeprotokoll',
  report: 'Bericht / Prüfprotokoll',
  other: 'Sonstiges',
};

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  sumup_online: 'Online (SumUp)',
  bank_transfer: 'Überweisung',
  cash: 'Barzahlung',
  card_terminal: 'Kartenterminal vor Ort',
};

export const checkoutStatusLabels: Record<CheckoutStatus, StatusLabel> = {
  created: { label: 'Angelegt', tone: 'neutral', icon: 'Circle' },
  pending: { label: 'Wird geprüft', tone: 'warning', icon: 'HourglassMedium' },
  paid: { label: 'Bezahlt (bestätigt)', tone: 'success', icon: 'CheckCircle' },
  failed: { label: 'Fehlgeschlagen', tone: 'danger', icon: 'XCircle' },
  expired: { label: 'Abgelaufen', tone: 'neutral', icon: 'Clock' },
  deactivated: { label: 'Deaktiviert', tone: 'neutral', icon: 'Prohibit' },
};

export const permissionLabels: Record<Permission, string> = {
  'dashboard.view': 'Übersicht sehen',
  'customers.read': 'Alle Kundenakten lesen',
  'customers.write': 'Kunden anlegen und ändern',
  'customerAccounts.manage': 'Kunden zur App einladen, Zugang sperren',
  'vehicles.read': 'Alle Fahrzeugakten lesen',
  'vehicles.write': 'Fahrzeuge anlegen und ändern',
  'vehicles.transferOwnership': 'Halterwechsel buchen',
  'appointments.read': 'Alle Termine sehen',
  'appointments.write': 'Termine planen und bestätigen',
  'workOrders.read': 'Alle Aufträge lesen',
  'workOrders.write': 'Aufträge anlegen und planen',
  'workOrders.completeReview': 'Fachlichen Abschluss bestätigen',
  'workItems.execute': 'Arbeitspositionen ausführen',
  'intake.write': 'Fahrzeugannahme erfassen',
  'findings.write': 'Feststellungen und Fotos erfassen',
  'approvals.request': 'Freigabeanfragen an Kunden senden',
  'documents.readInternal': 'Interne Dokumente lesen',
  'documents.write': 'Dokumente hochladen',
  'documents.publish': 'Dokumente für Kunden veröffentlichen',
  'messages.customerChat': 'Mit Kunden chatten',
  'invoices.read': 'Rechnungen und offene Posten sehen',
  'invoices.write': 'Rechnungen anlegen, stellen, stornieren',
  'payments.recordManual': 'Zahlungen manuell zuordnen',
  'payments.refund': 'Erstattungen auslösen',
  'serviceHistory.read': 'Servicehistorie aller Fahrzeuge lesen',
  'serviceHistory.correct': 'Serviceeinträge korrigieren',
  'reports.export': 'Exporte erstellen',
  'users.manage': 'Mitarbeiter und Rechte verwalten',
  'settings.manage': 'Einstellungen verwalten',
  'audit.read': 'Änderungsprotokoll einsehen',
};
