/**
 * Werkstatt, Termindetail: bestätigen (bei Konflikt nur mit Begründung), Alternative
 * vorschlagen (Dialog), absagen (Bestätigung und Grund), Auftrag anlegen bzw. öffnen.
 */
import { appointmentKindLabels, appointmentStatusLabels, routes, type Appointment, type SchedulingConflict } from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ERROR_CODES } from '../../../src/data/errors';
import { useApiMutation, useApiQuery } from '../../../src/data/hooks';
import { formatDateTime, formatTimeRange, keepPlates } from '../../../src/lib/format';
import { QueryView } from '../../../src/screens/common';
import { ActionError, conflictLabels, InlineLink, useCan } from '../../../src/screens/workshop/shared';
import { useStaffDirectory } from '../../../src/screens/workshop/staff';
import { useTheme } from '../../../src/theme';
import { AppText, Banner, Button, ConfirmDialog, DateTimeField, KeyValueList, Page, PageHeader, Row, Section, Sheet, StatusChip, TextField, useToast } from '../../../src/ui';

export default function AppointmentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const appointmentId = String(id);
  const query = useApiQuery(`werkstatt:termin:${appointmentId}`, async (api) => {
    const a = await api.getAppointment(appointmentId);
    let conflicts: SchedulingConflict[] = [];
    let resourceName: string | null = null;
    try {
      if (a.status !== 'cancelled') conflicts = await api.checkConflicts({ id: a.id, startsAt: a.startsAt, endsAt: a.endsAt, resourceId: a.resourceId ?? null, assigneeIds: a.assigneeIds ?? [], workOrderId: a.workOrderId });
      resourceName = (await api.listResources()).find((r) => r.id === a.resourceId)?.name ?? null;
    } catch {
      // ohne Terminrecht keine Konfliktprüfung
    }
    return { a, conflicts, resourceName };
  });
  return (
    <Page maxWidth={880} testID="werkstatt-termin">
      <PageHeader
        title={query.data ? `${appointmentKindLabels[query.data.a.kind]}, ${query.data.a.customerDisplayName}` : 'Termin'}
        subtitle={query.data ? formatTimeRange(query.data.a.startsAt, query.data.a.endsAt) : undefined}
        backHref={routes.workshop.calendar() as Href}
        backLabel="Kalender"
        crumbs={[{ label: 'Kalender', href: routes.workshop.calendar() as Href }, { label: 'Termin' }]}
      />
      <QueryView query={query} loading="detail" notAvailableTitle="Termin nicht verfügbar">
        {({ a, conflicts, resourceName }) => <Detail a={a} conflicts={conflicts} resourceName={resourceName} />}
      </QueryView>
    </Page>
  );
}

