import { describe, expect, it } from 'vitest';
import type { ServiceEntry } from '@werkstatt/contracts';
import { IDS, admin, customerA, customerActor, customerB, grant, mechanic, revoke, service, staffActor, tid } from '../testing/fixtures';
import { currentOwnerCustomerId, planOwnershipTransfer, type OwnershipPeriod } from '../vehicles/vehicles';
import type { Actor, Decision } from './actor';
import {
  canCorrectServiceEntry,
  canDecideApproval,
  canExecuteWorkItem,
  canManageVehicleShares,
  canRecordManualPayment,
  canRefundPayment,
  canSeePrices,
  canSendMessage,
  canStartCheckout,
  canViewApprovalRequest,
  canViewAppointment,
  canViewCustomer,
  canViewDocument,
  canViewInternalNotes,
  canViewInvoice,
  canViewMessages,
  canViewServiceHistory,
  canViewVehicle,
  canViewWorkOrder,
  hasPermission,
  type WorkOrderAccessInput,
} from './objectRules';
import { serviceEntryForActor } from './redaction';

const allowed = (d: Decision): boolean => d.allowed;
const reasonOf = (d: Decision): string | null => (d.allowed ? null : d.reason);
const notFoundOf = (d: Decision): boolean | null => (d.allowed ? null : d.notFound);

const customerC = (): Actor => customerActor(tid(7), IDS.customerC);

const workOrderOfA: WorkOrderAccessInput = { customerId: IDS.customerA, assigneeUserIds: [IDS.mechanicUser], itemAssigneeUserIds: [] };
const workOrderOfB: WorkOrderAccessInput = { customerId: IDS.customerB, assigneeUserIds: [IDS.otherMechanicUser], itemAssigneeUserIds: [] };

describe('Auftragsentwürfe', () => {
  it('Kunden sehen Aufträge im Entwurf nicht (404), ab "offen" schon; Mitarbeiter immer', () => {
    const draft: WorkOrderAccessInput = { ...workOrderOfA, status: 'draft' };
    const d = canViewWorkOrder(customerA(), draft);
    expect(reasonOf(d)).toBe('NOT_OWN_RECORD');
    expect(notFoundOf(d)).toBe(true);
    expect(allowed(canViewWorkOrder(customerA(), { ...workOrderOfA, status: 'open' }))).toBe(true);
    expect(allowed(canViewWorkOrder(service(), draft))).toBe(true);
  });
});

describe('Abnahme: Kunde mit mehreren Fahrzeugen', () => {
  const vehicles = [
    { id: IDS.vehicle1, currentOwnerCustomerId: IDS.customerA },
    { id: IDS.vehicle2, currentOwnerCustomerId: IDS.customerA },
    { id: IDS.vehicle3, currentOwnerCustomerId: IDS.customerB },
  ];

  it('sieht alle eigenen Fahrzeuge und keine fremden', () => {
    const visible = vehicles.filter((v) => canViewVehicle(customerA(), v).allowed).map((v) => v.id);
    expect(visible).toEqual([IDS.vehicle1, IDS.vehicle2]);
  });

  it('bekommt für fremde Fahrzeuge "nicht gefunden" statt "verboten"', () => {
    const d = canViewVehicle(customerA(), vehicles[2]!);
    expect(reasonOf(d)).toBe('NOT_CURRENT_OWNER');
    expect(notFoundOf(d)).toBe(true);
  });

  it('sieht eigene Aufträge, keine fremden', () => {
    expect(allowed(canViewWorkOrder(customerA(), workOrderOfA))).toBe(true);
    expect(notFoundOf(canViewWorkOrder(customerA(), workOrderOfB))).toBe(true);
  });
});

