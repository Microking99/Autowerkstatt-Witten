/**
 * Termindetail: Alternative annehmen → bestätigt; ablehnen → Werkstatt informiert; absagen.
 */
import { appointmentKindLabels, routes, type AppointmentProposal } from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApiMutation, useApiQuery } from '../../../src/data/hooks';
import { useIsOffline } from '../../../src/data/network';
import { keepPlates, formatDateTime, formatTimeRange } from '../../../src/lib/format';
import { appointmentStatusLabels } from '../../../src/screens/customer/helpers';
import { QueryView } from '../../../src/screens/common';
import { useTheme } from '../../../src/theme';
import { AppText, Banner, Button, ConfirmDialog, KeyValueList, Page, PageHeader, Row, Section, StatusChip, TextField, Timeline, useToast } from '../../../src/ui';

const proposalLabels: Record<AppointmentProposal['status'], string> = {
  open: 'offen',
  accepted: 'von Ihnen angenommen',
  declined: 'von Ihnen abgelehnt',
  superseded: 'ersetzt',
};

export default function AppointmentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const appointmentId = String(id);
  const t = useTheme();
  const toast = useToast();
  const offline = useIsOffline();
  const [dialog, setDialog] = useState<'accept' | 'decline' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const query = useApiQuery(`kunde:termin:${appointmentId}`, (api) => api.getAppointment(appointmentId));
  const accept = useApiMutation((api, proposalId: string) => api.acceptProposal(appointmentId, proposalId));
  const decline = useApiMutation((api, proposalId: string) => api.declineProposal(appointmentId, proposalId));
  const cancel = useApiMutation((api) => api.cancelAppointment(appointmentId, { reason: reason.trim() }));
  const failed = accept.error ?? decline.error ?? cancel.error;

  return (
    <Page maxWidth={760} testID="kunde-termin">
      <PageHeader
        title={query.data ? appointmentKindLabels[query.data.kind] : 'Termin'}
        subtitle={query.data?.vehicleLabel}
        backHref={routes.customer.appointments() as Href}
        backLabel="Termine"
        crumbs={[{ label: 'Termine', href: routes.customer.appointments() as Href }, { label: 'Termin' }]}
      />
      <QueryView query={query} loading="detail">
        {(a) => {
          const open = a.proposals.find((p) => p.status === 'open');
          const canCancel = ['requested', 'proposed', 'confirmed'].includes(a.status) && a.endsAt >= new Date().toISOString();
          return (
            <>
              <StatusChip status={appointmentStatusLabels[a.status]} testID="termin-status" />
              {failed ? <Banner tone="danger" title="Nicht gespeichert" message={failed.isNetwork ? 'Die Verbindung ist abgebrochen. Bitte versuchen Sie es erneut.' : failed.message} /> : null}

              {a.status === 'proposed' && open ? (
                <View style={[styles.proposal, { borderColor: t.colors.warning, backgroundColor: t.colors.surface, borderRadius: t.radius.panel }]} testID="terminvorschlag">
                  <AppText variant="heading">Die Werkstatt schlägt einen anderen Termin vor</AppText>
                  <AppText variant="bodyStrong" numeric>
                    {formatTimeRange(open.startsAt, open.endsAt)}
                  </AppText>
                  <AppText tone="muted" numeric>
                    Ihr Wunsch war: {formatTimeRange(a.startsAt, a.endsAt)}
                  </AppText>
                  <Row wrap>
                    <Button label="Ablehnen" onPress={() => setDialog('decline')} disabled={offline} testID="vorschlag-ablehnen" />
                    <Button label="Vorschlag annehmen" variant="primary" icon="CalendarCheck" onPress={() => setDialog('accept')} disabled={offline} testID="vorschlag-annehmen" />
                  </Row>
                </View>
              ) : null}
              {a.status === 'requested' ? (
                <Banner tone="info" title="Angefragt, noch nicht bestätigt" message="Die Werkstatt prüft Ihre Anfrage und bestätigt sie oder schlägt eine Alternative vor. Erst dann ist der Termin gebucht." />
              ) : null}

              <KeyValueList
                columns={1}
                items={[
                  { label: 'Art', value: appointmentKindLabels[a.kind] },
                  { label: 'Fahrzeug', value: keepPlates(a.vehicleLabel) },
                  { label: a.status === 'confirmed' ? 'Termin' : 'Ihr Wunsch', value: formatTimeRange(a.startsAt, a.endsAt), numeric: true },
                  ...(a.customerNote ? [{ label: 'Ihr Anliegen', value: a.customerNote }] : []),
                  ...(a.confirmedAt ? [{ label: 'Bestätigt am', value: formatDateTime(a.confirmedAt), numeric: true }] : []),
                  ...(a.cancelledAt ? [{ label: 'Abgesagt', value: `${formatDateTime(a.cancelledAt)}${a.cancelReason ? `: ${a.cancelReason}` : ''}` }] : []),
                ]}
              />

              {a.workOrderId ? <Button label="Zugehörigen Auftrag öffnen" icon="ClipboardText" onPress={() => router.push(routes.customer.workOrder(a.workOrderId!) as Href)} /> : null}

              {a.proposals.length > 0 ? (
                <Section title="Vorschläge der Werkstatt">
                  <Timeline
                    items={a.proposals
                      .slice()
                      .reverse()
                      .map((p) => ({
                        id: p.id,
                        title: formatTimeRange(p.startsAt, p.endsAt),
                        detail: `Vorschlag ${proposalLabels[p.status]}`,
                        time: `Vorgeschlagen am ${formatDateTime(p.createdAt)}`,
                        tone: p.status === 'accepted' ? 'success' : p.status === 'open' ? 'warning' : 'neutral',
                        icon: p.status === 'accepted' ? 'CalendarCheck' : p.status === 'open' ? 'HourglassMedium' : 'CalendarX',
                      }))}
                  />
                </Section>
              ) : null}

              {canCancel ? <Button label="Termin absagen" variant="quiet" icon="CalendarX" onPress={() => setDialog('cancel')} disabled={offline} testID="termin-absagen" /> : null}

              <ConfirmDialog
                visible={dialog === 'accept'}
                title={open ? `Termin am ${formatTimeRange(open.startsAt, open.endsAt)} annehmen?` : 'Vorschlag annehmen?'}
                message="Damit ist der Termin verbindlich gebucht."
                confirmLabel="Annehmen"
                icon="CalendarCheck"
                loading={accept.pending}
                onCancel={() => setDialog(null)}
                testID="annehmen-dialog"
                onConfirm={async () => {
                  if (!open) return;
                  try {
                    await accept.mutate(open.id);
                    toast.show('Termin bestätigt.');
                  } catch {
                    // Hinweis oben
                  } finally {
                    setDialog(null);
                  }
                }}
              />
              <ConfirmDialog
                visible={dialog === 'decline'}
                title="Vorschlag ablehnen?"
                message="Die Werkstatt wird informiert und meldet sich mit einem neuen Vorschlag. Ihre Anfrage bleibt bestehen."
                confirmLabel="Ablehnen"
                tone="destructive"
                loading={decline.pending}
                onCancel={() => setDialog(null)}
                onConfirm={async () => {
                  if (!open) return;
                  try {
                    await decline.mutate(open.id);
                    toast.show('Vorschlag abgelehnt. Die Werkstatt ist informiert.', 'info');
                  } catch {
                    // Hinweis oben
                  } finally {
                    setDialog(null);
                  }
                }}
              />
              <ConfirmDialog
                visible={dialog === 'cancel'}
                title="Termin absagen?"
                message="Die Werkstatt wird informiert. Einen neuen Termin können Sie jederzeit anfragen."
                confirmLabel="Termin absagen"
                tone="destructive"
                icon="CalendarX"
                loading={cancel.pending}
                onCancel={() => {
                  setDialog(null);
                  setReasonError(null);
                }}
                onConfirm={async () => {
                  if (!reason.trim()) {
                    setReasonError('Bitte geben Sie kurz einen Grund an.');
                    return;
                  }
                  try {
                    await cancel.mutate();
                    toast.show('Termin abgesagt.', 'info');
                  } catch {
                    // Hinweis oben
                  } finally {
                    setDialog(null);
                  }
                }}
              >
                <TextField label="Grund" value={reason} onChangeText={setReason} error={reasonError} required />
              </ConfirmDialog>
            </>
          );
        }}
      </QueryView>
    </Page>
  );
}

const styles = StyleSheet.create({
  proposal: { borderWidth: 1, borderLeftWidth: 4, padding: 16, gap: 8 },
});
