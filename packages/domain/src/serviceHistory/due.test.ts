import { describe, expect, it } from 'vitest';
import { IDS, tid } from '../testing/fixtures';
import { evaluateMaintenanceDue, evaluateVehicleMaintenance } from './due';
import type { ServiceEntryRecord } from './entries';

function entry(over: Partial<ServiceEntryRecord> = {}): ServiceEntryRecord {
  return {
    id: tid(7001),
    vehicleId: IDS.vehicle1,
    workOrderId: IDS.workOrderA,
    maintenanceTypeId: IDS.maintenanceOil,
    maintenanceTypeName: '[TEST] Ölwechsel',
    performedOn: '2025-01-10',
    odometerKm: 100_000,
    title: 'Ölwechsel',
    details: null,
    workshopName: 'Autowerkstatt Witten',
    intervalKm: 15_000,
    intervalMonths: 12,
    nextDueDate: '2026-01-10',
    nextDueKm: 115_000,
    status: 'valid',
    revisionOfId: null,
    revisionNo: 1,
    ...over,
  };
}

const reading = (valueKm: number, recordedAt: string, plausibility: 'ok' | 'lower_than_previous' = 'ok') => ({ valueKm, recordedAt, plausibility });

describe('Abnahme: Fälligkeit mit kombinierten Intervallen', () => {
  it('zuerst erreichte Grenze ist maßgeblich: km vor Datum', () => {
    const due = evaluateMaintenanceDue({ entry: entry(), odometerReadings: [reading(116_000, '2025-08-20T10:00:00Z')], today: '2025-09-01' });
    expect(due).toMatchObject({ governingLimit: 'km', basis: 'km_recorded', state: 'overdue', dueKm: 115_000, dueDate: '2026-01-10', estimatedCurrentKm: null });
    expect(due?.explanation).toContain('zuletzt erfasst 116.000 km am 20.08.2025');
  });

  it('zuerst erreichte Grenze ist maßgeblich: Datum vor km', () => {
    const due = evaluateMaintenanceDue({ entry: entry(), odometerReadings: [reading(105_000, '2025-12-01T10:00:00Z')], today: '2026-01-15' });
    expect(due).toMatchObject({ governingLimit: 'date', basis: 'date', state: 'overdue' });
    expect(due?.explanation).toContain('fällig am 10.01.2026');
  });

  it('bald fällig nach Tagen bzw. Kilometern', () => {
    const byDate = evaluateMaintenanceDue({ entry: entry(), odometerReadings: [reading(101_000, '2025-12-01T10:00:00Z')], today: '2025-12-20' });
    expect(byDate).toMatchObject({ governingLimit: 'date', state: 'due_soon' });
    const byKm = evaluateMaintenanceDue({ entry: entry(), odometerReadings: [reading(114_500, '2025-06-01T10:00:00Z')], today: '2025-06-02' });
    expect(byKm).toMatchObject({ governingLimit: 'km', state: 'due_soon', basis: 'km_recorded' });
  });

  it('ohne km-Ablesung nach dem Eintrag: Schätzung aus mindestens 2 Ständen über 30 Tage, gekennzeichnet', () => {
    const due = evaluateMaintenanceDue({
      entry: entry(),
      // ein Stand vor dem Eintrag; der km-Stand des Eintrags zählt als zweiter Stand
      odometerReadings: [reading(80_000, '2024-01-10T10:00:00Z')],
      today: '2025-09-01',
    });
    // 20.000 km in 366 Tagen ≈ 54,6 km/Tag; 234 Tage seit dem Eintrag ≈ 12.787 km
    expect(due).toMatchObject({ governingLimit: 'km', basis: 'km_estimated', state: 'ok', estimatedCurrentKm: 112_787 });
    expect(due?.explanation).toContain('geschätzt anhand von 2 Kilometerständen');
    expect(due?.explanation).toContain('(geschätzt)');
  });

  it('ohne Grundlage keine vorgetäuschte km-Fälligkeit: Datum maßgeblich, km als nicht beurteilbar erklärt', () => {
    const due = evaluateMaintenanceDue({ entry: entry(), odometerReadings: [reading(100_000, '2025-01-10T12:00:00Z')], today: '2025-09-01' });
    expect(due).toMatchObject({ governingLimit: 'date', basis: 'date', state: 'ok', estimatedCurrentKm: null });
    expect(due?.explanation).toContain('nicht beurteilbar');
  });

  it('reines Zeitintervall (z. B. HU): keine km-Schätzung, auch wenn genug Kilometerstände vorliegen', () => {
    const due = evaluateMaintenanceDue({
      entry: entry({ intervalKm: null, nextDueKm: null, intervalMonths: 24, nextDueDate: '2027-01-10' }),
      odometerReadings: [reading(80_000, '2024-01-10T10:00:00Z')],
      today: '2025-09-01',
    });
    expect(due).toMatchObject({ governingLimit: 'date', basis: 'date', state: 'ok', dueKm: null, estimatedCurrentKm: null });
    expect(due?.explanation).not.toContain('geschätzt');
  });

  it('nur km-Intervall und keine Daten → unknown', () => {
    const due = evaluateMaintenanceDue({ entry: entry({ intervalMonths: null, nextDueDate: null }), odometerReadings: [], today: '2025-09-01' });
    expect(due).toMatchObject({ governingLimit: 'km', basis: 'unknown', state: 'unknown', dueKm: 115_000, dueDate: null });
  });

  it('km-Stand bei Durchführung unbekannt → keine km-Fälligkeit', () => {
    const due = evaluateMaintenanceDue({
      entry: entry({ odometerKm: null, nextDueKm: null, intervalMonths: null, nextDueDate: null }),
      odometerReadings: [reading(120_000, '2025-08-01T10:00:00Z')],
      today: '2025-09-01',
    });
    expect(due).toMatchObject({ state: 'unknown', basis: 'unknown', dueKm: null });
    expect(due?.explanation).toContain('km-Stand bei der Durchführung unbekannt');
  });

  it('ohne Intervall → none/unknown', () => {
    const due = evaluateMaintenanceDue({
      entry: entry({ intervalKm: null, intervalMonths: null, nextDueDate: null, nextDueKm: null }),
      odometerReadings: [],
      today: '2025-09-01',
    });
    expect(due).toMatchObject({ governingLimit: 'none', basis: 'unknown', state: 'unknown' });
  });

  it('unplausible km-Stände werden ignoriert', () => {
    const due = evaluateMaintenanceDue({
      entry: entry(),
      odometerReadings: [reading(10_000, '2025-08-20T10:00:00Z', 'lower_than_previous')],
      today: '2025-09-01',
    });
    expect(due?.basis).toBe('date');
  });

  it('nicht gültige Einträge werden nicht bewertet', () => {
    expect(evaluateMaintenanceDue({ entry: entry({ status: 'superseded' }), odometerReadings: [], today: '2025-09-01' })).toBeNull();
    expect(evaluateMaintenanceDue({ entry: entry({ status: 'voided' }), odometerReadings: [], today: '2025-09-01' })).toBeNull();
  });
});