describe('Abnahme: Halterwechsel trennt private Daten', () => {
  // Fahrzeug 1 gehört Kunde A; A hatte einen Auftrag mit Rechnung, Dokument, Chat, Freigabe.
  const ownership: OwnershipPeriod = { id: tid(501), customerId: IDS.customerA, startedAt: '2023-05-01T08:00:00Z', endedAt: null };
  const plan = planOwnershipTransfer({ current: ownership, newCustomerId: IDS.customerC, effectiveAt: '2026-09-01T10:00:00Z', now: new Date('2026-09-26T10:00:00Z') });
  if (!plan.ok) throw new Error('Halterwechsel sollte möglich sein');
  const periods = [
    { customerId: IDS.customerA, endedAt: plan.value.endCurrent.endedAt },
    { customerId: plan.value.startNew.customerId, endedAt: plan.value.startNew.endedAt },
  ];
  const vehicleAfter = { currentOwnerCustomerId: currentOwnerCustomerId(periods) };
  const invoiceOfA = { customerId: IDS.customerA, status: 'issued' as const };
  const documentOfA = { customerId: IDS.customerA, visibility: 'customer' as const, publishedAt: '2026-05-02T10:00:00Z', kind: 'invoice' as const };
  const entryFromOrderOfA: ServiceEntry = {
    id: tid(601),
    vehicleId: IDS.vehicle1,
    workOrderId: IDS.workOrderA,
    maintenanceTypeId: IDS.maintenanceOil,
    maintenanceTypeName: '[TEST] Ölwechsel',
    performedOn: '2026-05-02',
    odometerKm: 88_000,
    title: 'Ölwechsel mit Filter',
    details: null,
    workshopName: 'Autowerkstatt Witten',
    intervalKm: 15_000,
    intervalMonths: 12,
    nextDueDate: '2027-05-02',
    nextDueKm: 103_000,
    status: 'valid',
    revisionNo: 1,
    revisionOfId: null,
    correctionReason: null,
    createdAt: '2026-05-02T15:00:00Z',
  };

  it('der neue Halter ist aktueller Halter', () => {
    expect(vehicleAfter.currentOwnerCustomerId).toBe(IDS.customerC);
  });

  it('Vorbesitzer sieht das Fahrzeug und dessen Servicehistorie nicht mehr', () => {
    expect(notFoundOf(canViewVehicle(customerA(), vehicleAfter))).toBe(true);
    expect(allowed(canViewServiceHistory(customerA(), vehicleAfter))).toBe(false);
    expect(allowed(canManageVehicleShares(customerA(), vehicleAfter))).toBe(false);
  });

  it('Vorbesitzer behält seine Aufträge, Rechnungen, Dokumente und Nachrichten', () => {
    expect(allowed(canViewWorkOrder(customerA(), workOrderOfA))).toBe(true);
    expect(allowed(canViewInvoice(customerA(), invoiceOfA))).toBe(true);
    expect(allowed(canViewDocument(customerA(), documentOfA))).toBe(true);
    expect(allowed(canViewMessages(customerA(), workOrderOfA))).toBe(true);
  });

  it('neuer Halter sieht keine Aufträge, Dokumente, Nachrichten, Freigaben oder Rechnungen des Vorbesitzers', () => {
    const c = customerC();
    for (const d of [
      canViewWorkOrder(c, workOrderOfA),
      canViewInvoice(c, invoiceOfA),
      canViewDocument(c, documentOfA),
      canViewMessages(c, workOrderOfA),
      canSendMessage(c, workOrderOfA),
      canViewApprovalRequest(c, { workOrder: workOrderOfA, status: 'approved' }),
      canDecideApproval(c, { workOrderCustomerId: IDS.customerA }),
    ]) {
      expect(d.allowed).toBe(false);
      expect(notFoundOf(d)).toBe(true);
    }
  });

  it('neuer Halter sieht Fahrzeug und Servicehistorie, aber ohne Auftragsbezug des Vorbesitzers', () => {
    const c = customerC();
    expect(allowed(canViewVehicle(c, vehicleAfter))).toBe(true);
    expect(allowed(canViewServiceHistory(c, vehicleAfter))).toBe(true);
    expect(allowed(canManageVehicleShares(c, vehicleAfter))).toBe(true);
    const shown = serviceEntryForActor(entryFromOrderOfA, { workOrderCustomerId: IDS.customerA }, c);
    expect(shown.workOrderId).toBeNull();
    expect(shown.odometerKm).toBe(88_000);
    expect(shown.title).toBe('Ölwechsel mit Filter');
    // Vorbesitzer (bzw. jeder Kunde mit eigenem Auftrag) sähe den Bezug:
    expect(serviceEntryForActor(entryFromOrderOfA, { workOrderCustomerId: IDS.customerA }, customerA()).workOrderId).toBe(IDS.workOrderA);
    // Mitarbeiter sehen den Bezug immer.
    expect(serviceEntryForActor(entryFromOrderOfA, { workOrderCustomerId: IDS.customerA }, service()).workOrderId).toBe(IDS.workOrderA);
  });

  it('beim Halterwechsel werden Freigaben des Vorbesitzers widerrufen und die QR-Kurzansicht ausgeschaltet', () => {
    expect(plan.value.revokeSharesOfPreviousOwner).toBe(true);
    expect(plan.value.disableQrPublicView).toBe(true);
  });
});

