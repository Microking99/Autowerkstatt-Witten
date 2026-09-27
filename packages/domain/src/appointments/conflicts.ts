/**
 * Konfliktprüfung bei der Terminplanung (R-KAL-4).
 *
 * Geprüft wird:
 * - Doppelbelegung einer Hebebühne bzw. eines Arbeitsplatzes,
 * - Doppelbelegung eines zuständigen Mitarbeiters,
 * - Termin außerhalb der Arbeitszeit eines zuständigen Mitarbeiters,
 * - Termin außerhalb der Öffnungszeiten der Werkstatt,
 * - benötigte Teile, die noch nicht eingetroffen (`received`) oder verbaut (`installed`) sind.
 *
 * Blockierend sind nur gebuchte Termine (`confirmed`); Anfragen und Vorschläge sind keine
 * Buchungen. Zeiten werden in Berliner Ortszeit mit Arbeits- und Öffnungszeiten verglichen
 * (Wochentag 1 = Montag … 7 = Sonntag). Zeiträume sind halboffen: Ein Termin, der um 10:00
 * endet, kollidiert nicht mit einem, der um 10:00 beginnt.
 * Die Meldungen sind deutsch und für die Oberfläche geeignet.
 */
import type { AppointmentStatus, SchedulingConflict } from '@werkstatt/contracts';
import { toDate } from '../common/dates';
import { DomainError } from '../common/result';
import { toBerlinLocal } from '../format/berlin';
import { formatDate, formatTime } from '../format/format';

/** Geplanter oder zu prüfender Termin. */
export interface ScheduleCandidate {
  /** Beim Verschieben eines bestehenden Termins dessen ID (wird nicht mit sich selbst verglichen). */
  id?: string | null;
  startsAt: string;
  endsAt: string;
  resourceId: string | null;
  assigneeIds: readonly string[];
  workOrderId?: string | null;
}

/** Bestehender Termin. */
export interface ExistingAppointment {
  id: string;
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
  resourceId: string | null;
  assigneeIds: readonly string[];
}

