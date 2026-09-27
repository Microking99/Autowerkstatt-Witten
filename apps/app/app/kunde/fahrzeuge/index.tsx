/** Meine Fahrzeuge (nur aktuell eigene). */
import { routes } from '@werkstatt/contracts';
import { router, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useApiQuery } from '../../../src/data/hooks';
import { keepPlates, formatDate, formatKm } from '../../../src/lib/format';
import { dueStateLabels } from '../../../src/screens/customer/helpers';
import { QueryView } from '../../../src/screens/common';
import { useBreakpoint } from '../../../src/theme';
import { AppText, Card, EmptyState, Page, PageHeader, Row, StatusChip } from '../../../src/ui';

export default function VehiclesScreen() {
  const { device } = useBreakpoint();
  const query = useApiQuery('kunde:fahrzeuge', async (api) => {
    const vehicles = (await api.listVehicles()).items;
    const dues = await Promise.all(vehicles.map((v) => api.maintenanceDue(v.id)));
    return vehicles.map((v, i) => ({ vehicle: v, dues: dues[i] ?? [] }));
  });
  return (
    <Page testID="kunde-fahrzeuge">
      <PageHeader title="Meine Fahrzeuge" crumbs={[{ label: 'Start', href: routes.customer.home() as Href }, { label: 'Fahrzeuge' }]} />
      <QueryView query={query} loading="cards">
        {(list) =>
          list.length === 0 ? (
            <EmptyState icon="Car" title="Noch keine Fahrzeuge" message="Die Werkstatt ordnet Ihr Fahrzeug zu, sobald es bei uns angelegt ist." />
          ) : (
            <View style={[styles.grid, device !== 'phone' ? styles.gridWide : null]}>
              {list.map(({ vehicle: v, dues }) => {
                const worst = dues.find((d) => d.state === 'overdue') ?? dues.find((d) => d.state === 'due_soon');
                return (
                  <Card
                    key={v.id}
                    onPress={() => router.push(routes.customer.vehicle(v.id) as Href)}
                    accessibilityLabel={`${v.make} ${v.model}, ${keepPlates(v.licensePlate)}`}
                    style={device !== 'phone' ? styles.half : null}
                    testID={`fahrzeug-${v.licensePlate}`}
                  >
                    <AppText variant="heading">
                      {v.make} {v.model}
                    </AppText>
                    <AppText variant="bodyStrong" code>
                      {keepPlates(v.licensePlate)}
                    </AppText>
                    {v.variant ? <AppText tone="muted">{v.variant}</AppText> : null}
                    <AppText variant="small" tone="subtle" numeric>
                      {v.lastOdometerKm !== null ? `Letzter km-Stand ${formatKm(v.lastOdometerKm)} am ${formatDate(v.lastOdometerAt)}` : 'Noch kein km-Stand erfasst'}
                    </AppText>
                    {worst ? (
                      <Row wrap>
                        <StatusChip status={dueStateLabels[worst.state]} />
                        <AppText variant="small" tone="muted">
                          {worst.title}
                        </AppText>
                      </Row>
                    ) : null}
                  </Card>
                );
              })}
            </View>
          )
        }
      </QueryView>
    </Page>
  );
}

const styles = StyleSheet.create({
  grid: { gap: 12 },
  gridWide: { flexDirection: 'row', flexWrap: 'wrap' },
  half: { flexBasis: '48%', flexGrow: 1 },
});
