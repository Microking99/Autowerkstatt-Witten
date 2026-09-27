import { describe, expect, it } from 'vitest';
import { IDS, admin, customerA, customerB, mechanic, service, tid } from '../testing/fixtures';
import { detectConflicts, type ExistingAppointment, type OpeningHoursSlot, type ScheduleCandidate, type WorkingHoursSlot } from './conflicts';
import { acceptProposal, canTransitionAppointment, declineProposal, isBookedAppointment, proposeAlternative, type ProposalState } from './transitions';

describe('Terminstatus', () => {
  const appt = (status: Parameters<typeof canTransitionAppointment>[0]['status']) => ({ status, customerId: IDS.customerA });

  it('eine Anfrage ist nie eine Buchung', () => {
    expect(isBookedAppointment('requested')).toBe(false);
    expect(isBookedAppointment('proposed')).toBe(false);
    expect(isBookedAppointment('confirmed')).toBe(true);
  });

  it('Werkstatt bestätigt Anfragen oder schlägt eine Alternative vor', () => {
    expect(canTransitionAppointment(appt('requested'), 'confirmed', service()).ok).toBe(true);
    expect(canTransitionAppointment(appt('requested'), 'proposed', service()).ok).toBe(true);
    expect(canTransitionAppointment(appt('requested'), 'cancelled', admin()).ok).toBe(true);
  });

  it('Kunde kann seine Anfrage nicht selbst bestätigen', () => {
    expect(canTransitionAppointment(appt('requested'), 'confirmed', customerA())).toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED_FOR_ROLE' } });
  });

  it('eine vorgeschlagene Alternative bestätigt nur der Kunde; Ablehnung führt zurück zur Anfrage oder zur Absage', () => {
    expect(canTransitionAppointment(appt('proposed'), 'confirmed', customerA()).ok).toBe(true);
    expect(canTransitionAppointment(appt('proposed'), 'confirmed', service())).toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED_FOR_ROLE' } });
    expect(canTransitionAppointment(appt('proposed'), 'requested', customerA()).ok).toBe(true);
    expect(canTransitionAppointment(appt('proposed'), 'cancelled', customerA()).ok).toBe(true);
  });

  it('bestätigte Termine: erledigt, abgesagt oder nicht erschienen', () => {
    expect(canTransitionAppointment(appt('confirmed'), 'completed', service()).ok).toBe(true);
    expect(canTransitionAppointment(appt('confirmed'), 'no_show', service()).ok).toBe(true);
    expect(canTransitionAppointment(appt('confirmed'), 'cancelled', customerA()).ok).toBe(true);
    expect(canTransitionAppointment(appt('confirmed'), 'completed', customerA()).ok).toBe(false);
  });

  it('verbotene Übergänge, fremde Termine und fehlende Rechte', () => {
    expect(canTransitionAppointment(appt('requested'), 'no_show', service())).toMatchObject({ ok: false, error: { code: 'TRANSITION_NOT_ALLOWED' } });
    expect(canTransitionAppointment(appt('cancelled'), 'confirmed', service()).ok).toBe(false);
    expect(canTransitionAppointment(appt('proposed'), 'confirmed', customerB())).toMatchObject({ ok: false, error: { code: 'NOT_OWN_APPOINTMENT' } });
    expect(canTransitionAppointment(appt('requested'), 'confirmed', mechanic())).toMatchObject({ ok: false, error: { code: 'MISSING_PERMISSION' } });
  });

  describe('Alternativvorschläge', () => {
    const proposals: ProposalState[] = [
      { id: tid(8101), startsAt: '2026-09-29T06:00:00Z', endsAt: '2026-09-29T08:00:00Z', status: 'superseded' },
      { id: tid(8102), startsAt: '2026-09-30T06:00:00Z', endsAt: '2026-09-30T08:00:00Z', status: 'open' },
    ];

    it('neuer Vorschlag ersetzt offene Vorschläge', () => {
      const r = proposeAlternative({ status: 'requested', proposals }, { startsAt: '2026-10-01T06:00:00Z', endsAt: '2026-10-01T08:00:00Z' });
      expect(r).toMatchObject({ ok: true, value: { status: 'proposed', supersededProposalIds: [tid(8102)] } });
      expect(proposeAlternative({ status: 'confirmed', proposals }, { startsAt: '2026-10-01T06:00:00Z', endsAt: '2026-10-01T08:00:00Z' }).ok).toBe(false);
      expect(proposeAlternative({ status: 'requested', proposals }, { startsAt: '2026-10-01T08:00:00Z', endsAt: '2026-10-01T06:00:00Z' }).ok).toBe(false);
    });

    it('Annahme bestätigt den Termin zu den vorgeschlagenen Zeiten', () => {
      const r = acceptProposal({ status: 'proposed', proposals }, tid(8102), new Date('2026-09-27T10:00:00Z'));
      expect(r).toMatchObject({ ok: true, value: { status: 'confirmed', startsAt: '2026-09-30T06:00:00Z', acceptedProposalId: tid(8102) } });
      expect(acceptProposal({ status: 'proposed', proposals }, tid(8101), new Date())).toMatchObject({ ok: false, error: { code: 'PROPOSAL_NOT_OPEN' } });
    });

    it('Ablehnung macht den Termin wieder zur Anfrage oder sagt ihn ab', () => {
      expect(declineProposal({ status: 'proposed', proposals }, tid(8102))).toMatchObject({ ok: true, value: { status: 'requested' } });
      expect(declineProposal({ status: 'proposed', proposals }, tid(8102), { cancel: true })).toMatchObject({ ok: true, value: { status: 'cancelled' } });
    });
  });
});