/** Arbeitszeit eines Mitarbeiters an einem Wochentag (`HH:MM`). */
export interface WorkingHoursSlot {
  userId: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

/** Öffnungszeit der Werkstatt an einem Wochentag (`HH:MM`); mehrere Blöcke je Tag möglich. */
export interface OpeningHoursSlot {
  weekday: number;
  opens: string;
  closes: string;
}

/** Teilebedarf (Tabelle `part_demands`). */
export interface PartDemandInput {
  workOrderId?: string | null;
  description: string;
  status: 'needed' | 'ordered' | 'received' | 'installed';
  expectedAt?: string | null;
}

const PART_STATUS_TEXT: Record<PartDemandInput['status'], string> = {
  needed: 'noch nicht bestellt',
  ordered: 'bestellt',
  received: 'eingetroffen',
  installed: 'verbaut',
};

/** Uhrzeit auf `HH:MM` bringen ("8:00" → "08:00", "08:00:00" → "08:00"). */
function normalizeClock(value: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) throw new DomainError('INVALID_TIME', `Ungültige Uhrzeit: ${value}`);
  return `${m[1]!.padStart(2, '0')}:${m[2]}`;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function range(startsAt: string, endsAt: string): string {
  const sameDay = formatDate(startsAt) === formatDate(endsAt);
  return sameDay
    ? `am ${formatDate(startsAt)} von ${formatTime(startsAt)} bis ${formatTime(endsAt)} Uhr`
    : `vom ${formatDate(startsAt)}, ${formatTime(startsAt)} Uhr bis ${formatDate(endsAt)}, ${formatTime(endsAt)} Uhr`;
}

/**
 * true, wenn [start, end) in einen der Blöcke passt. Bei mehrtägigen Terminen müssen Beginn
 * und Ende jeweils in einem Block ihres Tages liegen.
 */
function fitsSlots(start: Date, end: Date, rawSlots: readonly { weekday: number; from: string; to: string }[]): boolean {
  const slots = rawSlots.map((slot) => ({ weekday: slot.weekday, from: normalizeClock(slot.from), to: normalizeClock(slot.to) }));
  const s = toBerlinLocal(start);
  const e = toBerlinLocal(end);
  const within = (weekday: number, time: string, inclusiveEnd: boolean): boolean =>
    slots.some((slot) => slot.weekday === weekday && slot.from <= time && (inclusiveEnd ? time <= slot.to : time < slot.to));
  if (s.isoDate === e.isoDate) {
    return slots.some((slot) => slot.weekday === s.weekday && slot.from <= s.time && e.time <= slot.to);
  }
  return within(s.weekday, s.time, false) && within(e.weekday, e.time, true);
}

/**
 * Ermittelt Planungskonflikte für einen Termin. Leere Liste = keine Konflikte.
 *
 * @param input.resourceNames optionale Anzeigenamen der Hebebühnen/Arbeitsplätze.
 * @param input.staffNames optionale Anzeigenamen der Mitarbeiter.
 * @throws DomainError `INVALID_TIME_RANGE`, wenn das Ende nicht nach dem Beginn liegt.
 */
export function detectConflicts(input: {
  candidate: ScheduleCandidate;
  existing: readonly ExistingAppointment[];
  workingHours: readonly WorkingHoursSlot[];
  openingHours: readonly OpeningHoursSlot[];
  partDemands: readonly PartDemandInput[];
  resourceNames?: Readonly<Record<string, string>>;
  staffNames?: Readonly<Record<string, string>>;
}): SchedulingConflict[] {
  const { candidate } = input;
  const start = toDate(candidate.startsAt);
  const end = toDate(candidate.endsAt);
  if (end.getTime() <= start.getTime()) throw new DomainError('INVALID_TIME_RANGE', 'Ende muss nach Beginn liegen.');
  const conflicts: SchedulingConflict[] = [];
  const staffName = (id: string): string => input.staffNames?.[id] ?? 'Ein zuständiger Mitarbeiter';

  const blocking = input.existing.filter(
    (a) => a.status === 'confirmed' && a.id !== candidate.id && overlaps(start.getTime(), end.getTime(), toDate(a.startsAt).getTime(), toDate(a.endsAt).getTime()),
  );

  if (candidate.resourceId) {
    const name = input.resourceNames?.[candidate.resourceId];
    for (const other of blocking.filter((a) => a.resourceId === candidate.resourceId)) {
      conflicts.push({
        kind: 'resource_double_booked',
        message: `${name ? `„${name}“` : 'Die Hebebühne bzw. der Arbeitsplatz'} ist ${range(other.startsAt, other.endsAt)} bereits belegt.`,
        relatedAppointmentId: other.id,
      });
    }
  }

  for (const userId of candidate.assigneeIds) {
    for (const other of blocking.filter((a) => a.assigneeIds.includes(userId))) {
      conflicts.push({
        kind: 'assignee_double_booked',
        message: `${staffName(userId)} ist ${range(other.startsAt, other.endsAt)} bereits für einen anderen Termin eingeplant.`,
        relatedAppointmentId: other.id,
      });
    }
    const slots = input.workingHours.filter((w) => w.userId === userId).map((w) => ({ weekday: w.weekday, from: w.startTime, to: w.endTime }));
    if (slots.length > 0 && !fitsSlots(start, end, slots)) {
      conflicts.push({
        kind: 'outside_working_hours',
        message: `${staffName(userId)} arbeitet ${range(candidate.startsAt, candidate.endsAt)} nicht (außerhalb der Arbeitszeit).`,
        relatedAppointmentId: null,
      });
    }
  }

  if (input.openingHours.length > 0) {
    const slots = input.openingHours.map((o) => ({ weekday: o.weekday, from: o.opens, to: o.closes }));
    if (!fitsSlots(start, end, slots)) {
      conflicts.push({
        kind: 'outside_opening_hours',
        message: `Der Termin ${range(candidate.startsAt, candidate.endsAt)} liegt außerhalb der Öffnungszeiten der Werkstatt.`,
        relatedAppointmentId: null,
      });
    }
  }

  const relevantParts = input.partDemands.filter(
    (p) => !candidate.workOrderId || !p.workOrderId || p.workOrderId === candidate.workOrderId,
  );
  for (const part of relevantParts) {
    if (part.status === 'received' || part.status === 'installed') continue;
    const expected = part.expectedAt ? `, erwartet am ${formatDate(part.expectedAt)}` : '';
    conflicts.push({
      kind: 'parts_missing',
      message: `Benötigtes Teil fehlt: ${part.description} (${PART_STATUS_TEXT[part.status]}${expected}).`,
      relatedAppointmentId: null,
    });
  }
  return conflicts;
}
