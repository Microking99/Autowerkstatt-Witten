import { describe, expect, it } from 'vitest';
import type { ApprovalRequest, ApprovalVersion, Invoice, WorkOrderDetail } from '@werkstatt/contracts';
import { IDS, admin, customerA, mechanic, service, tid } from '../testing/fixtures';
import { redactApprovalRequestForActor, redactInvoiceForActor, redactWorkItemForActor, redactWorkOrderForActor } from './redaction';

function workOrderDetail(): WorkOrderDetail {
  return {
    id: IDS.workOrderA,
    orderNumber: 'A-2026-0001',
    title: '[TEST] Inspektion',
    customerId: IDS.customerA,
    customerDisplayName: '[TEST] Kunde A',
    vehicleId: IDS.vehicle1,
    vehicleLabel: '[TEST] VW Golf',
    licensePlate: 'EN-XX 1',
    status: { work: 'in_progress', approval: 'none', payment: 'no_invoice', overdue: false, readyForPickup: false, pendingApprovalCount: 0 },
    plannedStart: null,
    plannedEnd: null,
    assignees: [{ userId: IDS.mechanicUser, displayName: '[TEST] Mechaniker' }],
    unreadMessages: 0,
    updatedAt: '2026-09-26T08:00:00Z',
    descriptionCustomer: 'Inspektion nach Herstellervorgabe',
    notesInternal: 'Kunde zahlt bar (intern)',
    costLimitCents: 50_000,
    items: [
      {
        id: tid(701),
        workOrderId: IDS.workOrderA,
        position: 1,
        kind: 'labor',
        title: 'Inspektion',
        description: null,
        maintenanceTypeId: IDS.maintenanceInspection,
        intervalKm: 30_000,
        intervalMonths: 24,
        quantity: 2,
        unit: 'Std',
        unitPriceCents: 8_990,
        vatRateBp: 1900,
        origin: 'intake',
        authorization: 'agreed',
        executionStatus: 'in_progress',
        approvalRequestId: null,
        assignedTo: { userId: IDS.mechanicUser, displayName: '[TEST] Mechaniker' },
        doneAt: null,
        doneOdometerKm: null,
        resultNotes: null,
        trackedMinutes: 42,
        runningSince: '2026-09-26T07:30:00.000Z',
        parts: [{ id: tid(711), partNumber: 'OF-123', description: 'Ölfilter', quantity: 1, unitPriceCents: 1_234, recordedAt: '2026-09-26T07:45:00.000Z' }],
      },
    ],
    intake: {
      id: tid(801),
      workOrderId: IDS.workOrderA,
      odometerKm: 88_000,
      fuelLevel: '1/2',
      customerComplaint: 'Quietschen beim Bremsen',
      damages: [],
      agreedServices: 'Inspektion',
      costLimitCents: 50_000,
      notesInternal: 'Kunde ist Stammkunde (intern)',
      notesCustomer: 'Bitte vorher anrufen',
      confirmedAt: null,
      confirmationMethod: 'none',
      contentHash: null,
    },
    appointmentIds: [],
    readyForPickupAt: null,
    pickedUpAt: null,
    completionReviewedAt: null,
    createdAt: '2026-09-25T08:00:00Z',
  };
}