describe('Abnahme: Mechaniker', () => {
  it('sieht nur zugewiesene Aufträge (am Auftrag oder an einer Position)', () => {
    expect(allowed(canViewWorkOrder(mechanic(), workOrderOfA))).toBe(true);
    const viaItem: WorkOrderAccessInput = { customerId: IDS.customerB, assigneeUserIds: [], itemAssigneeUserIds: [IDS.mechanicUser] };
    expect(allowed(canViewWorkOrder(mechanic(), viaItem))).toBe(true);
    const d = canViewWorkOrder(mechanic(), workOrderOfB);
    expect(reasonOf(d)).toBe('NOT_ASSIGNED');
    expect(notFoundOf(d)).toBe(false);
  });

  it('sieht mit zugewiesenem Recht workOrders.read alle Aufträge', () => {
    expect(allowed(canViewWorkOrder(mechanic([grant('workOrders.read')]), workOrderOfB))).toBe(true);
  });

  it('sieht keine Preise und keine Rechnungen', () => {
    expect(canSeePrices(mechanic())).toBe(false);
    expect(reasonOf(canViewInvoice(mechanic(), { customerId: IDS.customerA, status: 'issued' }))).toBe('MISSING_PERMISSION');
    expect(reasonOf(canViewApprovalRequest(mechanic(), { workOrder: workOrderOfA, status: 'pending_customer' }))).toBe('ROLE_NOT_ALLOWED');
  });

  it('kann nie für den Kunden freigeben, ebenso wenig Service und Admin', () => {
    for (const actor of [mechanic(), mechanic([grant('workOrders.read')]), service(), admin()]) {
      const d = canDecideApproval(actor, { workOrderCustomerId: IDS.customerA });
      expect(reasonOf(d)).toBe('NOT_CUSTOMER');
    }
    expect(allowed(canDecideApproval(customerA(), { workOrderCustomerId: IDS.customerA }))).toBe(true);
    expect(allowed(canDecideApproval(customerB(), { workOrderCustomerId: IDS.customerA }))).toBe(false);
  });

  it('Freigabe nur mit aktivem Kundenkonto', () => {
    const disabled = customerActor(IDS.customerAUser, IDS.customerA, 'disabled');
    expect(reasonOf(canDecideApproval(disabled, { workOrderCustomerId: IDS.customerA }))).toBe('ACCOUNT_INACTIVE');
  });

  it('sieht Fahrzeug und Servicehistorie nur über eine Zuweisung', () => {
    const v = { currentOwnerCustomerId: IDS.customerA, actorAssignedViaWorkOrder: true };
    expect(allowed(canViewVehicle(mechanic(), v))).toBe(true);
    expect(allowed(canViewServiceHistory(mechanic(), v))).toBe(true);
    const notAssigned = { currentOwnerCustomerId: IDS.customerA, actorAssignedViaWorkOrder: false };
    expect(allowed(canViewVehicle(mechanic(), notAssigned))).toBe(false);
    expect(allowed(canViewServiceHistory(mechanic(), notAssigned))).toBe(false);
    expect(allowed(canViewVehicle(mechanic([grant('vehicles.read')]), notAssigned))).toBe(true);
  });

  it('sieht Kundenakten nur mit zugewiesenem Recht', () => {
    expect(allowed(canViewCustomer(mechanic(), { id: IDS.customerA }))).toBe(false);
    expect(allowed(canViewCustomer(mechanic([grant('customers.read')]), { id: IDS.customerA }))).toBe(true);
  });
});