describe('Fälligkeiten eines Fahrzeugs', () => {
  it('je Wartungsart zählt der jüngste gültige Eintrag', () => {
    const older = entry({ id: tid(7101), performedOn: '2024-01-10', nextDueDate: '2025-01-10', nextDueKm: 95_000, odometerKm: 80_000 });
    const newer = entry({ id: tid(7102) });
    const voidedNewest = entry({ id: tid(7103), performedOn: '2025-06-01', status: 'voided' });
    const inspection = entry({
      id: tid(7104),
      maintenanceTypeId: IDS.maintenanceInspection,
      maintenanceTypeName: '[TEST] Inspektion',
      performedOn: '2023-01-10',
      intervalMonths: 24,
      nextDueDate: '2025-01-10',
      intervalKm: null,
      nextDueKm: null,
    });
    const list = evaluateVehicleMaintenance({ entries: [older, newer, voidedNewest, inspection], odometerReadings: [], today: '2025-09-01' });
    expect(list.map((d) => d.lastServiceEntryId)).toEqual([tid(7104), tid(7102)]);
    expect(list[0]).toMatchObject({ state: 'overdue', title: '[TEST] Inspektion' });
  });

  it('bei gleichem Datum gewinnt die höhere Revision', () => {
    const r1 = entry({ id: tid(7201), revisionNo: 1, status: 'valid' });
    const r2 = entry({ id: tid(7202), revisionNo: 2, revisionOfId: tid(7201) });
    expect(evaluateVehicleMaintenance({ entries: [r2, r1], odometerReadings: [], today: '2025-09-01' })[0]?.lastServiceEntryId).toBe(tid(7202));
  });
});
