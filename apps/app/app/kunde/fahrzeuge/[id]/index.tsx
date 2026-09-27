/**
 * Fahrzeug: Daten, letzter km-Stand, nächste Fälligkeiten (Schätzung gekennzeichnet),
 * laufende Aufträge. Aktionen: Servicehistorie, Termin anfragen, teilen, QR-Kurzansicht.
 */
import { odometerSourceLabel } from '../../../../src/screens/customer/labels';
import { routes } from '@werkstatt/contracts';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApiMutation, useApiQuery } from '../../../../src/data/hooks';
import { useIsOffline } from '../../../../src/data/network';
import { keepPlates, formatDate, formatKm, formatVin } from '../../../../src/lib/format';
import { dueStateLabels, dueSummary, estimateLabel, isKmEstimate } from '../../../../src/screens/customer/helpers';
import { QueryView } from '../../../../src/screens/common';
import {
  AppText,
  Banner,
  Button,
  Card,
  Columns,
  ConfirmDialog,
  EmptyState,
  KeyValueList,
  ListGroup,
  ListRow,
  Page,
  PageHeader,
  Row,
  Section,
  StatusChip,
  StatusTriple,
  SwitchRow,
  useToast,
} from '../../../../src/ui';

export default function VehicleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const vehicleId = String(id);
  const toast = useToast();
  const offline = useIsOffline();
  const [confirmQr, setConfirmQr] = useState<null | boolean>(null);
  const query = useApiQuery(`kunde:fahrzeug:${vehicleId}`, async (api) => {
    const [vehicle, dues, orders, odometer] = await Promise.all([
      api.getVehicle(vehicleId),
      api.maintenanceDue(vehicleId),
      api.listWorkOrders({ vehicleId }),
      api.listOdometer(vehicleId),
    ]);
    return { vehicle, dues, orders: orders.items, odometer };
  });
  const setQr = useApiMutation((api, enabled: boolean) => api.setQrPublicView(vehicleId, enabled));
  const title = query.data ? `${query.data.vehicle.make} ${query.data.vehicle.model}` : 'Fahrzeug';

  return (
    <Page testID="kunde-fahrzeug">
      <PageHeader
        title={title}
        subtitle={query.data ? keepPlates(query.data.vehicle.licensePlate) : undefined}
        backHref={routes.customer.vehicles() as Href}
        backLabel="Fahrzeuge"
        crumbs={[{ label: 'Start', href: routes.customer.home() as Href }, { label: 'Fahrzeuge', href: routes.customer.vehicles() as Href }, { label: title }]}
        actions={
          query.data ? (
            <>
              <Button label="Termin anfragen" variant="primary" icon="CalendarPlus" onPress={() => router.push(routes.customer.requestAppointment(vehicleId) as Href)} />
              <Button label="Servicehistorie" icon="ClockCounterClockwise" onPress={() => router.push(routes.customer.serviceHistory(vehicleId) as Href)} testID="zur-servicehistorie" />
              <Button label="Teilen" icon="ShareNetwork" onPress={() => router.push(routes.customer.shares(vehicleId) as Href)} testID="fahrzeug-teilen" />
            </>
          ) : null
        }
      />
      <QueryView query={query} loading="detail">
        {({ vehicle: v, dues, orders, odometer }) => {
          const running = orders.filter((o) => !['picked_up', 'cancelled'].includes(o.status.work));
          const last = odometer[0];
          return (
            <Columns ratio={[3, 2]}>
              <>
                <Section title="Nächste Fälligkeiten" testID="faelligkeiten">
                  {dues.length === 0 ? (
                    <EmptyState icon="Gauge" title="Keine Fälligkeiten" message="Sobald wir eine Wartung durchgeführt haben, berechnen wir hier die nächste Fälligkeit." />
                  ) : (
                    dues.map((d) => (
                      <Card key={d.lastServiceEntryId} tone={d.state === 'overdue' ? 'danger' : d.state === 'due_soon' ? 'attention' : 'default'}>
                        <Row wrap>
                          <StatusChip status={dueStateLabels[d.state]} />
                          {isKmEstimate(d) ? <StatusChip status={estimateLabel} /> : null}
                        </Row>
                        <AppText variant="heading">{d.title}</AppText>
                        <AppText numeric>{dueSummary(d)}</AppText>
                        <AppText variant="small" tone="muted">
                          {d.explanation}
                        </AppText>
                      </Card>
                    ))
                  )}
                  <AppText variant="small" tone="subtle">
                    Die zuerst erreichte Grenze (Datum oder Kilometer) ist maßgeblich. Geschätzte Kilometerstände sind als Schätzung gekennzeichnet.
                  </AppText>
                </Section>

                <Section title="Laufende Aufträge">
                  {running.length === 0 ? (
                    <AppText tone="muted">Zurzeit ist kein Auftrag für dieses Fahrzeug offen.</AppText>
                  ) : (
                    running.map((o) => (
                      <Card key={o.id} onPress={() => router.push(routes.customer.workOrder(o.id) as Href)} accessibilityLabel={`${o.title}, ${o.orderNumber}`}>
                        <AppText variant="heading">{o.title}</AppText>
                        <AppText tone="muted">{o.orderNumber}</AppText>
                        <StatusTriple status={o.status} audience="customer" compact />
                      </Card>
                    ))
                  )}
                </Section>
              </>
              <>
                <Section title="Fahrzeugdaten">
                  <KeyValueList
                    columns={1}
                    items={[
                      { label: 'Kennzeichen', value: keepPlates(v.licensePlate), code: true },
                      { label: 'FIN', value: v.vin ? formatVin(v.vin) : 'nicht erfasst', code: !!v.vin },
                      { label: 'HSN / TSN', value: `${v.hsn ?? '-'} / ${v.tsn ?? '-'}`, code: true },
                      { label: 'Erstzulassung', value: formatDate(v.firstRegistration), numeric: true },
                      { label: 'Kraftstoff', value: v.fuelType ?? 'nicht erfasst' },
                      {
                        label: 'Letzter km-Stand',
                        value: last ? `${formatKm(last.valueKm)} am ${formatDate(last.recordedAt)} (${odometerSourceLabel[last.source]})` : 'noch nicht erfasst',
                        numeric: true,
                      },
                    ]}
                  />
                </Section>

                <Section title="QR-Serviceheft">
                  <SwitchRow
                    label="Öffentliche Kurzansicht"
                    description={
                      v.qrPublicViewEnabled
                        ? 'Eingeschaltet: Wer den QR-Code scannt, sieht Marke, Modell und die Liste der Wartungen, aber keine Namen, Kennzeichen, FIN oder Preise.'
                        : 'Ausgeschaltet: Ohne Anmeldung zeigt der QR-Code nur einen Hinweis und die Anmeldung.'
                    }
                    value={v.qrPublicViewEnabled}
                    disabled={setQr.pending || offline}
                    onChange={(value) => setConfirmQr(value)}
                  />
                  {v.qrUrl ? (
                    <Card>
                      <AppText variant="caption" tone="subtle">
                        Link des QR-Codes
                      </AppText>
                      <AppText code selectable>
                        {v.qrUrl}
                      </AppText>
                      <Button
                        label="Link kopieren"
                        icon="Copy"
                        onPress={async () => {
                          await Clipboard.setStringAsync(v.qrUrl ?? '');
                          toast.show('Link kopiert.');
                        }}
                      />
                    </Card>
                  ) : null}
                  <AppText variant="small" tone="subtle">
                    Den QR-Aufkleber erhalten Sie in der Werkstatt. Er bleibt auch nach Wartungen gültig.
                  </AppText>
                  {setQr.error ? <Banner tone="danger" message="Die Einstellung wurde nicht gespeichert. Bitte versuchen Sie es erneut." /> : null}
                </Section>
              </>
            </Columns>
          );
        }}
      </QueryView>
      <ConfirmDialog
        visible={confirmQr !== null}
        title={confirmQr ? 'Öffentliche Kurzansicht einschalten?' : 'Öffentliche Kurzansicht ausschalten?'}
        message={
          confirmQr
            ? 'Jeder, der den QR-Code scannt, sieht dann Marke, Modell und die Liste der Wartungen mit Datum und Kilometerstand. Persönliche Daten, Preise und Unterlagen bleiben geschützt.'
            : 'Ohne Anmeldung zeigt der QR-Code danach nur noch einen Hinweis und die Anmeldung.'
        }
        confirmLabel={confirmQr ? 'Einschalten' : 'Ausschalten'}
        icon="QrCode"
        loading={setQr.pending}
        onCancel={() => setConfirmQr(null)}
        onConfirm={async () => {
          const value = confirmQr === true;
          try {
            await setQr.mutate(value);
            toast.show(value ? 'Öffentliche Kurzansicht eingeschaltet.' : 'Öffentliche Kurzansicht ausgeschaltet.');
          } catch {
            // Hinweis im Abschnitt
          } finally {
            setConfirmQr(null);
          }
        }}
      />
      <View style={styles.spacer} />
    </Page>
  );
}

const styles = StyleSheet.create({
  spacer: { height: 8 },
});
