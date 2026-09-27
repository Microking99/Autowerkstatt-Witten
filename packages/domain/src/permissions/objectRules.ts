/**
 * Objektregeln: Rechte sagen, WAS jemand tun darf; Objektregeln sagen, WORAN.
 * Beide müssen erfüllt sein (docs/rollen-und-rechte.md, Abschnitt 3).
 *
 * Jede Funktion erhält nur die Felder, die sie braucht. Die API lädt diese Felder, ruft die
 * Prüfung auf und liefert bei `allowed: false` für Kunden 404 (`notFound`), sonst 403.
 * Inaktive Konten erhalten nie Zugriff.
 */
import type {
  ApprovalRequestStatus,
  DocumentKind,
  InvoiceStatus,
  Permission,
  Visibility,
  WorkItemAuthorization,
  WorkOrderStatus,
} from '@werkstatt/contracts';
import { ALLOW, deny, type Actor, type Decision } from './actor';

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

/** Grundprüfung: aktives Konto; Kunden brauchen einen verknüpften Kundendatensatz. */
function precheck(actor: Actor): Decision | null {
  if (!actor.accountActive) return deny(actor, 'ACCOUNT_INACTIVE');
  if (actor.role === 'customer' && !actor.customerId) return deny(actor, 'NO_CUSTOMER_LINK');
  return null;
}

function isStaff(actor: Actor): boolean {
  return actor.role !== 'customer';
}

/** Mitarbeiter mit dem Recht. Für Kunden immer `false` (Kunden haben keine Rechte). */
function staffHas(actor: Actor, permission: Permission): boolean {
  return isStaff(actor) && actor.permissions.has(permission);
}

function isOwnCustomer(actor: Actor, customerId: string | null | undefined): boolean {
  return actor.customerId !== null && customerId !== null && customerId !== undefined && actor.customerId === customerId;
}

/**
 * Prüft ein einzelnes Recht (für Aktionen ohne Objektbezug, z. B. Export).
 * Kunden haben nie Rechte.
 */
export function hasPermission(actor: Actor, permission: Permission): Decision {
  const pre = precheck(actor);
  if (pre) return pre;
  if (!isStaff(actor)) return deny(actor, 'ROLE_NOT_ALLOWED');
  return actor.permissions.has(permission) ? ALLOW : deny(actor, 'MISSING_PERMISSION');
}

/** Darf der Actor Preise und Beträge sehen? Mechaniker nie; Kunden bei eigenen Vorgängen ja. */
export function canSeePrices(actor: Pick<Actor, 'role'>): boolean {
  return actor.role !== 'mechanic';
}

// ---------------------------------------------------------------------------
// Kunden und Fahrzeuge
// ---------------------------------------------------------------------------

/** Kundenakte. Kunde: nur eigener Datensatz. Mitarbeiter: `customers.read`. */
export function canViewCustomer(actor: Actor, customer: { id: string }): Decision {
  const pre = precheck(actor);
  if (pre) return pre;
  if (!isStaff(actor)) return isOwnCustomer(actor, customer.id) ? ALLOW : deny(actor, 'NOT_OWN_RECORD');
  return staffHas(actor, 'customers.read') ? ALLOW : deny(actor, 'MISSING_PERMISSION');
}

/** Minimale Fahrzeugdaten für Objektregeln. */
export interface VehicleAccessInput {
  /** Kunde des aktuellen Halterzeitraums (`vehicle_ownerships.ended_at IS NULL`), sonst `null`. */
  currentOwnerCustomerId: string | null;
  /**
   * Der Actor ist einem Auftrag zu diesem Fahrzeug (oder einer Position darin) zugewiesen.
   * Wird von der API ermittelt; nur für Mitarbeiter relevant.
   */
  actorAssignedViaWorkOrder?: boolean;
}

/**
 * Fahrzeugakte. Kunde: nur als aktueller Halter (nach Halterwechsel kein Zugriff mehr).
 * Mitarbeiter: `vehicles.read` oder Zuweisung über einen Auftrag (Mechaniker).
 */
export function canViewVehicle(actor: Actor, vehicle: VehicleAccessInput): Decision {
  const pre = precheck(actor);
  if (pre) return pre;
  if (!isStaff(actor)) return isOwnCustomer(actor, vehicle.currentOwnerCustomerId) ? ALLOW : deny(actor, 'NOT_CURRENT_OWNER');
  if (staffHas(actor, 'vehicles.read')) return ALLOW;
  return vehicle.actorAssignedViaWorkOrder === true ? ALLOW : deny(actor, 'MISSING_PERMISSION');
}

