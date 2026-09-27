/**
 * Zeiterfassung je Position: Aus Start-, Pause- und Ende-Ereignissen entstehen Zeitabschnitte
 * (`time_entries`); die erfasste Zeit ist die Summe der Abschnitte.
 */
import { toDate } from '../common/dates';

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
