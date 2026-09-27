/**
 * Terminanfragen und Alternativvorschläge (R-KAL-5): Eine Anfrage ist keine Buchung.
 * Bestätigung oder Alternativvorschlag der Werkstatt ist ein eigener Schritt; nimmt der
 * Kunde eine Alternative an, ist der Termin bestätigt.
 *
 * Platzhalter für @werkstatt/domain; reine Funktionen.
 */
import type { AppointmentKind } from '@werkstatt/contracts';
import { ApiError, ERROR_CODES } from '../../errors';
import type { DAppointment } from '../model';

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
  if (!(Date.parse(args.preferredEnd) > Date.parse(args.preferredStart))) {
    throw ApiError.validation('Das Ende muss nach dem Beginn liegen.');
  }
  if (Date.parse(args.preferredStart) < Date.parse(args.now)) {
    throw ApiError.validation('Der Wunschtermin liegt in der Vergangenheit.');
  }
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

export function confirm(appointment: DAppointment, now: string): DAppointment {
  if (appointment.status !== 'requested') {
    throw ApiError.conflict(ERROR_CODES.conflict, 'Nur angefragte Termine können bestätigt werden.');
  }
  return { ...appointment, status: 'confirmed', confirmedAt: now };
}

export function proposeAlternative(
  appointment: DAppointment,
  proposal: { id: string; startsAt: string; endsAt: string },
  now: string,
): DAppointment {
  if (appointment.status !== 'requested' && appointment.status !== 'proposed') {
    throw ApiError.conflict(ERROR_CODES.conflict, 'Für diesen Termin kann keine Alternative vorgeschlagen werden.');
  }
  if (!(Date.parse(proposal.endsAt) > Date.parse(proposal.startsAt))) {
    throw ApiError.validation('Das Ende muss nach dem Beginn liegen.');
  }
  return {
    ...appointment,
    status: 'proposed',
    proposals: [
      ...appointment.proposals.map((p) => (p.status === 'open' ? { ...p, status: 'superseded' as const, respondedAt: now } : p)),
      { id: proposal.id, startsAt: proposal.startsAt, endsAt: proposal.endsAt, status: 'open', createdAt: now, respondedAt: null },
    ],
  };
}

function openProposal(appointment: DAppointment, proposalId: string) {
  const proposal = appointment.proposals.find((p) => p.id === proposalId);
  if (!proposal) throw ApiError.notFound();
  if (proposal.status !== 'open' || appointment.status !== 'proposed') {
    throw ApiError.conflict(ERROR_CODES.conflict, 'Dieser Vorschlag ist nicht mehr gültig.');
  }
  return proposal;
}

export function acceptProposal(appointment: DAppointment, proposalId: string, now: string): DAppointment {
  const proposal = openProposal(appointment, proposalId);
  return {
    ...appointment,
    status: 'confirmed',
    startsAt: proposal.startsAt,
    endsAt: proposal.endsAt,
    confirmedAt: now,
    proposals: appointment.proposals.map((p) => (p.id === proposalId ? { ...p, status: 'accepted', respondedAt: now } : p)),
  };
}

/** Ablehnen der Alternative: Anfrage bleibt offen, die Werkstatt wird informiert. */
export function declineProposal(appointment: DAppointment, proposalId: string, now: string): DAppointment {
  openProposal(appointment, proposalId);
  return {
    ...appointment,
    status: 'requested',
    proposals: appointment.proposals.map((p) => (p.id === proposalId ? { ...p, status: 'declined', respondedAt: now } : p)),
  };
}

export function cancel(appointment: DAppointment, reason: string, now: string): DAppointment {
  if (!['requested', 'proposed', 'confirmed'].includes(appointment.status)) {
    throw ApiError.conflict(ERROR_CODES.conflict, 'Dieser Termin kann nicht mehr abgesagt werden.');
  }
  if (!reason.trim()) throw ApiError.validation('Bitte geben Sie einen Grund an.');
  return {
    ...appointment,
    status: 'cancelled',
    cancelledAt: now,
    cancelReason: reason.trim(),
    proposals: appointment.proposals.map((p) => (p.status === 'open' ? { ...p, status: 'superseded', respondedAt: now } : p)),
  };
}
