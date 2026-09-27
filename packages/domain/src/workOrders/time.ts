/**
 * Zeiterfassung je Position: Aus Start-, Pause- und Ende-Ereignissen entstehen Zeitabschnitte
 * (`time_entries`); die erfasste Zeit ist die Summe der Abschnitte.
 */
import { OCCURRED_AT_MAX_FUTURE_MS, OCCURRED_AT_MAX_PAST_MS } from '@werkstatt/contracts';
import { toDate } from '../common/dates';
import { ok, type DomainIssue, type Result } from '../common/result';

/** Ereignis am Timer einer Position. */
export interface TimeEvent {
  type: 'start' | 'pause' | 'finish';
  at: Date | string;
}

/** Zeitabschnitt; `endedAt: null` = läuft noch. */
export interface TimeSegment {
  startedAt: string;
  endedAt: string | null;
}

/**
 * Baut Zeitabschnitte aus Ereignissen (werden zeitlich sortiert). Ein `start` bei bereits
 * laufendem Abschnitt wird ignoriert, ebenso `pause`/`finish` ohne laufenden Abschnitt.
 */
export function buildTimeSegments(events: readonly TimeEvent[]): TimeSegment[] {
  const sorted = events
    .map((e, index) => ({ type: e.type, at: toDate(e.at), index }))
    .sort((a, b) => a.at.getTime() - b.at.getTime() || a.index - b.index);
  const segments: TimeSegment[] = [];
  let open: string | null = null;
  for (const e of sorted) {
    if (e.type === 'start') {
      if (open === null) open = e.at.toISOString();
    } else if (open !== null) {
      segments.push({ startedAt: open, endedAt: e.at.toISOString() });
      open = null;
    }
  }
  if (open !== null) segments.push({ startedAt: open, endedAt: null });
  return segments;
}

/**
 * Erfasste Minuten (auf ganze Minuten gerundet) über alle Abschnitte. Ein laufender Abschnitt
 * zählt bis `now`, ohne `now` gar nicht. Abschnitte mit Ende vor Beginn zählen 0.
 * Abschnitte verschiedener Mitarbeiter werden addiert (nicht zusammengelegt).
 */
export function trackedMinutes(segments: readonly { startedAt: Date | string; endedAt: Date | string | null }[], now?: Date): number {
  let totalMs = 0;
  for (const s of segments) {
    const start = toDate(s.startedAt).getTime();
    const end = s.endedAt === null ? (now ? now.getTime() : start) : toDate(s.endedAt).getTime();
    totalMs += Math.max(0, end - start);
  }
  return Math.round(totalMs / 60_000);
}

/** Warum ein Zeitpunkt vom Gerät nicht übernommen wird. */
export type OccurredAtRejection = 'in_future' | 'too_old' | 'before_last_record';

export interface OccurredAtIssue extends DomainIssue<'INVALID_OCCURRED_AT'> {
  reason: OccurredAtRejection;
  /** Letzter erfasster Zeitpunkt der Position (nur bei `before_last_record`) */
  lastRecordedAt: string | null;
}

/**
 * Zeitpunkt der Erfassung auf dem Gerät (`occurredAt`, Offline-Warteschlange, ADR-011) für Start,
 * Pause, Abschluss und "nicht durchgeführt" prüfen. Ohne Gerätezeitpunkt gilt `now` (Serverzeit),
 * höchstens aber der letzte erfasste Zeitpunkt der Position, falls dieser später liegt.
 *
 * Angenommen wird ein Zeitpunkt nur, wenn er
 * - höchstens 5 Minuten nach `now` liegt (Uhr des Geräts geht leicht vor),
 * - höchstens 72 Stunden vor `now` liegt und
 * - nicht vor dem letzten erfassten Zeitpunkt der Position (`lastRecordedAt`, letzter Beginn
 *   bzw. letztes Ende eines Zeitabschnitts); gleich ist erlaubt.
 *
 * Grenzen: `OCCURRED_AT_MAX_FUTURE_MS`, `OCCURRED_AT_MAX_PAST_MS` (packages/contracts). Der
 * Zeitpunkt gilt nur für Zeiten, nie für Freigaben oder Zahlungen (AGENTS.md Regel 10).
 */
export function resolveOccurredAt(input: {
  occurredAt: Date | string | null | undefined;
  now: Date;
  lastRecordedAt: Date | string | null;
}): Result<{ at: Date; fromDevice: boolean }, OccurredAtIssue> {
  if (input.occurredAt === null || input.occurredAt === undefined) {
    // Serverzeit, aber nie vor dem letzten erfassten Zeitpunkt: Eine vorher angenommene Gerätezeit
    // darf bis zu 5 Minuten voraus liegen; sonst entstünde ein Abschnitt mit Ende vor Beginn.
    const last = input.lastRecordedAt === null ? null : toDate(input.lastRecordedAt).getTime();
    return ok({ at: new Date(last !== null && last > input.now.getTime() ? last : input.now.getTime()), fromDevice: false });
  }
  const at = toDate(input.occurredAt);
  const now = input.now.getTime();
  const reject = (reason: OccurredAtRejection, message: string, lastRecordedAt: string | null = null): Result<never, OccurredAtIssue> => ({
    ok: false,
    error: { code: 'INVALID_OCCURRED_AT', message, reason, lastRecordedAt },
  });
  if (at.getTime() - now > OCCURRED_AT_MAX_FUTURE_MS) {
    return reject('in_future', 'Der erfasste Zeitpunkt liegt mehr als 5 Minuten in der Zukunft. Bitte die Uhrzeit des Geräts prüfen.');
  }
  if (now - at.getTime() > OCCURRED_AT_MAX_PAST_MS) {
    return reject('too_old', 'Der erfasste Zeitpunkt liegt mehr als 72 Stunden zurück. So alte Zeiten werden nicht automatisch übernommen.');
  }
  if (input.lastRecordedAt !== null) {
    const last = toDate(input.lastRecordedAt);
    if (at.getTime() < last.getTime()) {
      return reject(
        'before_last_record',
        'Der erfasste Zeitpunkt liegt vor der letzten Zeiterfassung dieser Position. Die Reihenfolge der Zeiten wäre sonst nicht stimmig.',
        last.toISOString(),
      );
    }
  }
  return ok({ at, fromDevice: true });
}

/** Letzter erfasster Zeitpunkt einer Position: spätester Beginn bzw. spätestes Ende ihrer Zeitabschnitte. */
export function lastRecordedTime(segments: readonly { startedAt: Date | string; endedAt: Date | string | null }[]): Date | null {
  let last: number | null = null;
  for (const s of segments) {
    for (const v of [s.startedAt, s.endedAt]) {
      if (v === null) continue;
      const t = toDate(v).getTime();
      if (last === null || t > last) last = t;
    }
  }
  return last === null ? null : new Date(last);
}