/**
 * Servicehistorie eines Fahrzeugs. Kunde: aktueller Halter (die technische Historie gehört
 * zum Fahrzeug; Auftragsbezüge fremder Aufträge blendet {@link serviceEntryForActor} aus).
 * Mitarbeiter: `serviceHistory.read` oder Zuweisung über einen Auftrag (Mechaniker).
 */
export function canViewServiceHistory(actor: Actor, vehicle: VehicleAccessInput): Decision {
  const pre = precheck(actor);
  if (pre) return pre;
  if (!isStaff(actor)) return isOwnCustomer(actor, vehicle.currentOwnerCustomerId) ? ALLOW : deny(actor, 'NOT_CURRENT_OWNER');
  if (staffHas(actor, 'serviceHistory.read')) return ALLOW;
  return vehicle.actorAssignedViaWorkOrder === true ? ALLOW : deny(actor, 'MISSING_PERMISSION');
}

/**
 * Fahrzeugfreigaben für Dritte anlegen/widerrufen und die öffentliche QR-Kurzansicht
 * ein-/ausschalten: nur der aktuelle Halter selbst. Mitarbeiter nie.
 */
export function canManageVehicleShares(actor: Actor, vehicle: Pick<VehicleAccessInput, 'currentOwnerCustomerId'>): Decision {
  const pre = precheck(actor);
  if (pre) return pre;
  if (isStaff(actor)) return deny(actor, 'ROLE_NOT_ALLOWED');
  return isOwnCustomer(actor, vehicle.currentOwnerCustomerId) ? ALLOW : deny(actor, 'NOT_CURRENT_OWNER');
}

// ---------------------------------------------------------------------------
// Aufträge, Chat, interne Notizen
// ---------------------------------------------------------------------------

/** Minimale Auftragsdaten für Objektregeln. */
export interface WorkOrderAccessInput {
  /** Auftraggeber (`work_orders.customer_id`, bleibt nach Halterwechsel unverändert). */
  customerId: string;
  /** Dem Auftrag zugewiesene Mitarbeiter. */
  assigneeUserIds: readonly string[];
  /** Den Positionen zugewiesene Mitarbeiter. */
  itemAssigneeUserIds?: readonly string[];
}

/** true, wenn die Person dem Auftrag oder einer seiner Positionen zugewiesen ist. */
export function isAssignedToWorkOrder(userId: string, workOrder: WorkOrderAccessInput): boolean {
  return workOrder.assigneeUserIds.includes(userId) || (workOrder.itemAssigneeUserIds ?? []).includes(userId);
}

/**
 * Auftrag. Kunde: nur Aufträge, deren Auftraggeber er ist (Aufträge gehören dem Kunden,
 * nicht dem Fahrzeug). Mitarbeiter: `workOrders.read` oder Zuweisung am Auftrag bzw. an
 * einer Position.
 */
export function canViewWorkOrder(actor: Actor, workOrder: WorkOrderAccessInput): Decision {
  const pre = precheck(actor);
  if (pre) return pre;
  if (!isStaff(actor)) return isOwnCustomer(actor, workOrder.customerId) ? ALLOW : deny(actor, 'NOT_OWN_RECORD');
  if (staffHas(actor, 'workOrders.read')) return ALLOW;
  return isAssignedToWorkOrder(actor.userId, workOrder) ? ALLOW : deny(actor, 'NOT_ASSIGNED');
}

/**
 * Chat eines Auftrags lesen. Kunde: eigener Auftrag. Mitarbeiter: `messages.customerChat`
 * und Sicht auf den Auftrag.
 */
export function canViewMessages(actor: Actor, workOrder: WorkOrderAccessInput): Decision {
  const pre = precheck(actor);
  if (pre) return pre;
  if (!isStaff(actor)) return isOwnCustomer(actor, workOrder.customerId) ? ALLOW : deny(actor, 'NOT_OWN_RECORD');
  if (!staffHas(actor, 'messages.customerChat')) return deny(actor, 'MISSING_PERMISSION');
  return canViewWorkOrder(actor, workOrder);
}

/** Nachricht senden: dieselben Regeln wie {@link canViewMessages}. */
export function canSendMessage(actor: Actor, workOrder: WorkOrderAccessInput): Decision {
  return canViewMessages(actor, workOrder);
}

/** Interne Notizen: nie für Kunden; Mitarbeiter mit Sicht auf den Auftrag. */
export function canViewInternalNotes(actor: Actor, workOrder: WorkOrderAccessInput): Decision {
  const pre = precheck(actor);
  if (pre) return pre;
  if (!isStaff(actor)) return deny(actor, 'INTERNAL_ONLY');
  return canViewWorkOrder(actor, workOrder);
}

