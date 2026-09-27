import { describe, expect, it } from 'vitest';
import { IDS } from '../testing/fixtures';
import { finishItem, markNotDone, pauseItem, startItem, type WorkItemExecutionState } from './items';

const now = new Date('2026-09-26T08:00:00Z');
const labor = (over: Partial<WorkItemExecutionState> = {}): WorkItemExecutionState => ({
  authorization: 'agreed',
  executionStatus: 'planned',
  maintenanceTypeId: null,
  ...over,
});
const maintenance = (over: Partial<WorkItemExecutionState> = {}): WorkItemExecutionState => labor({ maintenanceTypeId: IDS.maintenanceOil, ...over });

describe('Positionen: starten, pausieren, abschließen', () => {
  it('startet geplante und pausierte Positionen und öffnet einen Zeitabschnitt', () => {
    const r = startItem(labor(), { now });
    expect(r.ok && r.value).toMatchObject({ executionStatus: 'in_progress', timeEntry: { action: 'open', at: now.toISOString() } });
    expect(startItem(labor({ executionStatus: 'paused' }), { now }).ok).toBe(true);
    expect(startItem(labor({ executionStatus: 'in_progress' }), { now })).toMatchObject({ ok: false, error: { code: 'INVALID_STATUS' } });
    expect(startItem(labor({ executionStatus: 'done' }), { now }).ok).toBe(false);
  });

  it('pausiert nur laufende Positionen und schließt den Zeitabschnitt', () => {
    const r = pauseItem(labor({ executionStatus: 'in_progress' }), { now });
    expect(r.ok && r.value).toMatchObject({ executionStatus: 'paused', timeEntry: { action: 'close' } });
    expect(pauseItem(labor(), { now }).ok).toBe(false);
  });

  it('abgelehnte, zurückgezogene und wartende Positionen dürfen nie gestartet oder abgeschlossen werden', () => {
    for (const authorization of ['rejected', 'withdrawn', 'pending_approval'] as const) {
      expect(startItem(labor({ authorization }), { now })).toMatchObject({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
      expect(finishItem(labor({ authorization, executionStatus: 'in_progress' }), { now })).toMatchObject({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
      expect(markNotDone(labor({ authorization }), { now, reason: 'x' })).toMatchObject({ ok: false, error: { code: 'NOT_AUTHORIZED' } });
      expect(pauseItem(labor({ authorization, executionStatus: 'in_progress' }), { now }).ok).toBe(false);
    }
    const r = startItem(labor({ authorization: 'pending_approval' }), { now });
    expect(!r.ok && r.error.message).toBe('Die Position wartet auf Kundenfreigabe.');
  });

  it('schließt normale Positionen ohne km-Stand ab', () => {
    const r = finishItem(labor({ executionStatus: 'in_progress' }), { now, resultNotes: '  erledigt ' });
    expect(r.ok && r.value).toMatchObject({ executionStatus: 'done', doneAt: now.toISOString(), doneOdometerKm: null, resultNotes: 'erledigt', timeEntry: { action: 'close' } });
    const fromPlanned = finishItem(labor(), { now });
    expect(fromPlanned.ok && fromPlanned.value.timeEntry).toEqual({ action: 'none' });
  });

  it('Wartungspositionen verlangen einen km-Stand', () => {
    expect(finishItem(maintenance({ executionStatus: 'in_progress' }), { now })).toMatchObject({ ok: false, error: { code: 'ODOMETER_REQUIRED' } });
    expect(finishItem(maintenance(), { now, odometerKm: null })).toMatchObject({ ok: false, error: { code: 'ODOMETER_REQUIRED' } });
    const r = finishItem(maintenance(), { now, odometerKm: 123_456 });
    expect(r.ok && r.value).toMatchObject({ executionStatus: 'done', doneOdometerKm: 123_456, odometerUnknown: false });
  });

  it('akzeptiert null nur mit ausdrücklichem odometerUnknown: true', () => {
    const r = finishItem(maintenance(), { now, odometerKm: null, odometerUnknown: true });
    expect(r.ok && r.value).toMatchObject({ doneOdometerKm: null, odometerUnknown: true });
    expect(finishItem(maintenance(), { now, odometerKm: 1000, odometerUnknown: true })).toMatchObject({ ok: false, error: { code: 'INVALID_ODOMETER' } });
    expect(finishItem(maintenance(), { now, odometerKm: -5 })).toMatchObject({ ok: false, error: { code: 'INVALID_ODOMETER' } });
    expect(finishItem(maintenance(), { now, odometerKm: 12.5 })).toMatchObject({ ok: false, error: { code: 'INVALID_ODOMETER' } });
  });

  it('kann abgeschlossene Positionen nicht erneut abschließen', () => {
    expect(finishItem(labor({ executionStatus: 'done' }), { now })).toMatchObject({ ok: false, error: { code: 'INVALID_STATUS' } });
    expect(finishItem(labor({ executionStatus: 'not_done' }), { now }).ok).toBe(false);
  });

  it('markiert als nicht durchgeführt nur mit Begründung', () => {
    expect(markNotDone(labor(), { now, reason: '  ' })).toMatchObject({ ok: false, error: { code: 'REASON_REQUIRED' } });
    const r = markNotDone(labor({ executionStatus: 'in_progress', authorization: 'approved' }), { now, reason: 'Teil nicht lieferbar' });
    expect(r.ok && r.value).toMatchObject({ executionStatus: 'not_done', resultNotes: 'Teil nicht lieferbar', timeEntry: { action: 'close' } });
    expect(markNotDone(labor({ executionStatus: 'done' }), { now, reason: 'x' }).ok).toBe(false);
  });
});