describe('Feldfilter Auftrag', () => {
  it('Mechaniker: keine Preise und keine Kostenrahmen, interne Hinweise sichtbar', () => {
    const detail = workOrderDetail();
    const r = redactWorkOrderForActor(detail, mechanic());
    expect('unitPriceCents' in r.items[0]!).toBe(false);
    expect('costLimitCents' in r).toBe(false);
    expect(r.intake && 'costLimitCents' in r.intake).toBe(false);
    expect(r.notesInternal).toBe('Kunde zahlt bar (intern)');
    expect(r.intake?.notesInternal).toBe('Kunde ist Stammkunde (intern)');
    expect(JSON.stringify(r)).not.toContain('8990');
    expect(JSON.stringify(r)).not.toContain('50000');
  });

  it('Mechaniker: Teile ohne Preis, laufende Zeit sichtbar', () => {
    const r = redactWorkOrderForActor(workOrderDetail(), mechanic());
    expect(r.items[0]?.runningSince).toBe('2026-09-26T07:30:00.000Z');
    expect(r.items[0]?.parts).toEqual([{ id: tid(711), partNumber: 'OF-123', description: 'Ölfilter', quantity: 1, recordedAt: '2026-09-26T07:45:00.000Z' }]);
    expect(JSON.stringify(r)).not.toContain('1234');
    // Einzelne Position (Antwort auf Start, Teil erfassen) gleich gefiltert
    const single = redactWorkItemForActor(workOrderDetail().items[0]!, mechanic());
    expect('unitPriceCents' in single).toBe(false);
    expect(single.parts?.[0] && 'unitPriceCents' in single.parts[0]).toBe(false);
  });

  it('Kunde: keine laufende Zeiterfassung und keine verbauten Teile', () => {
    const r = redactWorkOrderForActor(workOrderDetail(), customerA());
    expect('runningSince' in r.items[0]!).toBe(false);
    expect('parts' in r.items[0]!).toBe(false);
    expect(JSON.stringify(r)).not.toContain('Ölfilter');
    const single = redactWorkItemForActor(workOrderDetail().items[0]!, customerA());
    expect('runningSince' in single || 'parts' in single).toBe(false);
  });

  it('Service: Teile mit Preis', () => {
    const r = redactWorkOrderForActor(workOrderDetail(), service());
    expect(r.items[0]?.parts?.[0]?.unitPriceCents).toBe(1_234);
  });

  it('Kunde: keine internen Notizen und keine internen Annahmehinweise, Preise sichtbar', () => {
    const r = redactWorkOrderForActor(workOrderDetail(), customerA());
    expect('notesInternal' in r).toBe(false);
    expect(r.intake && 'notesInternal' in r.intake).toBe(false);
    expect(JSON.stringify(r)).not.toContain('(intern)');
    expect(r.items[0]?.unitPriceCents).toBe(8_990);
    expect(r.intake?.notesCustomer).toBe('Bitte vorher anrufen');
  });

  it('Admin und Service: unverändert; Eingabe wird nie verändert', () => {
    const detail = workOrderDetail();
    const before = JSON.stringify(detail);
    expect(redactWorkOrderForActor(detail, admin())).toEqual(detail);
    expect(redactWorkOrderForActor(detail, service())).toEqual(detail);
    redactWorkOrderForActor(detail, mechanic());
    redactWorkOrderForActor(detail, customerA());
    expect(JSON.stringify(detail)).toBe(before);
  });
});

describe('Feldfilter Rechnung und Freigabe', () => {
  it('Kunde sieht keine Zahlungsversuche und Erstattungsvorgänge', () => {
    const invoice = {
      id: tid(901),
      checkouts: [{ id: tid(902), status: 'failed', amountCents: 100, createdAt: '2026-09-26T08:00:00Z', lastCheckedAt: null }],
      refunds: [],
    } as unknown as Invoice;
    const r = redactInvoiceForActor(invoice, customerA());
    expect('checkouts' in r).toBe(false);
    expect('refunds' in r).toBe(false);
    expect(redactInvoiceForActor(invoice, service()).checkouts).toHaveLength(1);
  });

  it('Kunde sieht nur gesendete Versionen', () => {
    const v = (n: number, sentAt: string | null): ApprovalVersion => ({ id: tid(950 + n), versionNo: n, sentAt } as unknown as ApprovalVersion);
    const request = { id: tid(960), versions: [v(1, '2026-09-20T08:00:00Z'), v(2, null)] } as unknown as ApprovalRequest;
    expect(redactApprovalRequestForActor(request, customerA()).versions.map((x) => x.versionNo)).toEqual([1]);
    expect(redactApprovalRequestForActor(request, service()).versions).toHaveLength(2);
  });
});
