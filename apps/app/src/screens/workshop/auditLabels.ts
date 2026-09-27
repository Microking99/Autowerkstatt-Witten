/**
 * Deutsche Beschriftungen für das Änderungsprotokoll. Unbekannte Aktionen erscheinen mit
 * ihrem technischen Namen, damit nichts verloren geht.
 */
import { formatMoney } from '../../lib/format';

const actionLabels: Record<string, string> = {
  'appointment.cancelled': 'Termin abgesagt',
  'appointment.confirmed': 'Termin bestätigt',
  'appointment.created': 'Termin angelegt',
  'appointment.proposal_accepted': 'Terminvorschlag angenommen',
  'appointment.proposal_declined': 'Terminvorschlag abgelehnt',
  'appointment.proposed': 'Alternativer Termin vorgeschlagen',
  'appointment.requested': 'Termin angefragt',
  'approval.created': 'Freigabeanfrage angelegt',
  'approval.decided': 'Freigabe entschieden',
  'approval.revised': 'Freigabeanfrage geändert (neue Version)',
  'approval.sent': 'Freigabeanfrage gesendet',
  'approval.version_sent': 'Neue Version gesendet',
  'approval.withdrawn': 'Freigabeanfrage zurückgezogen',
  'auth.account_locked': 'Konto vorübergehend gesperrt',
  'auth.login': 'Angemeldet',
  'auth.login_failed': 'Anmeldung fehlgeschlagen',
  'auth.login_succeeded': 'Angemeldet',
  'auth.logout': 'Abgemeldet',
  'auth.password_changed': 'Passwort geändert',
  'auth.password_reset': 'Passwort zurückgesetzt',
  'auth.password_reset_requested': 'Passwort-Zurücksetzung angefordert',
  'checkout.created': 'Zahlungsvorgang gestartet',
  'checkout.deactivated': 'Zahlungsvorgang beendet',
  'customer.archived': 'Kunde archiviert',
  'customer.created': 'Kunde angelegt',
  'customer.updated': 'Kundendaten geändert',
  'customer_account.disabled': 'Kundenzugang gesperrt',
  'customer_account.enabled': 'Kundenzugang freigeschaltet',
  'customer_account.invited': 'Kunde zur App eingeladen',
  'document.created': 'Dokument hochgeladen',
  'document.version_added': 'Neue Dokumentversion',
  'export.customer_data': 'Datenexport erstellt',
  'export.invoices_csv': 'Rechnungsliste exportiert',
  'finding.created': 'Feststellung erfasst',
  'intake.confirmed': 'Annahme bestätigt',
  'intake.saved': 'Annahme gespeichert',
  'invoice.cancelled': 'Rechnung storniert',
  'invoice.created': 'Rechnungsentwurf angelegt',
  'invoice.issued': 'Rechnung gestellt',
  'maintenance_type.saved': 'Wartungsart gespeichert',
  'payment.manual_recorded': 'Zahlung manuell erfasst',
  'payment.mismatch': 'Zahlung weicht ab (zur Prüfung)',
  'payment.recorded': 'Zahlung bestätigt',
  'photo.attached': 'Foto hinzugefügt',
  'photo.visibility_changed': 'Sichtbarkeit eines Fotos geändert',
  'refund.requested': 'Erstattung ausgelöst',
  'resource.saved': 'Hebebühne gespeichert',
  'service_entry.corrected': 'Serviceeintrag korrigiert (neue Revision)',
  'service_entry.created': 'Serviceeintrag entstanden',
  'settings.updated': 'Einstellungen geändert',
  'user.activated': 'Mitarbeiterkonto aktiviert',
  'user.disabled': 'Mitarbeiter deaktiviert',
  'user.enabled': 'Mitarbeiter wieder aktiviert',
  'user.invited': 'Mitarbeiter eingeladen',
  'user.permissions_changed': 'Rechte geändert',
  'user.role_changed': 'Rolle geändert',
  'user.updated': 'Mitarbeiterdaten geändert',
  'vehicle.created': 'Fahrzeug angelegt',
  'vehicle.odometer_recorded': 'Kilometerstand erfasst',
  'vehicle.ownership_transferred': 'Halterwechsel gebucht',
  'vehicle.qr_public_view_changed': 'Öffentliche QR-Ansicht geändert',
  'vehicle.qr_rotated': 'QR-Code erneuert',
  'vehicle.updated': 'Fahrzeugdaten geändert',
  'vehicle_share.accessed': 'Freigabelink aufgerufen',
  'vehicle_share.created': 'Freigabelink erstellt',
  'vehicle_share.revoked': 'Freigabelink widerrufen',
  'work_item.added': 'Position hinzugefügt',
  'work_item.part_added': 'Teil erfasst',
  'work_item.updated': 'Position geändert',
  'work_order.assignees_changed': 'Zuweisung geändert',
  'work_order.completion_reviewed': 'Fachlicher Abschluss bestätigt',
  'work_order.created': 'Auftrag angelegt',
  'work_order.picked_up': 'Fahrzeug abgeholt',
  'work_order.ready_for_pickup': 'Abholbereit gemeldet',
  'work_order.status_changed': 'Auftragsstatus geändert',
  'work_order.updated': 'Auftrag geändert',
};

