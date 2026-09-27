/**
 * Werkstatt, Fahrzeugliste: Kennzeichen, FIN, Halter; Suche in der URL. Neu; Zeile → Akte.
 */
import { routes } from '@werkstatt/contracts';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useApiQuery } from '../../../src/data/hooks';
import { formatDate, formatKm, keepPlates } from '../../../src/lib/format';
import { QueryView } from '../../../src/screens/common';
import { AppText, Button, DataTable, EmptyState, Page, PageHeader, SearchField } from '../../../src/ui';

export default function VehicleList() {
  const params = useLocalSearchParams<{ suche?: string }>();
  const [search, setSearch] = useState(params.suche ?? '');
  const [q, setQ] = useState(params.suche ?? '');
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      router.setParams({ suche: search.trim() || undefined });
    }, 250);
    return () => clearTimeout(t);
  }, [search]);
  const list = useApiQuery(`werkstatt:fahrzeuge:${q}`, (api) => api.listVehicles({ q: q || undefined }));
  return (
    <Page maxWidth={1200} testID="werkstatt-fahrzeuge">
      <PageHeader
        title="Fahrzeuge"
        subtitle={list.data ? `${list.data.items.length} Fahrzeuge` : undefined}
        crumbs={[{ label: 'Übersicht', href: routes.workshop.home() as Href }, { label: 'Fahrzeuge' }]}
        actions={<Button label="Fahrzeug anlegen" variant="primary" icon="Plus" onPress={() => router.push(routes.workshop.newVehicle() as Href)} testID="fahrzeug-anlegen" />}
      />
      <View style={{ maxWidth: 560 }}>
        <SearchField value={search} onChangeText={setSearch} label="Fahrzeuge suchen" placeholder="Kennzeichen, FIN, Marke oder Halter" />
      </View>
      <QueryView query={list}>
        {(page) =>
          page.items.length === 0 ? (
            <EmptyState icon="Car" title="Keine Fahrzeuge gefunden" message="Kennzeichen ohne Leerzeichen suchen oder das Fahrzeug neu anlegen." />
          ) : (
            <DataTable
              label="Fahrzeuge"
              keyboardNav
              rows={page.items}
              rowKey={(v) => v.id}
              rowTestID={(v) => `fahrzeug-${v.licensePlate.replace(/\s/g, '')}`}
              onRowPress={(v) => router.push(routes.workshop.vehicle(v.id) as Href)}
              mobileTitle={(v) => `${keepPlates(v.licensePlate)}, ${v.make} ${v.model}`}
              mobileSubtitle={(v) => v.currentOwner?.displayName ?? 'ohne Halter'}
              mobileMeta={(v) => (v.lastOdometerKm ? `${formatKm(v.lastOdometerKm)} am ${formatDate(v.lastOdometerAt)}` : null)}
              columns={[
                { key: 'kz', header: 'Kennzeichen', render: (v) => <AppText variant="bodyStrong" code numberOfLines={1}>{keepPlates(v.licensePlate)}</AppText>, sortValue: (v) => v.licensePlate, width: 140 },
                { key: 'modell', header: 'Fahrzeug', render: (v) => <AppText>{`${v.make} ${v.model}${v.variant ? ` ${v.variant}` : ''}`}</AppText>, sortValue: (v) => `${v.make} ${v.model}`, flex: 1.5 },
                { key: 'fin', header: 'FIN', render: (v) => <AppText variant="small" code numberOfLines={1}>{v.vin ?? 'nicht erfasst'}</AppText>, flex: 1.6 },
                { key: 'halter', header: 'Halter', render: (v) => <AppText>{v.currentOwner?.displayName ?? 'ohne Halter'}</AppText>, sortValue: (v) => v.currentOwner?.displayName ?? '', flex: 1.4 },
                { key: 'km', header: 'Letzter km-Stand', align: 'right', render: (v) => <AppText numeric>{v.lastOdometerKm ? formatKm(v.lastOdometerKm) : 'unbekannt'}</AppText>, sortValue: (v) => v.lastOdometerKm ?? 0, flex: 1 },
              ]}
            />
          )
        }
      </QueryView>
    </Page>
  );
}
