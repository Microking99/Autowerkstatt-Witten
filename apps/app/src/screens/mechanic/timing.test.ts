import { describe, expect, it } from 'vitest';
import { createEntry, type QueueEntry } from '../../offline/queueCore';
import { itemTiming, partLabel, partRows } from './timing';

const T = (hhmm: string) => `2026-09-27T${hhmm}:00.000Z`;
const pending = (kind: QueueEntry['kind'], at: string, extra: Partial<QueueEntry> = {}): QueueEntry => ({
  ...createEntry({ id: `${kind}-${at}`, kind, workOrderId: 'wo', scope: 'item:1', label: kind, payload: { itemId: '1' } }, at),
  ...extra,
});

describe('Zeitanzeige der Position', () => {
  it('ohne laufenden Abschnitt: erfasste Minuten vom Server', () => {
    expect(itemTiming({ executionStatus: 'paused', trackedMinutes: 42, runningSince: null }, [], T('09:00'), new Date(T('10:00')))).toEqual({ minutes: 42, since: null, sinceLocal: false });
  });

  it('laufend auf dem Server: seit runningSince, weiter gezählt ab dem Ladezeitpunkt', () => {
    // Server: 30 min abgeschlossen + 20 min laufend (seit 08:40) bis zur Antwort um 09:00
    const item = { executionStatus: 'in_progress' as const, trackedMinutes: 50, runningSince: T('08:40') };
    expect(itemTiming(item, [], T('09:00'), new Date(T('09:15')))).toEqual({ minutes: 65, since: T('08:40'), sinceLocal: false });
    // Geräteuhr 3 Minuten nach: Ladezeitpunkt und Jetzt verschieben sich gleich, Anzeige bleibt richtig
    expect(itemTiming(item, [], T('09:03'), new Date(T('09:18'))).minutes).toBe(65);
  });

  it('Start noch nicht übertragen: läuft lokal ab dem Erfassungszeitpunkt', () => {
    const r = itemTiming({ executionStatus: 'planned', trackedMinutes: 0, runningSince: null }, [pending('startWorkItem', T('09:00'))], T('08:55'), new Date(T('09:25')));
    expect(r).toEqual({ minutes: 25, since: T('09:00'), sinceLocal: true });
  });

  it('Pause noch nicht übertragen: laufender Serverabschnitt endet beim Erfassungszeitpunkt', () => {
    const item = { executionStatus: 'in_progress' as const, trackedMinutes: 10, runningSince: T('09:00') };
    const r = itemTiming(item, [pending('pauseWorkItem', T('09:30'))], T('09:10'), new Date(T('10:00')));
    expect(r).toEqual({ minutes: 30, since: null, sinceLocal: false });
  });

  it('Start, Pause, Start offline: Summe der lokalen Abschnitte; ein Konflikt beendet die Vorschau', () => {
    const entries = [pending('startWorkItem', T('08:00')), pending('pauseWorkItem', T('08:20')), pending('startWorkItem', T('08:30'))];
    expect(itemTiming({ executionStatus: 'planned', trackedMinutes: 5, runningSince: null }, entries, null, new Date(T('08:40'))).minutes).toBe(35);
    const blocked = [pending('startWorkItem', T('08:00'), { state: 'conflict' }), pending('pauseWorkItem', T('08:20'))];
    expect(itemTiming({ executionStatus: 'planned', trackedMinutes: 5, runningSince: null }, blocked, null, new Date(T('08:40')))).toEqual({ minutes: 5, since: null, sinceLocal: false });
  });
});

describe('Teileliste der Position', () => {
  it('Teile vom Server zuerst, dann wartende aus der Warteschlange (gekennzeichnet)', () => {
    const waiting = createEntry({ id: 'e1', kind: 'addPart', workOrderId: 'wo', scope: 'item:1', label: 'Teil', payload: { itemId: '1', input: { partNumber: 'OF-1', description: 'Ölfilter', quantity: 1 } } }, T('09:05'));
    const start = pending('startWorkItem', T('09:00'));
    const rows = partRows([{ id: 'p1', partNumber: null, description: 'Motoröl 5W-30', quantity: 4.5, recordedAt: T('08:50') }], [start, waiting]);
    expect(rows.map((r) => [r.key, r.description, r.pending ? 'wartet' : 'bestätigt'])).toEqual([
      ['p1', 'Motoröl 5W-30', 'bestätigt'],
      ['e1', 'Ölfilter', 'wartet'],
    ]);
    expect(rows[0]).not.toHaveProperty('unitPriceCents');
    expect(partLabel(rows[0]!)).toBe('4,5 × Motoröl 5W-30');
    expect(partLabel(rows[1]!)).toBe('1 × Ölfilter (OF-1)');
    expect(partRows(undefined, [])).toEqual([]);
  });

  it('Preis nur, wenn die Antwort ihn enthält', () => {
    const [row] = partRows([{ id: 'p1', partNumber: null, description: 'Dichtring', quantity: 1, unitPriceCents: 120, recordedAt: T('08:50') }], []);
    expect(row?.unitPriceCents).toBe(120);
  });
});
