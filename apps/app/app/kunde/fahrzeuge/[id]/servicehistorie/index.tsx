/** Servicehistorie eines Fahrzeugs (Datum, km, Arbeit). Eintrag → Detail. */
import { routes } from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useApiQuery } from '../../../../../src/data/hooks';
import { keepPlates, formatDate, formatKm } from '../../../../../src/lib/format';
import { QueryView } from '../../../../../src/screens/common';
import { AppText, Banner, DataTable, EmptyState, Page, PageHeader, StatusChip } from '../../../../../src/ui';

export default function ServiceHistoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const vehicleId = String(id);
  const query = useApiQuery(`kunde:historie:${vehicleId}`, async (api) => {
    const [vehicle, entries] = await Promise.all([api.getVehicle(vehicleId), api.listServiceEntries(vehicleId)]);
    return { vehicle, entries };
  });
  const label = query.data ? `${query.data.vehicle.make} ${query.data.vehicle.model}` : 'Fahrzeug';
  return (
    <Page testID="kunde-servicehistorie">
      <PageHeader
        title="Servicehistorie"
        subtitle={query.data ? `${label}, ${keepPlates(query.data.vehicle.licensePlate)}` : undefined}
        backHref={routes.customer.vehicle(vehicleId) as Href}
        backLabel={label}
        crumbs={[
          { label: 'Start', href: routes.customer.home() as Href },
          { label: 'Fahrzeuge', href: routes.customer.vehicles() as Href },
          { label, href: routes.customer.vehicle(vehicleId) as Href },
          { label: 'Servicehistorie' },
        ]}
      />
      <QueryView query={query} loading="list">
        {({ entries }) =>
          entries.length === 0 ? (
            <EmptyState icon="ClockCounterClockwise" title="Noch keine Einträge" message="Einträge entstehen, wenn wir eine Wartung an diesem Fahrzeug fachlich abgeschlossen haben." />
          ) : (
            <>
              <DataTable
                label="Servicehistorie"
                rows={entries}
                rowKey={(e) => e.id}
                onRowPress={(e) => router.push(routes.customer.serviceEntry(vehicleId, e.id) as Href)}
                mobileTitle={(e) => e.title}
                mobileSubtitle={(e) => `${formatDate(e.performedOn)}, ${formatKm(e.odometerKm)}`}
                mobileMeta={(e) => (e.revisionNo > 1 ? `Korrigiert (Stand ${e.revisionNo})` : e.workshopName)}
                columns={[
                  { key: 'datum', header: 'Datum', render: (e) => <AppText numeric>{formatDate(e.performedOn)}</AppText>, sortValue: (e) => e.performedOn, flex: 1 },
                  { key: 'km', header: 'Kilometerstand', render: (e) => <AppText numeric>{formatKm(e.odometerKm)}</AppText>, sortValue: (e) => e.odometerKm ?? 0, flex: 1, align: 'right' },
                  { key: 'arbeit', header: 'Arbeit', render: (e) => <AppText variant="bodyStrong">{e.title}</AppText>, sortValue: (e) => e.title, flex: 2 },
                  {
                    key: 'hinweis',
                    header: 'Hinweis',
                    render: (e) => (e.revisionNo > 1 ? <StatusChip status={{ label: 'Korrigiert', tone: 'info', icon: 'PencilSimple' }} /> : <AppText tone="subtle">-</AppText>),
                    flex: 1,
                  },
                ]}
              />
              <Banner tone="info" message="Einträge entstehen nur aus abgeschlossenen Wartungsarbeiten der Autowerkstatt Witten. Abgelehnte oder nicht ausgeführte Arbeiten erscheinen nicht. Es besteht keine Verbindung zu digitalen Serviceheften der Hersteller." />
            </>
          )
        }
      </QueryView>
    </Page>
  );
}