describe('Positionen ausführen', () => {
  const base = { assignedToUserId: IDS.mechanicUser, authorization: 'approved' as const, workOrderStatus: 'in_progress' as const };

  it('zugewiesener Mechaniker darf freigegebene oder vereinbarte Positionen ausführen', () => {
    expect(allowed(canExecuteWorkItem(mechanic(), base))).toBe(true);
    expect(allowed(canExecuteWorkItem(mechanic(), { ...base, authorization: 'agreed', workOrderStatus: 'open' }))).toBe(true);
  });

  it('nicht zugewiesene, wartende, abgelehnte oder zurückgezogene Positionen sind gesperrt', () => {
    expect(reasonOf(canExecuteWorkItem(mechanic(), { ...base, assignedToUserId: IDS.otherMechanicUser }))).toBe('NOT_ASSIGNED');
    expect(reasonOf(canExecuteWorkItem(mechanic(), { ...base, assignedToUserId: null }))).toBe('NOT_ASSIGNED');
    for (const authorization of ['pending_approval', 'rejected', 'withdrawn'] as const) {
      expect(reasonOf(canExecuteWorkItem(mechanic(), { ...base, authorization }))).toBe('ITEM_NOT_AUTHORIZED');
    }
  });

  it('Mechaniker des Auftrags darf Positionen ohne eigene Zuweisung ausführen, fremd zugewiesene nie', () => {
    const onOwnOrder = { ...base, assignedToUserId: null, workOrderAssigneeUserIds: [IDS.mechanicUser] };
    expect(allowed(canExecuteWorkItem(mechanic(), onOwnOrder))).toBe(true);
    expect(reasonOf(canExecuteWorkItem(mechanic(), { ...onOwnOrder, workOrderAssigneeUserIds: [IDS.otherMechanicUser] }))).toBe('NOT_ASSIGNED');
    expect(
      reasonOf(canExecuteWorkItem(mechanic(), { ...onOwnOrder, assignedToUserId: IDS.otherMechanicUser })),
    ).toBe('NOT_ASSIGNED');
    expect(reasonOf(canExecuteWorkItem(mechanic(), { ...onOwnOrder, authorization: 'pending_approval' }))).toBe('ITEM_NOT_AUTHORIZED');
  });

  it('nur in offenen oder laufenden Aufträgen', () => {
    for (const workOrderStatus of ['draft', 'work_completed', 'completed', 'picked_up', 'cancelled'] as const) {
      expect(reasonOf(canExecuteWorkItem(mechanic(), { ...base, workOrderStatus }))).toBe('WORK_ORDER_NOT_ACTIVE');
    }
  });

  it('Service braucht das zuweisbare Recht workItems.execute, darf dann auch nicht zugewiesene Positionen ausführen', () => {
    expect(reasonOf(canExecuteWorkItem(service(), { ...base, assignedToUserId: null }))).toBe('MISSING_PERMISSION');
    expect(allowed(canExecuteWorkItem(service([grant('workItems.execute')]), { ...base, assignedToUserId: null }))).toBe(true);
    expect(allowed(canExecuteWorkItem(admin(), { ...base, assignedToUserId: null }))).toBe(true);
  });

  it('Kunden führen nie aus', () => {
    expect(reasonOf(canExecuteWorkItem(customerA(), base))).toBe('ROLE_NOT_ALLOWED');
  });
});

describe('Zahlungsrechte', () => {
  it('Service ohne payments.refund kann nicht erstatten', () => {
    const d = canRefundPayment(service());
    expect(reasonOf(d)).toBe('MISSING_PERMISSION');
    expect(notFoundOf(d)).toBe(false);
  });

  it('Rechte-Overrides wirken: Service mit payments.refund darf erstatten, Admin ohne nicht', () => {
    expect(allowed(canRefundPayment(service([grant('payments.refund')])))).toBe(true);
    expect(allowed(canRefundPayment(admin()))).toBe(true);
    expect(allowed(canRefundPayment(staffActor('admin', IDS.adminUser, [revoke('payments.refund')])))).toBe(false);
  });

  it('manuelle Zahlungen und Korrekturen nur mit Recht', () => {
    expect(allowed(canRecordManualPayment(service()))).toBe(false);
    expect(allowed(canRecordManualPayment(service([grant('payments.recordManual')])))).toBe(true);
    expect(allowed(canCorrectServiceEntry(service()))).toBe(false);
    expect(allowed(canCorrectServiceEntry(admin()))).toBe(true);
    expect(allowed(canCorrectServiceEntry(mechanic()))).toBe(false);
  });

  it('Kunden haben keine Rechte, erhalten aber 404-Semantik', () => {
    const d = hasPermission(customerA(), 'payments.refund');
    expect(reasonOf(d)).toBe('ROLE_NOT_ALLOWED');
    expect(notFoundOf(d)).toBe(true);
  });

  it('"Jetzt bezahlen" nur für den Kunden der gestellten Rechnung', () => {
    expect(allowed(canStartCheckout(customerA(), { customerId: IDS.customerA, status: 'issued' }))).toBe(true);
    expect(reasonOf(canStartCheckout(customerA(), { customerId: IDS.customerA, status: 'draft' }))).toBe('DRAFT');
    expect(allowed(canStartCheckout(customerB(), { customerId: IDS.customerA, status: 'issued' }))).toBe(false);
    expect(reasonOf(canStartCheckout(service(), { customerId: IDS.customerA, status: 'issued' }))).toBe('ROLE_NOT_ALLOWED');
  });
});

