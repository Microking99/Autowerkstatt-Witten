import { describe, expect, it } from 'vitest';
import type { DOdometer, DServiceEntry } from '../model';
import { computeMaintenanceDue, estimateCurrentKm } from './maintenanceDue';

const reading = (valueKm: number, recordedAt: string): DOdometer => ({
  id: `r-${valueKm}`, vehicleId: 'v', valueKm, recordedAt, source: 'intake', workOrderId: null, plausibility: 'ok',
});

const entry = (p: Partial<DServiceEntry>): DServiceEntry => ({
  id: 'e', vehicleId: 'v', workOrderId: null, workItemId: null, maintenanceTypeId: 'mt-oil', performedOn: '2025-10-01', odometerKm: 50_000, title: 'Ölwechsel mit Filter',
  details: null, workshopName: 'W', intervalKm: 15_000, intervalMonths: 12, nextDueDate: '2026-10-01', nextDueKm: 65_000, status: 'valid', revisionOfId: null,
  revisionNo: 1, correctionReason: null, source: 'work_completion', createdBy: null, createdAt: '2025-10-01T10:00:00Z', ...p,
});

describe('Kilometerstand und Schätzung (R-SERV-4)', () => {
  it('nutzt eine aktuelle Angabe direkt', () => {
    const e = estimateCurrentKm([reading(60_000, '2026-09-20T08:00:00Z')], 'v', '2026-09-26');
    expect(e).toMatchObject({ km: 60_000, basis: 'km_recorded' });
  });

  it('rechnet ältere Angaben hoch und kennzeichnet das als Schätzung', () => {
    const e = estimateCurrentKm([reading(40_000, '2025-09-26T08:00:00Z'), reading(50_000, '2026-03-25T08:00:00Z')], 'v', '2026-09-26');
    expect(e.basis).toBe('km_estimated');
    expect(e.km).toBeGreaterThan(50_000);
    expect(e.km).toBeLessThan(62_000);
  });

  it('täuscht ohne ausreichende Angaben keinen km-Stand vor', () => {
    expect(estimateCurrentKm([], 'v', '2026-09-26')).toMatchObject({ km: null, basis: 'unknown' });
    expect(estimateCurrentKm([reading(50_000, '2026-03-01T08:00:00Z')], 'v', '2026-09-26')).toMatchObject({ km: null, basis: 'unknown' });
  });
});

describe('Fälligkeiten: zuerst erreichte Grenze', () => {
  it('Datum maßgeblich, wenn es vor der km-Grenze liegt', () => {
    const [due] = computeMaintenanceDue([entry({})], [reading(52_000, '2026-09-24T08:00:00Z')], 'v', '2026-09-26');
    expect(due).toMatchObject({ governingLimit: 'date', basis: 'date', state: 'due_soon' });
  });

  it('km maßgeblich und als Schätzung gekennzeichnet', () => {
    const readings = [reading(40_000, '2025-06-01T08:00:00Z'), reading(63_000, '2026-06-01T08:00:00Z')];
    const [due] = computeMaintenanceDue([entry({ nextDueDate: '2027-06-01' })], readings, 'v', '2026-09-26');
    expect(due?.governingLimit).toBe('km');
    expect(due?.basis).toBe('km_estimated');
    expect(due?.estimatedCurrentKm).not.toBeNull();
    expect(due?.explanation).toContain('geschätzt');
  });

  it('überfällig, wenn eine Grenze überschritten ist', () => {
    const [due] = computeMaintenanceDue([entry({ nextDueDate: '2026-09-01' })], [reading(52_000, '2026-09-24T08:00:00Z')], 'v', '2026-09-26');
    expect(due?.state).toBe('overdue');
  });

  it('ohne km-Stand nur Datum, mit erklärendem Hinweis', () => {
    const [due] = computeMaintenanceDue([entry({ nextDueDate: '2027-01-01' })], [], 'v', '2026-09-26');
    expect(due?.governingLimit).toBe('date');
    expect(due?.explanation).toContain('Ohne aktuellen Kilometerstand');
  });

  it('berücksichtigt nur gültige Revisionen', () => {
    const list = computeMaintenanceDue([entry({ id: 'alt', status: 'superseded', nextDueDate: '2020-01-01' }), entry({ id: 'neu' })], [], 'v', '2026-09-26');
    expect(list).toHaveLength(1);
    expect(list[0]?.lastServiceEntryId).toBe('neu');
  });
});
