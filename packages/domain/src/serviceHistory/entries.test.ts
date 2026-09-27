import { describe, expect, it } from 'vitest';
import { DomainError } from '../common/result';
import { IDS, admin, grant, mechanic, service, tid } from '../testing/fixtures';
import { computeNextDue, createCorrection, deriveServiceEntries, type ServiceEntryRecord, type ServiceSourceItem } from './entries';

const maintenanceTypes = [
  { id: IDS.maintenanceOil, name: '[TEST] Ölwechsel', defaultIntervalKm: 15_000, defaultIntervalMonths: 12 },
  { id: IDS.maintenanceInspection, name: '[TEST] Inspektion', defaultIntervalKm: 30_000, defaultIntervalMonths: 24 },
];

function item(n: number, over: Partial<ServiceSourceItem>): ServiceSourceItem {
  return {
    id: tid(5000 + n),
    workOrderId: IDS.workOrderA,
    title: `Position ${n}`,
    description: null,
    maintenanceTypeId: IDS.maintenanceOil,
    intervalKm: null,
    intervalMonths: null,
    authorization: 'agreed',
    executionStatus: 'done',
    doneOdometerKm: 88_000,
    resultNotes: null,
    ...over,
  };
}

const completedOrder = { id: IDS.workOrderA, vehicleId: IDS.vehicle1, status: 'completed' as const };

describe('Nächste Fälligkeit', () => {
  it('berechnet Datum und km aus Intervall', () => {
    expect(computeNextDue({ performedOn: '2026-09-26', odometerKm: 88_000, intervalKm: 15_000, intervalMonths: 12 })).toEqual({
      nextDueDate: '2027-09-26',
      nextDueKm: 103_000,
    });
  });

  it('ohne km-Stand keine km-Fälligkeit, ohne Intervall keine Angabe', () => {
    expect(computeNextDue({ performedOn: '2026-01-31', odometerKm: null, intervalKm: 15_000, intervalMonths: 1 })).toEqual({
      nextDueDate: '2026-02-28',
      nextDueKm: null,
    });
    expect(computeNextDue({ performedOn: '2026-09-26', odometerKm: 1, intervalKm: null, intervalMonths: null })).toEqual({ nextDueDate: null, nextDueKm: null });
  });
});

describe('Abnahme: Serviceeinträge nur aus erledigter, autorisierter Wartungsarbeit', () => {
  const items: ServiceSourceItem[] = [
    item(1, { title: 'Ölwechsel mit Filter', resultNotes: '5W-30, 4,5 l' }),
    item(2, { maintenanceTypeId: IDS.maintenanceInspection, authorization: 'approved', doneOdometerKm: null, intervalMonths: 12, title: 'Inspektion' }),
    item(3, { authorization: 'rejected', title: 'Bremsflüssigkeit (abgelehnt)' }),
    item(4, { authorization: 'pending_approval', executionStatus: 'planned', title: 'Klimaservice (wartet)' }),
    item(5, { executionStatus: 'not_done', title: 'Zündkerzen (nicht durchgeführt)' }),
    item(6, { authorization: 'withdrawn', title: 'Zahnriemen (zurückgezogen)' }),
    item(7, { maintenanceTypeId: null, title: 'Scheibenwischer' }),
    item(8, { executionStatus: 'in_progress', title: 'Luftfilter (läuft noch)' }),
  ];
  const run = (existing: string[] = []) =>
    deriveServiceEntries({
      workOrder: completedOrder,
      items,
      maintenanceTypes,
      performedOn: '2026-09-26',
      odometerKm: 88_010,
      workshopName: 'Autowerkstatt Witten',
      existingEntriesForItems: existing,
      createdBy: IDS.serviceUser,
      now: new Date('2026-09-26T15:00:00Z'),
    });

  it('erzeugt Einträge nur für erledigte, vereinbarte oder freigegebene Wartungspositionen', () => {
    const { entries } = run();
    expect(entries.map((e) => e.workItemId)).toEqual([tid(5001), tid(5002)]);
    expect(entries[0]).toMatchObject({
      vehicleId: IDS.vehicle1,
      workOrderId: IDS.workOrderA,
      maintenanceTypeName: '[TEST] Ölwechsel',
      performedOn: '2026-09-26',
      odometerKm: 88_000,
      title: 'Ölwechsel mit Filter',
      details: '5W-30, 4,5 l',
      intervalKm: 15_000,
      intervalMonths: 12,
      nextDueDate: '2027-09-26',
      nextDueKm: 103_000,
      status: 'valid',
      revisionNo: 1,
      revisionOfId: null,
      source: 'work_completion',
    });
    // km-Stand aus dem Auftragsabschluss, Intervall der Position statt Standard
    expect(entries[1]).toMatchObject({ odometerKm: 88_010, intervalKm: 30_000, intervalMonths: 12, nextDueDate: '2027-09-26', nextDueKm: 118_010 });
  });

  it('keine Einträge aus abgelehnten, wartenden, zurückgezogenen oder nicht durchgeführten Positionen', () => {
    const { skipped } = run();
    expect(skipped).toEqual([
      { itemId: tid(5003), reason: 'NOT_AUTHORIZED' },
      { itemId: tid(5004), reason: 'NOT_AUTHORIZED' },
      { itemId: tid(5005), reason: 'NOT_DONE' },
      { itemId: tid(5006), reason: 'NOT_AUTHORIZED' },
      { itemId: tid(5007), reason: 'NO_MAINTENANCE_TYPE' },
      { itemId: tid(5008), reason: 'NOT_DONE' },
    ]);
  });

  it('wiederholter Abschluss erzeugt nichts Neues', () => {
    const first = run();
    const again = run(first.entries.map((e) => e.workItemId!));
    expect(again.entries).toEqual([]);
    expect(again.skipped.filter((s) => s.reason === 'ALREADY_RECORDED').map((s) => s.itemId)).toEqual([tid(5001), tid(5002)]);
  });

  it('nur beim fachlichen Abschluss (completed), nicht vorher', () => {
    for (const status of ['work_completed', 'in_progress', 'picked_up', 'cancelled'] as const) {
      expect(() =>
        deriveServiceEntries({
          workOrder: { ...completedOrder, status },
          items,
          maintenanceTypes,
          performedOn: '2026-09-26',
          odometerKm: null,
          workshopName: 'Autowerkstatt Witten',
          existingEntriesForItems: [],
        }),
      ).toThrow(DomainError);
    }
  });

  it('Positionen anderer Aufträge und unbekannte Wartungsarten werden übersprungen', () => {
    const r = deriveServiceEntries({
      workOrder: completedOrder,
      items: [item(9, { workOrderId: IDS.workOrderB }), item(10, { maintenanceTypeId: tid(4999) })],
      maintenanceTypes,
      performedOn: '2026-09-26',
      odometerKm: null,
      workshopName: 'Autowerkstatt Witten',
      existingEntriesForItems: new Set<string>(),
    });
    expect(r.entries).toEqual([]);
    expect(r.skipped.map((s) => s.reason)).toEqual(['OTHER_WORK_ORDER', 'UNKNOWN_MAINTENANCE_TYPE']);
  });
});

