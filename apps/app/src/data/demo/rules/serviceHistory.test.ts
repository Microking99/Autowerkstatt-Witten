import { createActor, effectivePermissions } from '@werkstatt/domain';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../errors';
import type { DMaintenanceType, DServiceEntry, DWorkItem, DWorkOrder } from '../model';
import { addMonths, completeReview, correctEntry, visibleEntries } from './serviceHistory';

let n = 0;
const nextId = () => `se-${++n}`;
const NOW = '2026-09-26T15:00:00.000Z';

const types: DMaintenanceType[] = [
  { id: 'mt-oil', key: 'oil', name: 'Ölwechsel mit Filter', defaultIntervalKm: 15_000, defaultIntervalMonths: 12, intervalOptions: [], active: true },
];

const workOrder: DWorkOrder = {
  id: 'wo-1', orderNumber: 'A-1', customerId: 'k-1', vehicleId: 'veh-1', status: 'work_completed', title: 't', descriptionCustomer: null, notesInternal: null,
  costLimitCents: null, plannedStart: null, plannedEnd: null, readyForPickupAt: null, pickedUpAt: null, completionReviewedAt: null, completionReviewedBy: null,
  cancelledAt: null, cancelReason: null, assigneeIds: [], createdAt: NOW, updatedAt: NOW,
};

const item = (p: Partial<DWorkItem>): DWorkItem => ({
  id: `item-${++n}`, workOrderId: 'wo-1', position: 1, kind: 'labor', title: 'Position', description: null, maintenanceTypeId: null, intervalKm: null, intervalMonths: null,
  quantity: 1, unit: 'Stk', unitPriceCents: 1000, vatRateBp: 1900, origin: 'intake', authorization: 'agreed', executionStatus: 'done', approvalRequestId: null,
  approvedVersionId: null, assignedTo: null, doneAt: '2026-09-25T10:00:00.000Z', doneBy: 'u-m', doneOdometerKm: 91_480, resultNotes: null, trackedMinutes: 0, runningSince: null, parts: [], ...p,
});

const admin = createActor({ userId: 'u-admin', role: 'admin', status: 'active' });
const serviceRights = new Set(effectivePermissions('service', []));

const args = (items: DWorkItem[], existing: DServiceEntry[] = [], wo = workOrder) => ({
  workOrder: wo, items, existingEntries: existing, maintenanceTypes: types, workshopName: 'Autowerkstatt Witten', reviewerId: 'u-service', permissions: serviceRights, now: NOW, odometerKm: null, newId: nextId,
});