describe('Rechnungen', () => {
  it('Kunde sieht eigene gestellte Rechnungen, keine Entwürfe, keine fremden', () => {
    expect(allowed(canViewInvoice(customerA(), { customerId: IDS.customerA, status: 'issued' }))).toBe(true);
    expect(allowed(canViewInvoice(customerA(), { customerId: IDS.customerA, status: 'cancelled' }))).toBe(true);
    expect(reasonOf(canViewInvoice(customerA(), { customerId: IDS.customerA, status: 'draft' }))).toBe('DRAFT');
    expect(reasonOf(canViewInvoice(customerA(), { customerId: IDS.customerB, status: 'issued' }))).toBe('NOT_OWN_RECORD');
  });

  it('Mitarbeiter brauchen invoices.read', () => {
    expect(allowed(canViewInvoice(service(), { customerId: IDS.customerA, status: 'draft' }))).toBe(true);
    expect(allowed(canViewInvoice(service([revoke('invoices.read')]), { customerId: IDS.customerA, status: 'issued' }))).toBe(false);
  });
});

describe('Dokumente', () => {
  const published = '2026-09-01T10:00:00Z';

  it('Kunde: nur veröffentlichte Kundendokumente mit eigener Kundennummer', () => {
    expect(allowed(canViewDocument(customerA(), { customerId: IDS.customerA, visibility: 'customer', publishedAt: published }))).toBe(true);
    expect(reasonOf(canViewDocument(customerA(), { customerId: IDS.customerA, visibility: 'internal', publishedAt: published }))).toBe('INTERNAL_ONLY');
    expect(reasonOf(canViewDocument(customerA(), { customerId: IDS.customerA, visibility: 'customer', publishedAt: null }))).toBe('NOT_PUBLISHED');
    expect(reasonOf(canViewDocument(customerA(), { customerId: IDS.customerB, visibility: 'customer', publishedAt: published }))).toBe('NOT_OWN_RECORD');
    expect(reasonOf(canViewDocument(customerA(), { customerId: null, visibility: 'customer', publishedAt: published }))).toBe('NOT_OWN_RECORD');
  });

  it('Service: interne nur mit documents.readInternal', () => {
    const internal = { customerId: IDS.customerA, visibility: 'internal' as const, publishedAt: null };
    const customerDoc = { customerId: IDS.customerA, visibility: 'customer' as const, publishedAt: published };
    expect(allowed(canViewDocument(service(), internal))).toBe(true);
    const noInternal = service([revoke('documents.readInternal')]);
    expect(allowed(canViewDocument(noInternal, internal))).toBe(false);
    expect(allowed(canViewDocument(noInternal, customerDoc))).toBe(true);
  });

  it('Mechaniker: nichts ohne zugewiesenes Recht; mit Recht nie Angebote oder Rechnungen', () => {
    const report = { customerId: IDS.customerA, visibility: 'internal' as const, publishedAt: null, kind: 'report' as const };
    expect(reasonOf(canViewDocument(mechanic(), report))).toBe('MISSING_PERMISSION');
    const m = mechanic([grant('documents.readInternal')]);
    expect(allowed(canViewDocument(m, report))).toBe(true);
    expect(reasonOf(canViewDocument(m, { ...report, kind: 'invoice' }))).toBe('ROLE_NOT_ALLOWED');
    expect(reasonOf(canViewDocument(m, { ...report, kind: 'offer' }))).toBe('ROLE_NOT_ALLOWED');
  });
});

