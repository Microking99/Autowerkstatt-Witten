/**
 * Terminstatus (docs/datenmodell.md, Abschnitt 4; R-KAL-5).
 *
 * requested → confirmed | proposed | cancelled
 * proposed  → confirmed (Annahme durch den Kunden) | requested | cancelled (Ablehnung)
 * confirmed → completed | cancelled | no_show
 *
 * Eine Anfrage (`requested`) ist nie eine Buchung; gebucht ist nur `confirmed`.
 * Bestätigen oder Alternativen vorschlagen ist ein eigener Schritt der Werkstatt.
 */
import type { AppointmentStatus } from '@werkstatt/contracts';
import { toDate } from '../common/dates';
import { fail, ok, type DomainIssue, type Result } from '../common/result';
import type { Actor } from '../permissions/actor';

/** Erlaubte Folgestatus. */
export const APPOINTMENT_TRANSITIONS: Readonly<Record<AppointmentStatus, readonly AppointmentStatus[]>> = {
  requested: ['confirmed', 'proposed', 'cancelled'],
  proposed: ['confirmed', 'requested', 'cancelled'],
  confirmed: ['completed', 'cancelled', 'no_show'],
  cancelled: [],
  completed: [],
  no_show: [],
};

/** Übergänge, die ein Kunde bei eigenen Terminen auslösen darf. */
const CUSTOMER_TRANSITIONS: readonly `${AppointmentStatus}->${AppointmentStatus}`[] = [
  'proposed->confirmed',
  'proposed->requested',
  'proposed->cancelled',
  'requested->cancelled',
  'confirmed->cancelled',
];

/** Übergänge der Werkstatt (Recht `appointments.write`). `proposed → confirmed` ist Sache des Kunden. */
const STAFF_TRANSITIONS: readonly `${AppointmentStatus}->${AppointmentStatus}`[] = [
  'requested->confirmed',
  'requested->proposed',
  'requested->cancelled',
  'proposed->requested',
  'proposed->cancelled',
  'confirmed->completed',
  'confirmed->cancelled',
  'confirmed->no_show',
];

/** true, wenn der Termin eine verbindliche Buchung ist (nur `confirmed`). */
export function isBookedAppointment(status: AppointmentStatus): boolean {
  return status === 'confirmed';
}

export type AppointmentTransitionCode = 'SAME_STATUS' | 'TRANSITION_NOT_ALLOWED' | 'NOT_ALLOWED_FOR_ROLE' | 'NOT_OWN_APPOINTMENT' | 'MISSING_PERMISSION' | 'ACCOUNT_INACTIVE';

/**
 * Prüft einen Statuswechsel mit Blick auf die handelnde Person.
 * - Kunde: nur eigene Termine; Alternative annehmen/ablehnen, Anfrage oder Termin absagen.
 * - Werkstatt: Recht `appointments.write`; bestätigen, Alternative vorschlagen, absagen,
 *   erledigt/nicht erschienen. Eine vorgeschlagene Alternative bestätigt nur der Kunde.
 */
export function canTransitionAppointment(
  appointment: { status: AppointmentStatus; customerId: string },
  to: AppointmentStatus,
  actor: Actor,
): Result<{ status: AppointmentStatus }, DomainIssue<AppointmentTransitionCode>> {
  const from = appointment.status;
  if (!actor.accountActive) return fail('ACCOUNT_INACTIVE', 'Das Konto ist nicht aktiv.');
  if (from === to) return fail('SAME_STATUS', 'Der Termin hat diesen Status bereits.');
  if (!APPOINTMENT_TRANSITIONS[from].includes(to)) return fail('TRANSITION_NOT_ALLOWED', `Wechsel von ${from} nach ${to} ist nicht erlaubt.`);
  const key = `${from}->${to}` as const;
  if (actor.role === 'customer') {
    if (!actor.customerId || actor.customerId !== appointment.customerId) return fail('NOT_OWN_APPOINTMENT', 'Termin nicht gefunden.');
    if (!CUSTOMER_TRANSITIONS.includes(key)) return fail('NOT_ALLOWED_FOR_ROLE', 'Diese Änderung nimmt die Werkstatt vor.');
    return ok({ status: to });
  }
  if (!actor.permissions.has('appointments.write')) return fail('MISSING_PERMISSION', 'Dafür fehlt die Berechtigung.');
  if (!STAFF_TRANSITIONS.includes(key)) return fail('NOT_ALLOWED_FOR_ROLE', 'Eine vorgeschlagene Alternative bestätigt nur der Kunde.');
  return ok({ status: to });
}

