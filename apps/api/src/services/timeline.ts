/**
 * Verlauf eines Auftrags aus dem Audit-Protokoll mit deutschen Kurztexten.
 * Kurztexte enthalten keine Beträge oder personenbezogenen Details.
 */
import { workOrderStatusLabels, type TimelineEntry, type WorkOrderStatus } from '@werkstatt/contracts';

const ACTION_TEXTS: Record<string, string> = {
  'work_order.created': 'Auftrag angelegt',
  'work_order.updated': 'Auftrag geändert',
  'work_order.completion_reviewed': 'Fachlicher Abschluss bestätigt',
  'work_order.ready_for_pickup': 'Fahrzeug als abholbereit gemeldet',
  'work_order.picked_up': 'Fahrzeug abgeholt',
  'work_order.assignees_changed': 'Zuständige Mitarbeiter geändert',
  'intake.saved': 'Fahrzeugannahme gespeichert',
  'intake.confirmed': 'Fahrzeugannahme bestätigt',
  'work_item.added': 'Position hinzugefügt',
  'work_item.updated': 'Position geändert',
  'work_item.started': 'Arbeit an einer Position gestartet',
  'work_item.paused': 'Arbeit an einer Position pausiert',
  'work_item.finished': 'Position abgeschlossen',
  'work_item.not_done': 'Position als nicht durchgeführt markiert',
  'work_item.part_added': 'Verbautes Teil erfasst',
  'finding.created': 'Feststellung erfasst',
  'finding.reported': 'Zusatzarbeit an den Service gemeldet',
  'finding.dismissed': 'Feststellung verworfen',
  'photo.attached': 'Foto hinzugefügt',
  'photo.visibility_changed': 'Sichtbarkeit eines Fotos geändert',
  'approval.created': 'Freigabeanfrage als Entwurf angelegt',
  'approval.revised': 'Freigabeanfrage geändert',
  'approval.sent': 'Freigabeanfrage an den Kunden gesendet',
  'approval.version_sent': 'Neue Fassung der Freigabeanfrage gesendet',
  'approval.withdrawn': 'Freigabeanfrage zurückgezogen',
  'approval.decided': 'Kunde hat entschieden',
  'document.created': 'Dokument hinzugefügt',
  'document.version_added': 'Neue Dokumentversion',
  'document.published': 'Dokument für den Kunden veröffentlicht',
  'document.unpublished': 'Veröffentlichung zurückgezogen',
  'invoice.created': 'Rechnung angelegt (Entwurf)',
  'invoice.issued': 'Rechnung gestellt',
  'invoice.cancelled': 'Rechnung storniert',
  'payment.recorded': 'Zahlung bestätigt',
  'payment.manual_recorded': 'Zahlung manuell zugeordnet',
  'payment.mismatch': 'Zahlungsmeldung mit Abweichung (nicht gebucht)',
  'refund.requested': 'Erstattung angefordert',
  'refund.succeeded': 'Erstattung durchgeführt',
  'refund.failed': 'Erstattung fehlgeschlagen',
  'service_entry.created': 'Serviceeintrag erstellt',
  'service_entry.corrected': 'Serviceeintrag korrigiert',
  'appointment.created': 'Termin angelegt',
};

export function timelineSummary(action: string, data: Record<string, unknown>): string {
  if (action === 'work_order.status_changed') {
    const to = data.to as WorkOrderStatus | undefined;
    return to && workOrderStatusLabels[to] ? `Arbeitsstatus: ${workOrderStatusLabels[to].label}` : 'Arbeitsstatus geändert';
  }
  if (action === 'approval.decided') {
    return data.decision === 'approved' ? 'Kunde hat freigegeben' : data.decision === 'rejected' ? 'Kunde hat abgelehnt' : 'Kunde hat entschieden';
  }
  return ACTION_TEXTS[action] ?? action;
}

export function toTimelineEntry(row: { id: number; occurredAt: Date; action: string; data: Record<string, unknown> }, actorDisplayName: string | null): TimelineEntry {
  return {
    id: String(row.id),
    occurredAt: row.occurredAt.toISOString(),
    actorDisplayName,
    action: row.action,
    summary: timelineSummary(row.action, row.data),
  };
}