describe('Abnahme: Terminkonflikte', () => {
  const lift1 = tid(8001);
  const lift2 = tid(8002);
  // Montag, 28.09.2026 (MESZ): 08:00 bis 10:00 Uhr Ortszeit = 06:00 bis 08:00 UTC
  const candidate: ScheduleCandidate = {
    startsAt: '2026-09-28T06:00:00Z',
    endsAt: '2026-09-28T08:00:00Z',
    resourceId: lift1,
    assigneeIds: [IDS.mechanicUser],
    workOrderId: IDS.workOrderA,
  };
  const openingHours: OpeningHoursSlot[] = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens: '07:30', closes: '17:00' })).concat([{ weekday: 6, opens: '8:00', closes: '12:00' }]);
  const workingHours: WorkingHoursSlot[] = [1, 2, 3, 4, 5].map((weekday) => ({ userId: IDS.mechanicUser, weekday, startTime: '07:00', endTime: '16:00' }));
  const base = { existing: [] as ExistingAppointment[], workingHours, openingHours, partDemands: [], resourceNames: { [lift1]: 'Hebebühne 1' }, staffNames: { [IDS.mechanicUser]: '[TEST] Mechaniker' } };

  it('ohne Überschneidungen keine Konflikte', () => {
    expect(detectConflicts({ ...base, candidate })).toEqual([]);
  });

  it('Hebebühne doppelt belegt', () => {
    const existing: ExistingAppointment[] = [
      { id: tid(8201), status: 'confirmed', startsAt: '2026-09-28T07:00:00Z', endsAt: '2026-09-28T09:00:00Z', resourceId: lift1, assigneeIds: [] },
    ];
    const conflicts = detectConflicts({ ...base, candidate, existing });
    expect(conflicts).toEqual([
      { kind: 'resource_double_booked', message: '„Hebebühne 1“ ist am 28.09.2026 von 09:00 bis 11:00 Uhr bereits belegt.', relatedAppointmentId: tid(8201) },
    ]);
  });

  it('Mitarbeiter doppelt eingeplant', () => {
    const existing: ExistingAppointment[] = [
      { id: tid(8202), status: 'confirmed', startsAt: '2026-09-28T05:00:00Z', endsAt: '2026-09-28T06:30:00Z', resourceId: lift2, assigneeIds: [IDS.mechanicUser] },
    ];
    const conflicts = detectConflicts({ ...base, candidate, existing });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: 'assignee_double_booked', relatedAppointmentId: tid(8202) });
    expect(conflicts[0]?.message).toBe('[TEST] Mechaniker ist am 28.09.2026 von 07:00 bis 08:30 Uhr bereits für einen anderen Termin eingeplant.');
  });

  it('Anfragen, Vorschläge, abgesagte und angrenzende Termine blockieren nicht', () => {
    const existing: ExistingAppointment[] = [
      { id: tid(8203), status: 'requested', startsAt: '2026-09-28T06:00:00Z', endsAt: '2026-09-28T08:00:00Z', resourceId: lift1, assigneeIds: [IDS.mechanicUser] },
      { id: tid(8204), status: 'proposed', startsAt: '2026-09-28T06:00:00Z', endsAt: '2026-09-28T08:00:00Z', resourceId: lift1, assigneeIds: [] },
      { id: tid(8205), status: 'cancelled', startsAt: '2026-09-28T06:00:00Z', endsAt: '2026-09-28T08:00:00Z', resourceId: lift1, assigneeIds: [] },
      { id: tid(8206), status: 'confirmed', startsAt: '2026-09-28T08:00:00Z', endsAt: '2026-09-28T09:00:00Z', resourceId: lift1, assigneeIds: [IDS.mechanicUser] },
    ];
    expect(detectConflicts({ ...base, candidate, existing })).toEqual([]);
  });

  it('beim Verschieben wird der Termin nicht mit sich selbst verglichen', () => {
    const existing: ExistingAppointment[] = [
      { id: tid(8207), status: 'confirmed', startsAt: '2026-09-28T06:00:00Z', endsAt: '2026-09-28T07:00:00Z', resourceId: lift1, assigneeIds: [IDS.mechanicUser] },
    ];
    expect(detectConflicts({ ...base, candidate: { ...candidate, id: tid(8207) }, existing })).toEqual([]);
  });

  it('fehlende Teile werden gemeldet, eingetroffene und verbaute nicht', () => {
    const conflicts = detectConflicts({
      ...base,
      candidate,
      partDemands: [
        { workOrderId: IDS.workOrderA, description: 'Bremsscheiben vorne', status: 'ordered', expectedAt: '2026-09-29' },
        { workOrderId: IDS.workOrderA, description: 'Bremsbeläge', status: 'needed' },
        { workOrderId: IDS.workOrderA, description: 'Ölfilter', status: 'received' },
        { workOrderId: IDS.workOrderA, description: 'Luftfilter', status: 'installed' },
        { workOrderId: IDS.workOrderB, description: 'Fremdes Teil', status: 'needed' },
      ],
    });
    expect(conflicts).toEqual([
      { kind: 'parts_missing', message: 'Benötigtes Teil fehlt: Bremsscheiben vorne (bestellt, erwartet am 29.09.2026).', relatedAppointmentId: null },
      { kind: 'parts_missing', message: 'Benötigtes Teil fehlt: Bremsbeläge (noch nicht bestellt).', relatedAppointmentId: null },
    ]);
  });

  it('außerhalb der Öffnungszeit und der Arbeitszeit', () => {
    // Montag 16:00 bis 18:00 Uhr Ortszeit
    const late = { ...candidate, startsAt: '2026-09-28T14:00:00Z', endsAt: '2026-09-28T16:00:00Z' };
    const kinds = detectConflicts({ ...base, candidate: late }).map((c) => c.kind);
    expect(kinds).toEqual(['outside_working_hours', 'outside_opening_hours']);
    // Sonntag: geschlossen
    const sunday = { ...candidate, assigneeIds: [], startsAt: '2026-09-27T08:00:00Z', endsAt: '2026-09-27T09:00:00Z' };
    const sundayConflicts = detectConflicts({ ...base, candidate: sunday });
    expect(sundayConflicts.map((c) => c.kind)).toEqual(['outside_opening_hours']);
    expect(sundayConflicts[0]?.message).toBe('Der Termin am 27.09.2026 von 10:00 bis 11:00 Uhr liegt außerhalb der Öffnungszeiten der Werkstatt.');
    // Samstag 09:00 bis 11:00 Uhr: geöffnet ("8:00" wird als 08:00 gelesen)
    const saturday = { ...candidate, assigneeIds: [], startsAt: '2026-10-03T07:00:00Z', endsAt: '2026-10-03T09:00:00Z' };
    expect(detectConflicts({ ...base, candidate: saturday })).toEqual([]);
  });

  it('mehrtägige Termine: Beginn und Ende müssen in den Öffnungszeiten liegen', () => {
    const overnight = { ...candidate, assigneeIds: [], startsAt: '2026-09-28T14:00:00Z', endsAt: '2026-09-29T08:00:00Z' };
    expect(detectConflicts({ ...base, candidate: overnight })).toEqual([]);
    const intoNight = { ...overnight, endsAt: '2026-09-29T18:00:00Z' };
    expect(detectConflicts({ ...base, candidate: intoNight }).map((c) => c.kind)).toEqual(['outside_opening_hours']);
  });

  it('Meldungen sind deutsch und ohne Gedankenstriche', () => {
    const existing: ExistingAppointment[] = [
      { id: tid(8208), status: 'confirmed', startsAt: '2026-09-28T07:00:00Z', endsAt: '2026-09-29T09:00:00Z', resourceId: lift1, assigneeIds: [IDS.mechanicUser] },
    ];
    const conflicts = detectConflicts({ ...base, candidate, existing, resourceNames: {}, staffNames: {}, partDemands: [{ description: 'Teil', status: 'needed' }] });
    for (const c of conflicts) expect(c.message).not.toMatch(/[–—]/);
    expect(conflicts[0]?.message).toBe('Die Hebebühne bzw. der Arbeitsplatz ist vom 28.09.2026, 09:00 Uhr bis 29.09.2026, 11:00 Uhr bereits belegt.');
  });

  it('lehnt Termine mit Ende vor Beginn ab', () => {
    expect(() => detectConflicts({ ...base, candidate: { ...candidate, endsAt: candidate.startsAt } })).toThrow();
  });
});
