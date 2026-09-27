/**
 * Terminanfragen, Alternativen und Konfliktprüfung im Demo-Modus (R-KAL-4, R-KAL-5) mit den
 * Regeln aus @werkstatt/domain: Statuswechsel (`APPOINTMENT_TRANSITIONS`), Vorschläge
 * (`proposeAlternative`, `acceptProposal`, `declineProposal`) und Konflikte
 * (`detectConflicts`: Doppelbelegung von Hebebühne und Mitarbeiter, außerhalb Arbeits- bzw.
 * Öffnungszeit, fehlende Teile). Eine Anfrage ist keine Buchung; nur bestätigte Termine
 * blockieren.
 */
import { apiCodeFromDomain, type AppointmentKind, type AppointmentStatus, type SchedulingConflict } from '@werkstatt/contracts';
import {
  APPOINTMENT_TRANSITIONS,
  acceptProposal as domainAccept,
  declineProposal as domainDecline,
  detectConflicts,
  proposeAlternative as domainPropose,
  type OpeningHoursSlot,
  type PartDemandInput,
  type WorkingHoursSlot,
} from '@werkstatt/domain';
import { ApiError } from '../../errors';
import type { DAppointment } from '../model';

function ensureTransition(appointment: DAppointment, to: AppointmentStatus, message: string) {
  if (!APPOINTMENT_TRANSITIONS[appointment.status].includes(to)) throw ApiError.conflict(apiCodeFromDomain('TRANSITION_NOT_ALLOWED'), message);
}

export function createRequest(args: {
  id: string;
  customerId: string;
  vehicleId: string;
  kind: AppointmentKind;
  preferredStart: string;
  preferredEnd: string;
  customerNote: string | null;
  now: string;
}): DAppointment {
  if (!(Date.parse(args.preferredEnd) > Date.parse(args.preferredStart))) throw ApiError.validation('Das Ende muss nach dem Beginn liegen.');
  if (Date.parse(args.preferredStart) < Date.parse(args.now)) throw ApiError.validation('Der Wunschtermin liegt in der Vergangenheit.');
  return {
    id: args.id,
    kind: args.kind,
    status: 'requested',
    customerId: args.customerId,
    vehicleId: args.vehicleId,
    workOrderId: null,
    startsAt: args.preferredStart,
    endsAt: args.preferredEnd,
    resourceId: null,
    assigneeIds: [],
    requestedBy: 'customer',
    customerNote: args.customerNote,
    internalNote: null,
    proposals: [],
    confirmedAt: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: args.now,
  };
}

export function confirm(appointment: DAppointment, now: string, patch: Partial<Pick<DAppointment, 'resourceId' | 'assigneeIds' | 'internalNote'>> = {}): DAppointment {
  if (appointment.status !== 'requested') throw ApiError.conflict(apiCodeFromDomain('TRANSITION_NOT_ALLOWED'), 'Nur angefragte Termine können bestätigt werden.');
  ensureTransition(appointment, 'confirmed', 'Nur angefragte Termine können bestätigt werden.');
  return { ...appointment, ...patch, status: 'confirmed', confirmedAt: now };
}

export function proposeAlternative(appointment: DAppointment, proposal: { id: string; startsAt: string; endsAt: string }, now: string): DAppointment {
  const result = domainPropose(appointment, proposal);
  if (!result.ok) {
    if (result.error.code === 'INVALID_TIME_RANGE') throw ApiError.validation(result.error.message);
    throw ApiError.conflict(apiCodeFromDomain(result.error.code), result.error.message);
  }
  const superseded = new Set(result.value.supersededProposalIds);
  return {
    ...appointment,
    status: 'proposed',
    proposals: [
      ...appointment.proposals.map((p) => (superseded.has(p.id) ? { ...p, status: 'superseded' as const, respondedAt: now } : p)),
      { id: proposal.id, startsAt: result.value.newProposal.startsAt, endsAt: result.value.newProposal.endsAt, status: 'open', createdAt: now, respondedAt: null },
    ],
  };
}

export function acceptProposal(appointment: DAppointment, proposalId: string, now: string): DAppointment {
  const result = domainAccept(appointment, proposalId, new Date(now));
  if (!result.ok) throw ApiError.conflict(apiCodeFromDomain(result.error.code), result.error.message);
  const superseded = new Set(result.value.supersededProposalIds);
  return {
    ...appointment,
    status: 'confirmed',
    startsAt: result.value.startsAt,
    endsAt: result.value.endsAt,
    confirmedAt: result.value.confirmedAt,
    proposals: appointment.proposals.map((p) =>
      p.id === proposalId ? { ...p, status: 'accepted', respondedAt: now } : superseded.has(p.id) ? { ...p, status: 'superseded', respondedAt: now } : p,
    ),
  };
}

/** Ablehnen der Alternative: Anfrage bleibt offen (oder wird mit `cancel` abgesagt), die Werkstatt wird informiert. */
export function declineProposal(appointment: DAppointment, proposalId: string, now: string, options: { cancel?: boolean } = {}): DAppointment {
  const result = domainDecline(appointment, proposalId, options);
  if (!result.ok) throw ApiError.conflict(apiCodeFromDomain(result.error.code), result.error.message);
  return {
    ...appointment,
    status: result.value.status,
    ...(result.value.status === 'cancelled' ? { cancelledAt: now, cancelReason: 'Vorschlag abgelehnt und Anfrage zurückgezogen' } : {}),
    proposals: appointment.proposals.map((p) => (p.id === proposalId ? { ...p, status: 'declined', respondedAt: now } : p)),
  };
}

export function cancel(appointment: DAppointment, reason: string, now: string): DAppointment {
  ensureTransition(appointment, 'cancelled', 'Dieser Termin kann nicht mehr abgesagt werden.');
  if (!reason.trim()) throw ApiError.validation('Bitte geben Sie einen Grund an.');
  return {
    ...appointment,
    status: 'cancelled',
    cancelledAt: now,
    cancelReason: reason.trim(),
    proposals: appointment.proposals.map((p) => (p.status === 'open' ? { ...p, status: 'superseded', respondedAt: now } : p)),
  };
}

/** Konfliktprüfung wie in der API (Domain `detectConflicts`). */
export function conflictsFor(args: {
  candidate: { id?: string | null; startsAt: string; endsAt: string; resourceId: string | null; assigneeIds: readonly string[]; workOrderId?: string | null };
  appointments: readonly DAppointment[];
  workingHours: readonly WorkingHoursSlot[];
  openingHours: readonly OpeningHoursSlot[];
  partDemands: readonly PartDemandInput[];
  resourceNames: Record<string, string>;
  staffNames: Record<string, string>;
}): SchedulingConflict[] {
  if (!(Date.parse(args.candidate.endsAt) > Date.parse(args.candidate.startsAt))) throw ApiError.validation('Das Ende muss nach dem Beginn liegen.');
  return detectConflicts({
    candidate: args.candidate,
    existing: args.appointments.map((a) => ({ id: a.id, status: a.status, startsAt: a.startsAt, endsAt: a.endsAt, resourceId: a.resourceId, assigneeIds: a.assigneeIds })),
    workingHours: args.workingHours,
    openingHours: args.openingHours,
    // Teile eines Auftrags zählen nur für Termine dieses Auftrags
    partDemands: args.candidate.workOrderId ? args.partDemands.filter((p) => p.workOrderId === args.candidate.workOrderId) : [],
    resourceNames: args.resourceNames,
    staffNames: args.staffNames,
  });
}