describe('Serviceeinträge nur aus fachlichem Abschluss (Regel 8)', () => {
  it('erzeugt je erledigter Wartungsposition genau einen Eintrag mit Fälligkeit', () => {
    const oil = item({ maintenanceTypeId: 'mt-oil', title: 'Ölwechsel' });
    const other = item({ title: 'Wischerblätter' });
    const { workOrder: after, entries } = completeReview(args([oil, other]));
    expect(after.status).toBe('completed');
    expect(entries).toHaveLength(1);
    // Datum der Durchführung = Tag des fachlichen Abschlusses (wie die API)
    expect(entries[0]).toMatchObject({ workItemId: oil.id, odometerKm: 91_480, nextDueKm: 106_480, nextDueDate: '2027-09-26', revisionNo: 1, status: 'valid' });
  });

  it('verlangt das Recht für den fachlichen Abschluss', () => {
    expect(() => completeReview({ ...args([item({ maintenanceTypeId: 'mt-oil' })]), permissions: new Set() })).toThrow(ApiError);
  });

  it('übernimmt abgelehnte, nicht durchgeführte oder nicht freigegebene Positionen nie (Regel 5)', () => {
    const rejected = item({ maintenanceTypeId: 'mt-oil', authorization: 'rejected', executionStatus: 'planned' });
    const notDone = item({ maintenanceTypeId: 'mt-oil', executionStatus: 'not_done' });
    const withdrawn = item({ maintenanceTypeId: 'mt-oil', authorization: 'withdrawn', executionStatus: 'planned' });
    const { entries } = completeReview(args([rejected, notDone, withdrawn, item({})]));
    expect(entries).toHaveLength(0);
  });

  it('verweigert den Abschluss, solange ausführbare Arbeiten offen sind', () => {
    expect(() => completeReview(args([item({ maintenanceTypeId: 'mt-oil', executionStatus: 'in_progress' })]))).toThrow(ApiError);
    expect(() => completeReview(args([item({})], [], { ...workOrder, status: 'in_progress' }))).toThrow(ApiError);
  });

  it('wartende Freigaben blockieren den Abschluss nicht (nur Hinweis), erscheinen aber nie in der Historie', () => {
    const pending = item({ maintenanceTypeId: 'mt-oil', authorization: 'pending_approval', executionStatus: 'planned' });
    const { entries } = completeReview(args([item({}), pending]));
    expect(entries).toHaveLength(0);
  });

  it('erzeugt bei wiederholtem Abschluss keine Duplikate', () => {
    const oil = item({ maintenanceTypeId: 'mt-oil' });
    const first = completeReview(args([oil]));
    expect(first.entries).toHaveLength(1);
    // wiederholter Abschluss (wie die API idempotent): keine Fehlermeldung, keine neuen Einträge
    expect(completeReview(args([oil], first.entries, first.workOrder)).entries).toHaveLength(0);
    // Auch ein erneuter Lauf mit zurückgesetztem Status legt nichts doppelt an
    const again = completeReview(args([oil], first.entries));
    expect(again.entries).toHaveLength(0);
  });

  it('täuscht ohne km-Stand keine km-Fälligkeit vor (R-SERV-4)', () => {
    const { entries } = completeReview(args([item({ maintenanceTypeId: 'mt-oil', doneOdometerKm: null })]));
    expect(entries[0]).toMatchObject({ odometerKm: null, nextDueKm: null, nextDueDate: '2027-09-26' });
  });
});

describe('Korrekturen als Revision (R-SERV-8)', () => {
  it('legt eine neue Revision an und markiert die alte als ersetzt', () => {
    const { entries } = completeReview(args([item({ maintenanceTypeId: 'mt-oil', doneOdometerKm: 8_402 })]));
    const original = entries[0]!;
    const { previous, revision } = correctEntry(original, { odometerKm: 84_020, reason: 'Tippfehler' }, { newId: 'rev-2', actor: admin, maintenanceTypeName: 'Ölwechsel mit Filter', now: NOW });
    expect(previous.status).toBe('superseded');
    expect(revision).toMatchObject({ revisionOfId: original.id, revisionNo: 2, odometerKm: 84_020, nextDueKm: 99_020, correctionReason: 'Tippfehler', status: 'valid' });
    expect(visibleEntries([previous, revision], 'veh-1').map((e) => e.id)).toEqual(['rev-2']);
  });

  it('verlangt eine Begründung', () => {
    const { entries } = completeReview(args([item({ maintenanceTypeId: 'mt-oil' })]));
    expect(() => correctEntry(entries[0]!, { reason: '  ', odometerKm: 1 }, { newId: 'x', actor: admin, maintenanceTypeName: null, now: NOW })).toThrow(ApiError);
  });

  it('verlangt das Korrekturrecht', () => {
    const { entries } = completeReview(args([item({ maintenanceTypeId: 'mt-oil' })]));
    const mechanic = createActor({ userId: 'u-m', role: 'mechanic', status: 'active' });
    expect(() => correctEntry(entries[0]!, { reason: 'Tippfehler', odometerKm: 1 }, { newId: 'x', actor: mechanic, maintenanceTypeName: null, now: NOW })).toThrow(ApiError);
  });
});

describe('Datumshilfe', () => {
  it('addiert Monate ohne Überlauf am Monatsende', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-09-26', 24)).toBe('2026-09-26');
  });
});