describe('Korrektur als neue Revision', () => {
  const entry: ServiceEntryRecord = {
    id: tid(6001),
    vehicleId: IDS.vehicle1,
    workOrderId: IDS.workOrderA,
    workItemId: tid(5001),
    maintenanceTypeId: IDS.maintenanceOil,
    maintenanceTypeName: '[TEST] Ölwechsel',
    performedOn: '2026-09-26',
    odometerKm: 88_000,
    title: 'Ölwechsel mit Filter',
    details: null,
    workshopName: 'Autowerkstatt Witten',
    intervalKm: 15_000,
    intervalMonths: 12,
    nextDueDate: '2027-09-26',
    nextDueKm: 103_000,
    status: 'valid',
    revisionOfId: null,
    revisionNo: 1,
  };
  const now = new Date('2026-09-28T09:00:00Z');

  it('erzeugt eine neue Revision, die alte wird superseded, Fälligkeit neu berechnet', () => {
    const r = createCorrection(entry, { odometerKm: 80_000, reason: 'Tippfehler beim km-Stand' }, admin(), now);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.supersede).toEqual({ id: entry.id, status: 'superseded' });
      expect(r.value.newEntry).toMatchObject({
        revisionOfId: entry.id,
        revisionNo: 2,
        correctionReason: 'Tippfehler beim km-Stand',
        odometerKm: 80_000,
        nextDueKm: 95_000,
        nextDueDate: '2027-09-26',
        status: 'valid',
        workItemId: tid(5001),
        createdBy: IDS.adminUser,
        createdAt: now.toISOString(),
      });
    }
  });

  it('void: true erklärt den Eintrag für ungültig, ohne zu löschen', () => {
    const r = createCorrection(entry, { void: true, reason: 'Falsches Fahrzeug erfasst' }, admin(), now);
    expect(r.ok && r.value.newEntry.status).toBe('voided');
    expect(r.ok && r.value.supersede.status).toBe('superseded');
  });

  it('Begründung ist Pflicht, Änderung ist Pflicht', () => {
    expect(createCorrection(entry, { odometerKm: 1, reason: '  ' }, admin(), now)).toMatchObject({ ok: false, error: { code: 'REASON_REQUIRED' } });
    expect(createCorrection(entry, { odometerKm: 88_000, reason: 'x' }, admin(), now)).toMatchObject({ ok: false, error: { code: 'NO_CHANGES' } });
  });

  it('nur gültige Einträge und nur mit serviceHistory.correct', () => {
    expect(createCorrection({ ...entry, status: 'superseded' }, { odometerKm: 1, reason: 'x' }, admin(), now)).toMatchObject({ ok: false, error: { code: 'NOT_CURRENT' } });
    expect(createCorrection(entry, { odometerKm: 1, reason: 'x' }, service(), now)).toMatchObject({ ok: false, error: { code: 'MISSING_PERMISSION' } });
    expect(createCorrection(entry, { odometerKm: 1, reason: 'x' }, mechanic(), now)).toMatchObject({ ok: false, error: { code: 'MISSING_PERMISSION' } });
    expect(createCorrection(entry, { odometerKm: 1, reason: 'x' }, service([grant('serviceHistory.correct')]), now).ok).toBe(true);
  });

  it('lehnt ungültige Werte ab', () => {
    expect(createCorrection(entry, { odometerKm: -1, reason: 'x' }, admin(), now)).toMatchObject({ ok: false, error: { code: 'INVALID_VALUE' } });
    expect(createCorrection(entry, { title: ' ', reason: 'x' }, admin(), now)).toMatchObject({ ok: false, error: { code: 'INVALID_VALUE' } });
    expect(createCorrection(entry, { performedOn: '2026-02-30', reason: 'x' }, admin(), now)).toMatchObject({ ok: false, error: { code: 'INVALID_VALUE' } });
  });
});