function Detail({ a, conflicts, resourceName }: { a: Appointment; conflicts: SchedulingConflict[]; resourceName: string | null }) {
  const t = useTheme();
  const can = useCan();
  const toast = useToast();
  const { staff } = useStaffDirectory();
  const [dialog, setDialog] = useState<'confirm' | 'cancel' | 'propose' | null>(null);
  const [reason, setReason] = useState('');
  const [start, setStart] = useState<Date | null>(null);
  const [end, setEnd] = useState<Date | null>(null);
  const [message, setMessage] = useState('');
  const [serverConflicts, setServerConflicts] = useState<SchedulingConflict[] | null>(null);
  const confirm = useApiMutation((api, override: string | null) => api.confirmAppointment(a.id, override ? { overrideConflictsReason: override } : {}));
  const cancel = useApiMutation((api) => api.cancelAppointment(a.id, { reason: reason.trim() }));
  const propose = useApiMutation((api) => api.proposeAlternative(a.id, { startsAt: start!.toISOString(), endsAt: end!.toISOString(), message: message.trim() || null }));
  useEffect(() => {
    if (dialog === 'propose') {
      setStart(new Date(a.startsAt));
      setEnd(new Date(a.endsAt));
      setMessage('');
    }
    if (dialog) setReason('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog]);
  const allConflicts = serverConflicts ?? conflicts;
  const names = (a.assigneeIds ?? []).map((id) => staff.find((s) => s.id === id)?.displayName ?? 'Mitarbeiter').join(', ');
  const open = a.status === 'requested' || a.status === 'proposed';
  const openProposal = a.proposals.find((p) => p.status === 'open');
  const write = can('appointments.write');

  async function doConfirm() {
    if (allConflicts.length > 0 && !reason.trim()) return;
    try {
      await confirm.mutate(allConflicts.length > 0 ? reason.trim() : null);
      setDialog(null);
      toast.show('Termin bestätigt. Der Kunde wird benachrichtigt.');
    } catch (e) {
      const err = e as { code?: string; details?: unknown };
      if (err.code === ERROR_CODES.schedulingConflicts && Array.isArray(err.details)) setServerConflicts(err.details as SchedulingConflict[]);
    }
  }

  return (
    <>
      <Row wrap>
        <StatusChip status={appointmentStatusLabels[a.status]} testID="termin-status" />
        <AppText variant="small" tone="subtle">
          {a.requestedBy === 'customer' ? 'Vom Kunden angefragt' : 'Von der Werkstatt angelegt'}
          {a.confirmedAt ? `, bestätigt ${formatDateTime(a.confirmedAt)}` : ''}
        </AppText>
      </Row>
      {allConflicts.length > 0 && a.status !== 'cancelled' ? (
        <View style={[styles.conflicts, { borderColor: t.colors.danger, backgroundColor: t.colors.surface, borderRadius: t.radius.panel }]} testID="termin-konflikte">
          <AppText variant="heading">{allConflicts.length === 1 ? 'Konflikt' : `${allConflicts.length} Konflikte`}</AppText>
          {allConflicts.map((c, i) => (
            <Row key={`${c.kind}-${i}`} wrap gap={8}>
              <StatusChip status={conflictLabels[c.kind]} />
              <AppText style={styles.flex}>{c.message}</AppText>
              {c.relatedAppointmentId ? <InlineLink label="Anderen Termin öffnen" onPress={() => router.push(routes.workshop.appointment(c.relatedAppointmentId!) as Href)} /> : null}
            </Row>
          ))}
        </View>
      ) : null}
      <KeyValueList
        items={[
          { label: 'Kunde', value: <InlineLink label={a.customerDisplayName} onPress={() => router.push(routes.workshop.customer(a.customerId) as Href)} /> },
          { label: 'Fahrzeug', value: <InlineLink label={keepPlates(a.vehicleLabel)} onPress={() => router.push(routes.workshop.vehicle(a.vehicleId) as Href)} /> },
          { label: a.status === 'requested' ? 'Wunschzeit' : 'Zeit', value: formatTimeRange(a.startsAt, a.endsAt), numeric: true },
          { label: 'Hebebühne', value: resourceName ?? 'keine' },
          { label: 'Mitarbeiter', value: names || 'nicht zugewiesen' },
          { label: 'Auftrag', value: a.workOrderId ? <InlineLink label="Auftrag öffnen" onPress={() => router.push(routes.workshop.workOrder(a.workOrderId!) as Href)} /> : 'ohne Auftrag' },
        ]}
      />
      {a.customerNote ? (
        <Section title="Hinweis des Kunden">
          <AppText>{a.customerNote}</AppText>
        </Section>
      ) : null}
      {a.internalNote ? (
        <View style={[styles.internal, { borderColor: t.colors.borderStrong, backgroundColor: t.colors.surfaceSunken, borderRadius: t.radius.panel }]}>
          <StatusChip status={{ label: 'Intern', tone: 'neutral', icon: 'Lock' }} />
          <AppText>{a.internalNote}</AppText>
        </View>
      ) : null}
      {openProposal ? <Banner tone="info" title="Alternative vorgeschlagen" message={`${formatTimeRange(openProposal.startsAt, openProposal.endsAt)}. Der Kunde kann annehmen oder ablehnen.`} /> : null}
      {a.status === 'cancelled' ? <Banner tone="neutral" title="Abgesagt" message={a.cancelReason ?? undefined} /> : null}
      <ActionError error={confirm.error?.code === ERROR_CODES.schedulingConflicts ? null : (confirm.error ?? cancel.error ?? propose.error)} title="Aktion nicht ausgeführt" />
      {write && a.status !== 'cancelled' && a.status !== 'completed' ? (
        <Row wrap>
          {open ? <Button label="Bestätigen" variant="primary" icon="CalendarCheck" onPress={() => setDialog('confirm')} testID="termin-bestaetigen" /> : null}
          {open || a.status === 'confirmed' ? <Button label="Alternative vorschlagen" icon="CalendarPlus" onPress={() => setDialog('propose')} testID="termin-alternative" /> : null}
          <Button label="Absagen" icon="CalendarX" onPress={() => setDialog('cancel')} testID="termin-absagen" />
          {a.status === 'confirmed' && !a.workOrderId && can('workOrders.write') ? (
            <Button label="Auftrag anlegen" icon="Plus" onPress={() => router.push(`${routes.workshop.newWorkOrder()}?kunde=${a.customerId}&fahrzeug=${a.vehicleId}` as Href)} />
          ) : null}
        </Row>
      ) : null}

      <ConfirmDialog
        visible={dialog === 'confirm'}
        title="Termin bestätigen?"
        message={`${formatTimeRange(a.startsAt, a.endsAt)}. Der Kunde wird benachrichtigt.${allConflicts.length > 0 ? ' Es gibt Konflikte: Bestätigen nur mit Begründung.' : ''}`}
        confirmLabel="Bestätigen"
        icon="CalendarCheck"
        loading={confirm.pending}
        onCancel={() => setDialog(null)}
        testID="termin-bestaetigen-dialog"
        onConfirm={() => void doConfirm()}
      >
        {allConflicts.length > 0 ? (
          <>
            {allConflicts.map((c, i) => (
              <StatusChip key={`${c.kind}-${i}`} status={conflictLabels[c.kind]} />
            ))}
            <TextField label="Begründung" value={reason} onChangeText={setReason} required multiline error={reason.trim() ? null : 'Pflicht bei Konflikten'} testID="bestaetigen-begruendung" />
          </>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        visible={dialog === 'cancel'}
        title="Termin absagen?"
        message="Der Kunde wird benachrichtigt. Die Absage lässt sich nicht rückgängig machen; ein neuer Termin muss neu angelegt werden."
        confirmLabel="Absagen"
        tone="destructive"
        loading={cancel.pending}
        onCancel={() => setDialog(null)}
        onConfirm={async () => {
          if (!reason.trim()) return;
          try {
            await cancel.mutate();
            setDialog(null);
            toast.show('Termin abgesagt.');
          } catch {
            // Fehler unten
          }
        }}
      >
        <TextField label="Grund (für den Kunden sichtbar)" value={reason} onChangeText={setReason} required multiline error={reason.trim() ? null : 'Pflichtfeld'} />
      </ConfirmDialog>
      <Sheet
        visible={dialog === 'propose'}
        onClose={() => setDialog(null)}
        title="Alternative vorschlagen"
        footer={
          <>
            <Button label="Abbrechen" onPress={() => setDialog(null)} />
            <Button
              label="Vorschlag senden"
              variant="primary"
              loading={propose.pending}
              disabled={!start || !end || end <= start}
              onPress={async () => {
                try {
                  await propose.mutate();
                  setDialog(null);
                  toast.show('Vorschlag gesendet. Der Kunde kann annehmen oder ablehnen.');
                } catch {
                  // Fehler unten
                }
              }}
              testID="vorschlag-senden"
            />
          </>
        }
      >
        <DateTimeField label="Beginn" value={start} onChange={setStart} required />
        <DateTimeField label="Ende" value={end} onChange={setEnd} required error={start && end && end <= start ? 'Das Ende muss nach dem Beginn liegen.' : null} />
        <TextField label="Nachricht an den Kunden (freiwillig)" value={message} onChangeText={setMessage} multiline />
        <ActionError error={propose.error} />
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  conflicts: { borderWidth: 1, borderLeftWidth: 4, padding: 16, gap: 10 },
  internal: { borderWidth: 1, borderStyle: 'dashed', padding: 16, gap: 8 },
  flex: { flex: 1, minWidth: 200 },
});