const entityLabels: Record<string, string> = {
  appointment: 'Termin',
  approval_request: 'Freigabeanfrage',
  approval_version: 'Freigabeversion',
  auth: 'Anmeldung',
  checkout: 'Zahlungsvorgang',
  customer: 'Kunde',
  customer_account: 'Kundenzugang',
  document: 'Dokument',
  export: 'Export',
  finding: 'Feststellung',
  intake: 'Annahme',
  invoice: 'Rechnung',
  maintenance_type: 'Wartungsart',
  payment: 'Zahlung',
  photo: 'Foto',
  refund: 'Erstattung',
  resource: 'Hebebühne',
  service_entry: 'Serviceeintrag',
  settings: 'Einstellungen',
  user: 'Benutzer',
  vehicle: 'Fahrzeug',
  vehicle_share: 'Freigabelink',
  work_item: 'Position',
  work_order: 'Auftrag',
};

const keyLabels: Record<string, string> = {
  decision: 'Entscheidung',
  contentHash: 'Inhalts-Hash',
  channel: 'Kanal',
  reason: 'Grund',
  status: 'Status',
  from: 'von',
  to: 'nach',
  role: 'Rolle',
  orderNumber: 'Auftrag',
  invoiceNumber: 'Rechnung',
  amountCents: 'Betrag',
  method: 'Art',
  version: 'Version',
  versionNo: 'Version',
  revisionNo: 'Revision',
  odometerKm: 'km-Stand',
  licensePlate: 'Kennzeichen',
};

const valueLabels: Record<string, string> = {
  approved: 'freigegeben',
  rejected: 'abgelehnt',
  ios: 'iPhone-App',
  android: 'Android-App',
  web: 'Browser',
  windows: 'Windows',
  in_person: 'vor Ort',
  app: 'App',
  cash: 'bar',
  bank_transfer: 'Überweisung',
  card_terminal: 'Kartenterminal',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function auditActionLabel(action: string): string {
  return actionLabels[action] ?? action;
}

export function auditEntityLabel(entityType: string): string {
  return entityLabels[entityType] ?? entityType;
}

function formatValue(key: string, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    if (UUID.test(value)) return null;
    if (key === 'contentHash') return `${value.slice(0, 12)}…`;
    return valueLabels[value] ?? value;
  }
  if (typeof value === 'number') {
    if (key.endsWith('Cents')) return formatMoney(value);
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'ja' : 'nein';
  if (Array.isArray(value)) return value.length === 0 ? null : `${value.length} Einträge`;
  return null;
}

/** Kurze, lesbare Zusammenfassung der Protokolldaten; interne Kennungen bleiben weg. */
export function summarizeAuditData(data: Record<string, unknown>): string {
  return Object.keys(data)
    .filter((k) => !/id$/i.test(k) && !/ids$/i.test(k))
    .map((k) => {
      const v = formatValue(k, data[k]);
      return v === null ? null : `${keyLabels[k] ?? k}: ${v}`;
    })
    .filter((x): x is string => x !== null)
    .slice(0, 4)
    .join(', ');
}