/** Alternativvorschlag (Tabelle `appointment_proposals`). */
export interface ProposalState {
  id: string;
  startsAt: string;
  endsAt: string;
  status: 'open' | 'accepted' | 'declined' | 'superseded';
}

/**
 * Werkstatt schlägt eine Alternative vor: Termin → `proposed`, frühere offene Vorschläge
 * werden `superseded`.
 */
export function proposeAlternative(
  appointment: { status: AppointmentStatus; proposals: readonly ProposalState[] },
  slot: { startsAt: string; endsAt: string },
): Result<{ status: 'proposed'; newProposal: { startsAt: string; endsAt: string; status: 'open' }; supersededProposalIds: string[] }, DomainIssue<'TRANSITION_NOT_ALLOWED' | 'INVALID_TIME_RANGE'>> {
  if (appointment.status !== 'requested' && appointment.status !== 'proposed') {
    return fail('TRANSITION_NOT_ALLOWED', 'Alternativen können nur zu offenen Anfragen vorgeschlagen werden.');
  }
  const start = toDate(slot.startsAt);
  const end = toDate(slot.endsAt);
  if (end.getTime() <= start.getTime()) return fail('INVALID_TIME_RANGE', 'Ende muss nach Beginn liegen.');
  return ok({
    status: 'proposed',
    newProposal: { startsAt: start.toISOString(), endsAt: end.toISOString(), status: 'open' },
    supersededProposalIds: appointment.proposals.filter((p) => p.status === 'open').map((p) => p.id),
  });
}

/**
 * Kunde nimmt einen offenen Vorschlag an: Termin → `confirmed` mit den Zeiten des Vorschlags;
 * übrige offene Vorschläge → `superseded`.
 */
export function acceptProposal(
  appointment: { status: AppointmentStatus; proposals: readonly ProposalState[] },
  proposalId: string,
  now: Date,
): Result<
  { status: 'confirmed'; startsAt: string; endsAt: string; confirmedAt: string; acceptedProposalId: string; supersededProposalIds: string[] },
  DomainIssue<'TRANSITION_NOT_ALLOWED' | 'PROPOSAL_NOT_OPEN'>
> {
  if (appointment.status !== 'proposed') return fail('TRANSITION_NOT_ALLOWED', 'Es liegt kein offener Vorschlag vor.');
  const proposal = appointment.proposals.find((p) => p.id === proposalId);
  if (!proposal || proposal.status !== 'open') return fail('PROPOSAL_NOT_OPEN', 'Dieser Vorschlag ist nicht mehr gültig.');
  return ok({
    status: 'confirmed',
    startsAt: proposal.startsAt,
    endsAt: proposal.endsAt,
    confirmedAt: now.toISOString(),
    acceptedProposalId: proposal.id,
    supersededProposalIds: appointment.proposals.filter((p) => p.status === 'open' && p.id !== proposal.id).map((p) => p.id),
  });
}

/**
 * Kunde lehnt einen offenen Vorschlag ab: Vorschlag → `declined`; der Termin wird wieder
 * `requested` (Werkstatt kann neu vorschlagen) oder, mit `cancel: true`, `cancelled`.
 */
export function declineProposal(
  appointment: { status: AppointmentStatus; proposals: readonly ProposalState[] },
  proposalId: string,
  options: { cancel?: boolean } = {},
): Result<{ status: 'requested' | 'cancelled'; declinedProposalId: string }, DomainIssue<'TRANSITION_NOT_ALLOWED' | 'PROPOSAL_NOT_OPEN'>> {
  if (appointment.status !== 'proposed') return fail('TRANSITION_NOT_ALLOWED', 'Es liegt kein offener Vorschlag vor.');
  const proposal = appointment.proposals.find((p) => p.id === proposalId);
  if (!proposal || proposal.status !== 'open') return fail('PROPOSAL_NOT_OPEN', 'Dieser Vorschlag ist nicht mehr gültig.');
  return ok({ status: options.cancel ? 'cancelled' : 'requested', declinedProposalId: proposal.id });
}
