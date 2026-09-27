import { describe, expect, it } from 'vitest';
import { buildTimeSegments, lastRecordedTime, resolveOccurredAt, trackedMinutes } from './time';

describe('Zeiterfassung', () => {
  it('baut Zeitabschnitte aus Start, Pause und Ende', () => {
    const segments = buildTimeSegments([
      { type: 'start', at: '2026-09-26T08:00:00Z' },
      { type: 'pause', at: '2026-09-26T09:30:00Z' },
      { type: 'start', at: '2026-09-26T10:00:00Z' },
      { type: 'finish', at: '2026-09-26T10:45:00Z' },
    ]);
    expect(segments).toEqual([
      { startedAt: '2026-09-26T08:00:00.000Z', endedAt: '2026-09-26T09:30:00.000Z' },
      { startedAt: '2026-09-26T10:00:00.000Z', endedAt: '2026-09-26T10:45:00.000Z' },
    ]);
    expect(trackedMinutes(segments)).toBe(135);
  });

  it('sortiert Ereignisse und ignoriert doppelte Starts sowie Pausen ohne Start', () => {
    const segments = buildTimeSegments([
      { type: 'pause', at: '2026-09-26T07:00:00Z' },
      { type: 'start', at: '2026-09-26T08:30:00Z' },
      { type: 'start', at: '2026-09-26T08:00:00Z' },
      { type: 'finish', at: '2026-09-26T09:00:00Z' },
    ]);
    expect(segments).toEqual([{ startedAt: '2026-09-26T08:00:00.000Z', endedAt: '2026-09-26T09:00:00.000Z' }]);
  });

  it('zählt laufende Abschnitte bis now, ohne now gar nicht', () => {
    const segments = buildTimeSegments([{ type: 'start', at: '2026-09-26T08:00:00Z' }]);
    expect(segments).toEqual([{ startedAt: '2026-09-26T08:00:00.000Z', endedAt: null }]);
    expect(trackedMinutes(segments)).toBe(0);
    expect(trackedMinutes(segments, new Date('2026-09-26T08:20:29Z'))).toBe(20);
  });

  it('zählt fehlerhafte Abschnitte (Ende vor Beginn) mit 0', () => {
    expect(trackedMinutes([{ startedAt: '2026-09-26T09:00:00Z', endedAt: '2026-09-26T08:00:00Z' }])).toBe(0);
  });
});

describe('Zeitpunkt vom Gerät (occurredAt)', () => {
  const now = new Date('2026-09-27T10:00:00.000Z');

  it('ohne Gerätezeitpunkt gilt die Serverzeit', () => {
    const r = resolveOccurredAt({ occurredAt: undefined, now, lastRecordedAt: '2026-09-27T09:00:00Z' });
    expect(r).toEqual({ ok: true, value: { at: now, fromDevice: false } });
  });

  it('nimmt Zeitpunkte bis 5 Minuten voraus und bis 72 Stunden zurück an', () => {
    for (const occurredAt of ['2026-09-27T10:05:00.000Z', '2026-09-24T10:00:00.000Z', '2026-09-27T08:00:00Z']) {
      const r = resolveOccurredAt({ occurredAt, now, lastRecordedAt: null });
      expect(r.ok && r.value.fromDevice).toBe(true);
      expect(r.ok && r.value.at.toISOString()).toBe(new Date(occurredAt).toISOString());
    }
  });

  it('lehnt mehr als 5 Minuten in der Zukunft ab', () => {
    const r = resolveOccurredAt({ occurredAt: '2026-09-27T10:05:00.001Z', now, lastRecordedAt: null });
    expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_OCCURRED_AT', reason: 'in_future' } });
    expect(!r.ok && r.error.message).toContain('5 Minuten');
  });

  it('lehnt mehr als 72 Stunden zurück ab', () => {
    const r = resolveOccurredAt({ occurredAt: '2026-09-24T09:59:59.999Z', now, lastRecordedAt: null });
    expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_OCCURRED_AT', reason: 'too_old' } });
    expect(!r.ok && r.error.message).toContain('72 Stunden');
  });

  it('lehnt Zeitpunkte vor dem letzten erfassten Zeitpunkt der Position ab, gleich ist erlaubt', () => {
    const last = '2026-09-27T09:30:00.000Z';
    const before = resolveOccurredAt({ occurredAt: '2026-09-27T09:29:59Z', now, lastRecordedAt: last });
    expect(before).toMatchObject({ ok: false, error: { code: 'INVALID_OCCURRED_AT', reason: 'before_last_record', lastRecordedAt: last } });
    expect(resolveOccurredAt({ occurredAt: last, now, lastRecordedAt: last }).ok).toBe(true);
  });

  it('letzter erfasster Zeitpunkt: spätester Beginn oder spätestes Ende', () => {
    expect(lastRecordedTime([])).toBeNull();
    expect(
      lastRecordedTime([
        { startedAt: '2026-09-27T08:00:00Z', endedAt: '2026-09-27T09:00:00Z' },
        { startedAt: '2026-09-27T09:15:00Z', endedAt: null },
      ])?.toISOString(),
    ).toBe('2026-09-27T09:15:00.000Z');
    expect(lastRecordedTime([{ startedAt: new Date('2026-09-27T08:00:00Z'), endedAt: new Date('2026-09-27T09:40:00Z') }])?.toISOString()).toBe('2026-09-27T09:40:00.000Z');
  });
});
