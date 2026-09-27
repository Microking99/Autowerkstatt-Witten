/** Termin anfragen: Fahrzeug, Art, Wunschzeitraum, Anliegen → Status "Angefragt, noch nicht bestätigt". */
import { APPOINTMENT_KINDS, appointmentKindLabels, routes, type Appointment, type AppointmentKind } from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApiMutation, useApiQuery } from '../../../src/data/hooks';
import { useIsOffline } from '../../../src/data/network';
import { formatTimeRange } from '../../../src/lib/format';
import { QueryView } from '../../../src/screens/common';
import { useTheme } from '../../../src/theme';
import { AppText, Banner, Button, DateTimeField, EmptyState, Icon, iconSize, Page, PageHeader, Row, Select, StatusChip, TextField } from '../../../src/ui';

function nextWorkday(hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}

export default function RequestAppointmentScreen() {
  const params = useLocalSearchParams<{ fahrzeug?: string }>();
  const t = useTheme();
  const offline = useIsOffline();
  const vehicles = useApiQuery('kunde:termin:fahrzeuge', async (api) => (await api.listVehicles()).items);
  const [vehicleId, setVehicleId] = useState<string | null>(params.fahrzeug ?? null);
  const [kind, setKind] = useState<AppointmentKind | null>('service');
  const [start, setStart] = useState<Date>(nextWorkday(8));
  const [end, setEnd] = useState<Date>(nextWorkday(12));
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [created, setCreated] = useState<Appointment | null>(null);
  const request = useApiMutation((api) =>
    api.requestAppointment({ kind: kind!, vehicleId: vehicleId!, preferredStart: start.toISOString(), preferredEnd: end.toISOString(), customerNote: note.trim() || null }),
  );

  const effectiveVehicle = vehicleId ?? (vehicles.data?.length === 1 ? vehicles.data[0]!.id : null);
  const errors = {
    vehicle: submitted && !effectiveVehicle ? 'Bitte wählen Sie ein Fahrzeug.' : null,
    kind: submitted && !kind ? 'Bitte wählen Sie die Art des Termins.' : null,
    start: submitted && start.getTime() < Date.now() ? 'Der Wunschtermin liegt in der Vergangenheit.' : null,
    end: submitted && end.getTime() <= start.getTime() ? 'Das Ende muss nach dem Beginn liegen.' : null,
  };

  if (created) {
    return (
      <Page maxWidth={720} testID="termin-angefragt">
        <PageHeader title="Anfrage gesendet" backHref={routes.customer.appointments() as Href} backLabel="Termine" />
        <View style={[styles.result, { backgroundColor: t.colors.surface, borderColor: t.colors.border, borderRadius: t.radius.panel }]}>
          <Icon name="CalendarPlus" size={iconSize.xl} color={t.colors.accent} />
          <StatusChip status={{ label: 'Angefragt, noch nicht bestätigt', tone: 'warning', icon: 'HourglassMedium' }} />
          <AppText variant="heading">Ihre Anfrage ist bei uns eingegangen</AppText>
          <AppText tone="muted" numeric>
            Wunsch: {formatTimeRange(created.startsAt, created.endsAt)}. Das ist noch keine Buchung. Wir bestätigen den Termin oder schlagen Ihnen eine Alternative vor; Sie erhalten dazu eine Mitteilung.
          </AppText>
          <Row wrap>
            <Button label="Zu Ihren Terminen" variant="primary" onPress={() => router.replace(routes.customer.appointments() as Href)} />
            <Button label="Anfrage ansehen" onPress={() => router.replace(routes.customer.appointment(created.id) as Href)} />
          </Row>
        </View>
      </Page>
    );
  }

  return (
    <Page maxWidth={720} testID="termin-anfrage-formular">
      <PageHeader
        title="Termin anfragen"
        backHref={routes.customer.appointments() as Href}
        backLabel="Termine"
        crumbs={[{ label: 'Termine', href: routes.customer.appointments() as Href }, { label: 'Anfragen' }]}
      />
      <QueryView query={vehicles} loading="detail">
        {(list) =>
          list.length === 0 ? (
            <EmptyState icon="Car" title="Kein Fahrzeug zugeordnet" message="Für eine Terminanfrage muss Ihr Fahrzeug bei uns angelegt sein. Bitte rufen Sie uns an." />
          ) : (
            <View style={[styles.form, { backgroundColor: t.colors.surface, borderColor: t.colors.border, borderRadius: t.radius.panel }]}>
              {request.error ? (
                <Banner tone="danger" title="Anfrage nicht gesendet" message={request.error.isNetwork ? 'Die Verbindung ist abgebrochen. Ihre Eingaben bleiben erhalten; bitte senden Sie erneut.' : request.error.message} testID="anfrage-fehler" />
              ) : null}
              <Select label="Fahrzeug" value={effectiveVehicle} onChange={setVehicleId} options={list.map((v) => ({ value: v.id, label: `${v.make} ${v.model}`, description: v.licensePlate }))} error={errors.vehicle} required testID="termin-fahrzeug" />
              <Select label="Art des Termins" value={kind} onChange={setKind} options={APPOINTMENT_KINDS.map((k) => ({ value: k, label: appointmentKindLabels[k] }))} error={errors.kind} required testID="termin-art" />
              <DateTimeField label="Wunschtermin von" value={start} onChange={(d) => { setStart(d); if (end <= d) setEnd(new Date(d.getTime() + 4 * 3_600_000)); }} minimumDate={new Date()} error={errors.start} required testID="termin-von" />
              <DateTimeField label="Wunschtermin bis" value={end} onChange={setEnd} minimumDate={start} error={errors.end} help="Ein Zeitraum hilft uns, einen passenden Termin zu finden." required testID="termin-bis" />
              <TextField label="Ihr Anliegen" value={note} onChangeText={setNote} multiline maxLength={2000} help="Zum Beispiel: Geräusch beim Bremsen, Inspektion laut Anzeige fällig." testID="termin-anliegen" />
              {offline ? <Banner tone="info" message="Ohne Verbindung können keine Anfragen gesendet werden." /> : null}
              <Button
                label="Anfrage senden"
                variant="primary"
                icon="PaperPlaneRight"
                loading={request.pending}
                disabled={offline}
                testID="anfrage-senden"
                onPress={async () => {
                  setSubmitted(true);
                  if (!effectiveVehicle || !kind || start.getTime() < Date.now() || end.getTime() <= start.getTime()) return;
                  if (!vehicleId) setVehicleId(effectiveVehicle);
                  try {
                    setCreated(await request.mutate());
                  } catch {
                    // Hinweis oben im Formular
                  }
                }}
              />
            </View>
          )
        }
      </QueryView>
    </Page>
  );
}

const styles = StyleSheet.create({
  form: { borderWidth: 1, padding: 16, gap: 16 },
  result: { borderWidth: 1, padding: 24, gap: 12 },
});
