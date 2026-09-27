/** Serviceeintrag: Arbeiten, Details, Werkstatt, nächste Fälligkeit, Korrekturhinweis. */
import { routes } from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useApiQuery } from '../../../../../src/data/hooks';
import { formatDate, formatKm } from '../../../../../src/lib/format';
import { QueryView } from '../../../../../src/screens/common';
import { AppText, Banner, Button, KeyValueList, Page, PageHeader, Section } from '../../../../../src/ui';

function intervalText(km: number | null, months: number | null): string {
  const parts: string[] = [];
  if (km) parts.push(formatKm(km));
  if (months) parts.push(months % 12 === 0 ? `${months / 12} ${months === 12 ? 'Jahr' : 'Jahre'}` : `${months} Monate`);
  return parts.length ? parts.join(' oder ') : 'kein Intervall';
}

export default function ServiceEntryScreen() {
  const { id, eintragId } = useLocalSearchParams<{ id: string; eintragId: string }>();
  const vehicleId = String(id);
  const query = useApiQuery(`kunde:eintrag:${eintragId}`, (api) => api.getServiceEntry(String(eintragId)));
  const title = query.data?.title ?? 'Serviceeintrag';
  return (
    <Page testID="kunde-serviceeintrag">
      <PageHeader
        title={title}
        subtitle={query.data ? formatDate(query.data.performedOn) : undefined}
        backHref={routes.customer.serviceHistory(vehicleId) as Href}
        backLabel="Servicehistorie"
        crumbs={[
          { label: 'Fahrzeuge', href: routes.customer.vehicles() as Href },
          { label: 'Fahrzeug', href: routes.customer.vehicle(vehicleId) as Href },
          { label: 'Servicehistorie', href: routes.customer.serviceHistory(vehicleId) as Href },
          { label: title },
        ]}
      />
      <QueryView query={query} loading="detail">
        {(e) => (
          <>
            {e.vehicleId !== vehicleId ? <Banner tone="warning" message="Dieser Eintrag gehört zu einem anderen Fahrzeug." /> : null}
            <KeyValueList
              items={[
                { label: 'Datum', value: formatDate(e.performedOn), numeric: true },
                { label: 'Kilometerstand', value: formatKm(e.odometerKm), numeric: true },
                { label: 'Arbeit', value: e.title },
                { label: 'Wartungsart', value: e.maintenanceTypeName ?? 'ohne Wartungsart' },
                { label: 'Werkstatt', value: e.workshopName },
                { label: 'Intervall', value: intervalText(e.intervalKm, e.intervalMonths) },
                { label: 'Nächste Fälligkeit', value: [e.nextDueDate ? formatDate(e.nextDueDate) : null, e.nextDueKm !== null ? formatKm(e.nextDueKm) : null].filter(Boolean).join(' oder ') || 'keine', numeric: true },
                { label: 'Stand', value: e.revisionNo > 1 ? `Korrigiert (Stand ${e.revisionNo})` : 'Ursprünglicher Eintrag' },
              ]}
            />
            {e.details ? (
              <Section title="Details">
                <AppText>{e.details}</AppText>
              </Section>
            ) : null}
            {e.revisionNo > 1 && e.correctionReason ? (
              <Banner tone="info" title="Dieser Eintrag wurde korrigiert" message={`Grund: ${e.correctionReason} Die Werkstatt hat den ursprünglichen Stand nicht überschrieben, sondern eine neue Fassung angelegt (${formatDate(e.createdAt)}).`} />
            ) : null}
            <Section title="Auftrag">
              {e.workOrderId ? (
                <Button label="Zugehörigen Auftrag öffnen" icon="ClipboardText" onPress={() => router.push(routes.customer.workOrder(e.workOrderId!) as Href)} />
              ) : (
                <AppText tone="muted" testID="auftrag-ausgeblendet">
                  Dieser Eintrag stammt aus einem Auftrag eines früheren Halters. Auftrag, Rechnung und Nachrichten dazu sind nicht einsehbar; die technischen Angaben gehören zum Fahrzeug.
                </AppText>
              )}
            </Section>
          </>
        )}
      </QueryView>
    </Page>
  );
}