// ---------------------------------------------------------------------------
// Freigaben
// ---------------------------------------------------------------------------

/**
 * Freigabeanfrage ansehen. Kunde: Anfrage zu eigenem Auftrag, Status nicht `draft`.
 * Admin/Service: Sicht auf den Auftrag. Mechaniker: nie (Anfragen enthalten Preise); er
 * sieht den Freigabestand über die Position (`authorization`).
 */
export function canViewApprovalRequest(actor: Actor, input: { workOrder: WorkOrderAccessInput; status: ApprovalRequestStatus }): Decision {
  const pre = precheck(actor);
  if (pre) return pre;
  if (!isStaff(actor)) {
    if (!isOwnCustomer(actor, input.workOrder.customerId)) return deny(actor, 'NOT_OWN_RECORD');
    return input.status === 'draft' ? deny(actor, 'DRAFT') : ALLOW;
  }
  if (!canSeePrices(actor)) return deny(actor, 'ROLE_NOT_ALLOWED');
  return canViewWorkOrder(actor, input.workOrder);
}

/**
 * Über eine Freigabe entscheiden (freigeben/ablehnen): AUSSCHLIESSLICH der Kunde des
 * Auftrags mit aktivem Konto. Mitarbeiter, Admin und Mechaniker nie, auch nicht "im Namen
 * des Kunden" (R-MECH-3, R-FRG-3). Status/Version/Hash prüft `validateDecision`.
 */
export function canDecideApproval(actor: Actor, input: { workOrderCustomerId: string }): Decision {
  const pre = precheck(actor);
  if (pre) return pre;
  if (isStaff(actor)) return deny(actor, 'NOT_CUSTOMER');
  return isOwnCustomer(actor, input.workOrderCustomerId) ? ALLOW : deny(actor, 'NOT_OWN_RECORD');
}

// ---------------------------------------------------------------------------
// Positionen ausführen
// ---------------------------------------------------------------------------

/** Minimale Positionsdaten für die Ausführungsprüfung. */
export interface WorkItemExecutionAccessInput {
  assignedToUserId: string | null;
  authorization: WorkItemAuthorization;
  /** Arbeitsstatus des Auftrags. */
  workOrderStatus: WorkOrderStatus;
}

/** Auftragsstatus, in denen Positionen ausgeführt werden dürfen. */
export const EXECUTABLE_WORK_ORDER_STATUSES: readonly WorkOrderStatus[] = ['open', 'in_progress'];

/**
 * Position starten/pausieren/abschließen/als nicht durchgeführt markieren.
 * Voraussetzungen: Recht `workItems.execute`; Position dem Actor zugewiesen oder Actor ist
 * Admin/Service; Autorisierung `agreed` oder `approved` (nie `pending_approval`,
 * `rejected`, `withdrawn`); Auftrag im Status `open` oder `in_progress`.
 * Den erlaubten Statuswechsel der Position selbst prüfen `startItem` usw.
 */
export function canExecuteWorkItem(actor: Actor, item: WorkItemExecutionAccessInput): Decision {
  const pre = precheck(actor);
  if (pre) return pre;
  if (!isStaff(actor)) return deny(actor, 'ROLE_NOT_ALLOWED');
  if (!staffHas(actor, 'workItems.execute')) return deny(actor, 'MISSING_PERMISSION');
  const privileged = actor.role === 'admin' || actor.role === 'service';
  if (!privileged && item.assignedToUserId !== actor.userId) return deny(actor, 'NOT_ASSIGNED');
  if (item.authorization !== 'agreed' && item.authorization !== 'approved') return deny(actor, 'ITEM_NOT_AUTHORIZED');
  if (!EXECUTABLE_WORK_ORDER_STATUSES.includes(item.workOrderStatus)) return deny(actor, 'WORK_ORDER_NOT_ACTIVE');
  return ALLOW;
}

// ---------------------------------------------------------------------------
// Dokumente, Rechnungen, Zahlungen
// ---------------------------------------------------------------------------

/** Minimale Dokumentdaten. */
export interface DocumentAccessInput {
  customerId: string | null;
  visibility: Visibility;
  publishedAt: string | null;
  /** Art; Mechaniker sehen nie Angebote/Rechnungen (Preise). */
  kind?: DocumentKind;
}

