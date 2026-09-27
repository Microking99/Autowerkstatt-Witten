/**
 * Werkstatt, fällige und bald fällige Wartungen (nach Datum oder km; Schätzungen sind als
 * solche markiert und erklärt). Kunde kontaktieren (Kundenakte) oder Termin anlegen.
 */
import { routes, type MaintenanceDue } from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useApiQuery } from '../../src/data/hooks';
import { keepPlates } from '../../src/lib/format';
import { QueryView } from '../../src/screens/common';
import { dueStateLabels, dueSummary, estimateLabel } from '../../src/screens/customer/helpers';
import { useTheme } from '../../src/theme';
import { AppText, Button, EmptyState, FilterChips, Page, PageHeader, Row, StatusChip } from '../../src/ui';

export default function MaintenanceDueScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ alle?: string }>();
  const all = params.alle === 'ja';
  const query = useApiQuery(`werkstatt:wartungen:${all}`, async (api) => {
    const [due, vehicles] = await Promise.all([api.maintenanceDueAll({ all }), api.listVehicles({})]);
    const byId = new Map(vehicles.items.map((v) => [v.id, v]));
    return due.map((d: MaintenanceDue) => ({ d, v: byId.get(d.vehicleId) }));
  });
  return (
    <Page maxWidth={1040} testID="werkstatt-wartungen">
      <PageHeader title="Fällige Wartungen" subtitle="Aus der Servicehistorie berechnet. Ohne aktuellen km-Stand wird geschätzt und das ausdrücklich angegeben." crumbs={[{ label: 'Übersicht', href: routes.workshop.home() as Href }, { label: 'Wartungen' }]} />
      <FilterChips label="Anzeige" value={all ? 'alle' : 'faellig'} onChange={(v) => router.setParams({ alle: v === 'alle' ? 'ja' : undefined })} options={[{ value: 'faellig', label: 'Überfällig und bald fällig' }, { value: 'alle', label: 'Alle mit Intervall' }]} />
      <QueryView query={query}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState icon="Gauge" title="Nichts fällig" message="Keine überfälligen oder bald fälligen Wartungen." />
          ) : (
            <View style={styles.list}>
              {rows.map(({ d, v }, i) => (
                <View key={`${d.lastServiceEntryId}-${i}`} style={[styles.card, { borderColor: d.state === 'overdue' ? t.colors.danger : d.state === 'due_soon' ? t.colors.warning : t.colors.border, backgroundColor: t.colors.surface, borderRadius: t.radius.panel }]} testID={`faellig-${i}`}>
                  <Row wrap style={styles.between}>
                    <AppText variant="bodyStrong">{v ? `${keepPlates(v.licensePlate)}, ${v.make} ${v.model}` : 'Fahrzeug'}</AppText>
                    <Row wrap gap={6}>
                      <StatusChip status={dueStateLabels[d.state]} />
                      {d.basis === 'km_estimated' ? <StatusChip status={estimateLabel} /> : null}
                    </Row>
                  </Row>
                  <AppText>
                    {d.title}: {dueSummary(d)}
                  </AppText>
                  <AppText variant="small" tone="muted">{d.explanation}</AppText>
                  <AppText variant="small" tone="subtle">Halter: {v?.currentOwner?.displayName ?? 'unbekannt'}</AppText>
                  <Row wrap>
                    {v?.currentOwner ? <Button label="Kunde kontaktieren" icon="Phone" onPress={() => router.push(routes.workshop.customer(v.currentOwner!.customerId) as Href)} /> : null}
                    {v?.currentOwner ? <Button label="Termin anlegen" icon="CalendarPlus" onPress={() => router.push(`${routes.workshop.newAppointment()}?kunde=${v.currentOwner!.customerId}&fahrzeug=${v.id}` as Href)} /> : null}
                    <Button label="Fahrzeugakte" variant="quiet" iconRight="CaretRight" onPress={() => router.push(`${routes.workshop.vehicle(d.vehicleId)}?register=servicehistorie` as Href)} />
                  </Row>
                </View>
              ))}
            </View>
          )
        }
      </QueryView>
    </Page>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  card: { borderWidth: 1, borderLeftWidth: 4, padding: 16, gap: 6 },
  between: { justifyContent: 'space-between' },
});
