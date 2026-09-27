import { describe, expect, it } from 'vitest';
import { buildTimeSegments, trackedMinutes } from './time';

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