/**
 * Dokument ansehen/herunterladen.
 * - Kunde: `visibility = customer` UND veröffentlicht UND `customerId` = eigener. Interne nie.
 * - Admin/Service: interne Dokumente nur mit `documents.readInternal`; Kundendokumente mit
 *   einem der Dokumentrechte (`documents.readInternal`, `documents.write`, `documents.publish`).
 * - Mechaniker: nur mit zugewiesenem `documents.readInternal`, nie Angebote oder Rechnungen.
 */
export function canViewDocument(actor: Actor, doc: DocumentAccessInput): Decision {
  const pre = precheck(actor);
  if (pre) return pre;
  if (!isStaff(actor)) {
    if (doc.visibility !== 'customer') return deny(actor, 'INTERNAL_ONLY');
    if (doc.publishedAt === null) return deny(actor, 'NOT_PUBLISHED');
    return isOwnCustomer(actor, doc.customerId) ? ALLOW : deny(actor, 'NOT_OWN_RECORD');
  }
  if (actor.role === 'mechanic') {
    if (!staffHas(actor, 'documents.readInternal')) return deny(actor, 'MISSING_PERMISSION');
    if (doc.kind === 'invoice' || doc.kind === 'offer') return deny(actor, 'ROLE_NOT_ALLOWED');
    return ALLOW;
  }
  if (doc.visibility === 'internal') {
    return staffHas(actor, 'documents.readInternal') ? ALLOW : deny(actor, 'MISSING_PERMISSION');
  }
  const anyDocumentRight =
    staffHas(actor, 'documents.readInternal') || staffHas(actor, 'documents.write') || staffHas(actor, 'documents.publish');
  return anyDocumentRight ? ALLOW : deny(actor, 'MISSING_PERMISSION');
}

/** Minimale Rechnungsdaten. */
export interface InvoiceAccessInput {
  customerId: string;
  status: InvoiceStatus;
}

/**
 * Rechnung (und ihre Zahlungen) ansehen. Kunde: eigene, nicht im Entwurf.
 * Mitarbeiter: `invoices.read` (Mechaniker können es nie erhalten).
 */
export function canViewInvoice(actor: Actor, invoice: InvoiceAccessInput): Decision {
  const pre = precheck(actor);
  if (pre) return pre;
  if (!isStaff(actor)) {
    if (!isOwnCustomer(actor, invoice.customerId)) return deny(actor, 'NOT_OWN_RECORD');
    return invoice.status === 'draft' ? deny(actor, 'DRAFT') : ALLOW;
  }
  return staffHas(actor, 'invoices.read') ? ALLOW : deny(actor, 'MISSING_PERMISSION');
}

/**
 * "Jetzt bezahlen" starten: Kunde bei eigener, gestellter Rechnung. Mitarbeiter lösen keine
 * Online-Zahlung für Kunden aus.
 */
export function canStartCheckout(actor: Actor, invoice: InvoiceAccessInput): Decision {
  const pre = precheck(actor);
  if (pre) return pre;
  if (isStaff(actor)) return deny(actor, 'ROLE_NOT_ALLOWED');
  return canViewInvoice(actor, invoice);
}

/** Erstattung auslösen: Recht `payments.refund`. */
export function canRefundPayment(actor: Actor): Decision {
  return hasPermission(actor, 'payments.refund');
}

/** Überweisung/Barzahlung manuell zuordnen: Recht `payments.recordManual`. */
export function canRecordManualPayment(actor: Actor): Decision {
  return hasPermission(actor, 'payments.recordManual');
}

/** Serviceeintrag korrigieren (neue Revision): Recht `serviceHistory.correct`. */
export function canCorrectServiceEntry(actor: Actor): Decision {
  return hasPermission(actor, 'serviceHistory.correct');
}

// ---------------------------------------------------------------------------
// Termine
// ---------------------------------------------------------------------------

/** Minimale Termindaten. */
export interface AppointmentAccessInput {
  customerId: string;
  assigneeUserIds?: readonly string[];
}

/**
 * Termin ansehen. Kunde: `appointments.customer_id` = eigener. Mitarbeiter:
 * `appointments.read` oder dem Termin zugewiesen.
 */
export function canViewAppointment(actor: Actor, appointment: AppointmentAccessInput): Decision {
  const pre = precheck(actor);
  if (pre) return pre;
  if (!isStaff(actor)) return isOwnCustomer(actor, appointment.customerId) ? ALLOW : deny(actor, 'NOT_OWN_RECORD');
  if (staffHas(actor, 'appointments.read')) return ALLOW;
  return (appointment.assigneeUserIds ?? []).includes(actor.userId) ? ALLOW : deny(actor, 'NOT_ASSIGNED');
}