describe('Chat und interne Notizen', () => {
  it('Kunde: Chat nur zu eigenen Aufträgen, interne Notizen nie', () => {
    expect(allowed(canSendMessage(customerA(), workOrderOfA))).toBe(true);
    expect(allowed(canSendMessage(customerA(), workOrderOfB))).toBe(false);
    expect(reasonOf(canViewInternalNotes(customerA(), workOrderOfA))).toBe('INTERNAL_ONLY');
  });

  it('Mechaniker: Chat nur mit zugewiesenem Recht und Zuweisung', () => {
    expect(reasonOf(canViewMessages(mechanic(), workOrderOfA))).toBe('MISSING_PERMISSION');
    const m = mechanic([grant('messages.customerChat')]);
    expect(allowed(canViewMessages(m, workOrderOfA))).toBe(true);
    expect(reasonOf(canViewMessages(m, workOrderOfB))).toBe('NOT_ASSIGNED');
    expect(allowed(canViewMessages(service(), workOrderOfB))).toBe(true);
  });

  it('Mitarbeiter sehen interne Notizen zugewiesener bzw. lesbarer Aufträge', () => {
    expect(allowed(canViewInternalNotes(mechanic(), workOrderOfA))).toBe(true);
    expect(allowed(canViewInternalNotes(mechanic(), workOrderOfB))).toBe(false);
    expect(allowed(canViewInternalNotes(service(), workOrderOfB))).toBe(true);
  });
});

describe('Freigabeanfragen ansehen', () => {
  it('Kunde sieht gesendete Anfragen eigener Aufträge, keine Entwürfe', () => {
    expect(allowed(canViewApprovalRequest(customerA(), { workOrder: workOrderOfA, status: 'pending_customer' }))).toBe(true);
    expect(reasonOf(canViewApprovalRequest(customerA(), { workOrder: workOrderOfA, status: 'draft' }))).toBe('DRAFT');
    expect(allowed(canViewApprovalRequest(service(), { workOrder: workOrderOfA, status: 'draft' }))).toBe(true);
  });
});

describe('Termine', () => {
  it('Kunde sieht eigene Termine, Mechaniker zugewiesene, Service alle', () => {
    const appt = { customerId: IDS.customerA, assigneeUserIds: [IDS.mechanicUser] };
    expect(allowed(canViewAppointment(customerA(), appt))).toBe(true);
    expect(allowed(canViewAppointment(customerB(), appt))).toBe(false);
    expect(allowed(canViewAppointment(mechanic(), appt))).toBe(true);
    expect(allowed(canViewAppointment(mechanic(), { customerId: IDS.customerA, assigneeUserIds: [] }))).toBe(false);
    expect(allowed(canViewAppointment(service(), { customerId: IDS.customerB }))).toBe(true);
  });
});

describe('Konten', () => {
  it('inaktive Konten erhalten nie Zugriff', () => {
    const disabled = customerActor(IDS.customerAUser, IDS.customerA, 'disabled');
    expect(reasonOf(canViewVehicle(disabled, { currentOwnerCustomerId: IDS.customerA }))).toBe('ACCOUNT_INACTIVE');
    const disabledStaff: Actor = { ...admin(), accountActive: false };
    expect(reasonOf(canViewWorkOrder(disabledStaff, workOrderOfA))).toBe('ACCOUNT_INACTIVE');
  });

  it('Kundenkonto ohne verknüpften Kundendatensatz sieht nichts', () => {
    const unlinked: Actor = { ...customerA(), customerId: null };
    expect(reasonOf(canViewWorkOrder(unlinked, workOrderOfA))).toBe('NO_CUSTOMER_LINK');
  });

  it('Kunde sieht nur den eigenen Kundendatensatz', () => {
    expect(allowed(canViewCustomer(customerA(), { id: IDS.customerA }))).toBe(true);
    expect(notFoundOf(canViewCustomer(customerA(), { id: IDS.customerB }))).toBe(true);
  });

  it('Mitarbeiter verwalten keine Fahrzeugfreigaben für Kunden', () => {
    expect(reasonOf(canManageVehicleShares(admin(), { currentOwnerCustomerId: IDS.customerA }))).toBe('ROLE_NOT_ALLOWED');
  });
});
